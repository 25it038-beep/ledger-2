"""
AI-Powered Digital Identity System — backend entrypoint.

Run with:
    uvicorn main:app --reload --port 8000

Then open frontend/index.html (served automatically at http://localhost:8000/).
"""
import os
import shutil
import uuid

from datetime import datetime

from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import init_db, get_db, UPLOAD_DIR, BASE_DIR
from models import Document, Skill, User
import ingestion
import categorize
import relationships
import timeline as timeline_mod
from vectorstore import store, embedding_text_for
import career
from career import CareerEngineError
import auth
from auth import AuthError
import news

app = FastAPI(title="AI Digital Identity System")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

init_db()


@app.on_event("startup")
def auto_seed_if_empty():
    db = next(get_db())
    try:
        if db.query(Document).count() == 0:
            print("[startup] Database is empty. Ingesting sample data...")
            sample_dir = os.path.join(BASE_DIR, "sample_data")
            if os.path.exists(sample_dir):
                for filename in os.listdir(sample_dir):
                    filepath = os.path.join(sample_dir, filename)
                    if os.path.isfile(filepath) and not filename.startswith("."):
                        try:
                            doc = ingestion.ingest_file(filepath, db)
                            categorize.categorize_document(doc, db)
                            print(f"[startup] Seeded {filename} -> {doc.category}")
                        except Exception as ex:
                            print(f"[startup] Failed to seed {filename}: {ex}")
    finally:
        db.close()


# ---------------------------------------------------------------- Clerk auth
@app.middleware("http")
async def clerk_auth_middleware(request: Request, call_next):
    """Verifies the Clerk session token on every /api/* request (see auth.py).
    While CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY are unset this is a no-op
    so the app keeps working during setup."""
    try:
        claims = auth.require_request_auth(
            request.url.path, request.headers.get("authorization")
        )
        request.state.user_claims = claims
    except AuthError as e:
        return JSONResponse(status_code=e.status_code, content={"detail": e.message})
    return await call_next(request)


@app.get("/api/auth/config")
def auth_config():
    """Public: tells the frontend which Clerk instance to talk to and whether
    sign-in is currently required."""
    return {
        "publishableKey": auth.get_clerk_publishable_key(),
        "authRequired": auth.is_configured(),
    }


@app.post("/api/auth/sync")
def auth_sync(request: Request, db: Session = Depends(get_db)):
    """Called by the frontend right after a successful Clerk sign-in.
    Verifies the token again, fetches the profile from Clerk, and saves/
    updates the local login record ("login info save")."""
    claims = getattr(request.state, "user_claims", None)
    if not claims:
        raise HTTPException(401, "Sign in required.")
    clerk_user_id = claims.get("sub")
    if not clerk_user_id:
        raise HTTPException(400, "Token missing user id.")

    profile = auth.fetch_clerk_user(clerk_user_id)
    email = None
    addresses = profile.get("email_addresses") or []
    if addresses:
        email = addresses[0].get("email_address")
    name = " ".join(filter(None, [profile.get("first_name"), profile.get("last_name")])).strip() or email

    user = db.query(User).filter(User.clerk_user_id == clerk_user_id).first()
    now = datetime.utcnow()
    if not user:
        try:
            user = User(
                clerk_user_id=clerk_user_id,
                email=email,
                name=name,
                image_url=profile.get("image_url"),
                created_at=now,
                last_login_at=now,
                login_count=1,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            return {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "image_url": user.image_url,
                "last_login_at": user.last_login_at.isoformat(),
                "login_count": user.login_count,
            }
        except Exception:
            db.rollback()
            user = db.query(User).filter(User.clerk_user_id == clerk_user_id).first()

    if user:
        user.email = email
        user.name = name
        user.image_url = profile.get("image_url")
        user.last_login_at = now
        user.login_count = (user.login_count or 0) + 1
        db.commit()
        db.refresh(user)

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "image_url": user.image_url,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else now.isoformat(),
        "login_count": user.login_count,
    }


def _refresh_derived_state(db: Session):
    """Rebuild the vector index, relationship graph, and timeline.
    Cheap at prototype scale; runs after every upload so retrieval is always fresh."""
    docs = db.query(Document).all()
    corpus = [
        (d.id, embedding_text_for(d.title, d.category, d.extracted_text, [s.name for s in d.skills]))
        for d in docs
    ]
    store.fit_corpus(corpus)
    relationships.rebuild_relationships(db)
    timeline_mod.rebuild_timeline(db)


def _get_or_create_skill(db: Session, name: str) -> Skill:
    skill = db.query(Skill).filter(Skill.name == name).first()
    if not skill:
        skill = Skill(name=name)
        db.add(skill)
        db.flush()
    return skill


@app.on_event("startup")
def _startup():
    db = next(get_db())
    _refresh_derived_state(db)


# ---------------------------------------------------------------- Module 1: Ingestion
@app.post("/api/upload")
async def upload_document(
    file: UploadFile = File(...),
    doc_date: str = Form(""),
    db: Session = Depends(get_db),
):
    try:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        file_ext = os.path.splitext(file.filename)[1]
        stored_name = f"{uuid.uuid4().hex}{file_ext}"
        stored_path = os.path.join(UPLOAD_DIR, stored_name)

        with open(stored_path, "wb") as out:
            shutil.copyfileobj(file.file, out)

        text = ingestion.extract_text(stored_path, file_ext)
        category, _scores = categorize.categorize(text, file.filename)
        skills_found = categorize.extract_skills(text, file.filename)
        title = categorize.make_title(text, file.filename, category)
        summary = categorize.make_summary(text, category, skills_found)
        date_guess = doc_date.strip() or ingestion.guess_date(text, file.filename)

        doc = Document(
            filename=stored_name,
            original_filename=file.filename,
            filepath=stored_path,
            file_ext=file_ext,
            category=category,
            title=title,
            extracted_text=text,
            doc_date=date_guess,
            summary=summary,
        )
        db.add(doc)
        db.flush()
        for skill_name in skills_found:
            doc.skills.append(_get_or_create_skill(db, skill_name))

        db.commit()
        db.refresh(doc)

        _refresh_derived_state(db)

        return _serialize_doc(doc)
    except Exception as e:
        db.rollback()
        print(f"[Upload Error] Failed to save {file.filename}: {e}")
        raise HTTPException(500, f"Could not save file '{file.filename}': {str(e)}")


@app.post("/api/upload-link")
async def upload_link(
    url: str = Form(...),
    label: str = Form(""),
    doc_date: str = Form(""),
    db: Session = Depends(get_db),
):
    """For portfolio / GitHub links that aren't files."""
    title = label or url
    category, _ = categorize.categorize(url, url)
    if category == "Other":
        category = "Portfolio" if "github" not in url else "Project"
    doc = Document(
        filename="", original_filename=title, filepath="", file_ext="",
        category=category, title=title, extracted_text=url,
        doc_date=doc_date, source_type="link", source_url=url,
        summary=f"[{category}] Linked resource: {url}",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    _refresh_derived_state(db)
    return _serialize_doc(doc)


# ---------------------------------------------------------------- Module 2: Categorized browsing
@app.get("/api/documents")
def list_documents(category: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Document)
    if category:
        q = q.filter(Document.category == category)
    return [_serialize_doc(d) for d in q.order_by(Document.upload_date.desc()).all()]


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: int, db: Session = Depends(get_db)):
    doc = db.query(Document).get(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return _serialize_doc(doc, include_text=True)


@app.get("/api/documents/{doc_id}/file")
def get_document_file(doc_id: int, db: Session = Depends(get_db)):
    doc = db.query(Document).get(doc_id)
    if not doc or not doc.filepath or not os.path.exists(doc.filepath):
        raise HTTPException(404, "Original file not available")
    return FileResponse(doc.filepath, filename=doc.original_filename)


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db)):
    """Remove a document: deletes the stored file from disk (if any) and the
    database record, then rebuilds the derived state (search index, graph,
    timeline) so the removal is reflected everywhere immediately."""
    doc = db.query(Document).get(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    if doc.filepath and os.path.exists(doc.filepath):
        try:
            os.remove(doc.filepath)
        except OSError as e:
            raise HTTPException(500, f"Could not delete file from disk: {e}")

    doc.skills = []  # clear the many-to-many links before deleting the row
    db.delete(doc)
    db.commit()

    _refresh_derived_state(db)
    return {"deleted": True, "id": doc_id}


@app.get("/api/categories")
def category_counts(db: Session = Depends(get_db)):
    docs = db.query(Document).all()
    counts: dict[str, int] = {}
    for d in docs:
        counts[d.category] = counts.get(d.category, 0) + 1
    return counts


# ---------------------------------------------------------------- Module 3: Relationship graph
@app.get("/api/graph")
def graph(db: Session = Depends(get_db)):
    return relationships.get_graph(db)


@app.get("/api/skills")
def skills(db: Session = Depends(get_db)):
    return [{"id": s.id, "name": s.name, "document_count": len(s.documents)}
            for s in db.query(Skill).all()]


# ---------------------------------------------------------------- Module 4: Timeline
@app.get("/api/timeline")
def timeline_endpoint(db: Session = Depends(get_db)):
    return timeline_mod.get_timeline(db)


# ---------------------------------------------------------------- Module 5: Smart retrieval
@app.get("/api/search")
def search(q: str, db: Session = Depends(get_db)):
    results = store.search(q, top_k=10)
    out = []
    for doc_id, score in results:
        doc = db.query(Document).get(doc_id)
        if doc:
            out.append({**_serialize_doc(doc), "relevance": round(score, 3)})
    return out


# ---------------------------------------------------------------- Module 6: World Tech News


def _serialize_doc(doc: Document, include_text: bool = False) -> dict:
    data = {
        "id": doc.id,
        "title": doc.title,
        "original_filename": doc.original_filename,
        "category": doc.category,
        "doc_date": doc.doc_date,
        "upload_date": doc.upload_date.isoformat() if doc.upload_date else None,
        "summary": doc.summary,
        "skills": [s.name for s in doc.skills],
        "source_type": doc.source_type,
        "source_url": doc.source_url,
        "has_file": bool(doc.filepath and os.path.exists(doc.filepath)),
    }
    if include_text:
        data["extracted_text"] = doc.extracted_text
    return data


# ---------------------------------------------------------------- Identity Profile
@app.get("/api/identity")
def identity_profile(db: Session = Depends(get_db)):
    documents = db.query(Document).all()
    # Statistics
    total_documents = len(documents)
    cat_counts = {}
    for d in documents:
        cat_counts[d.category] = cat_counts.get(d.category, 0) + 1

    # Skills aggregation and evidence mapping
    skill_doc_counts = {}
    skill_docs_map = {}
    for d in documents:
        for s in d.skills:
            name = s.name
            skill_doc_counts[name] = skill_doc_counts.get(name, 0) + 1
            skill_docs_map.setdefault(name, []).append({
                "id": d.id,
                "title": d.title or d.original_filename,
                "category": d.category
            })

    total_skills = len(skill_doc_counts)

    # Category-specific collections
    projects = [d for d in documents if d.category == "Project"]
    certifications = [d for d in documents if d.category == "Certification"]
    internships = [d for d in documents if d.category == "Internship"]
    achievements = [d for d in documents if d.category == "Achievement"]
    education = [d for d in documents if d.category == "Academic"]

    def serialize(d):
        return _serialize_doc(d)

    education_out = [serialize(d) for d in education]
    projects_out = [serialize(d) for d in projects]
    certifications_out = [serialize(d) for d in certifications]
    internships_out = [serialize(d) for d in internships]
    achievements_out = [serialize(d) for d in achievements]
    skills_out = [{"name": name, "count": cnt} for name, cnt in sorted(skill_doc_counts.items(), key=lambda x: -x[1])]

    skill_evidence = []
    for name, docs in skill_docs_map.items():
        skill_evidence.append({
            "skill": name,
            "evidence": [{"title": d["title"], "category": d["category"]} for d in docs]
        })

    # Summary generation from existing data
    top_skills = [s[0] for s in sorted(skill_doc_counts.items(), key=lambda x: -x[1])[:3]]
    parts = []
    if total_documents:
        parts.append(f"Your digital identity is built from {total_documents} documents across {len(cat_counts)} categories.")
        if top_skills:
            parts.append(f"Core skills include {', '.join(top_skills)}.")
    if projects:
        parts.append(f"You have {len(projects)} project(s) demonstrating practical experience.")
    if certifications:
        parts.append(f"You hold {len(certifications)} certification(s).")
    if internships:
        parts.append(f"You completed {len(internships)} internship(s).")
    if education:
        parts.append(f"Your education background includes {len(education)} academic record(s).")
    summary = " ".join(parts) if parts else "No documents uploaded yet. Start by uploading certificates, projects, and resumes to build your identity."

    statistics = {
        "total_documents": total_documents,
        "total_skills": total_skills,
        "total_projects": len(projects),
        "total_certifications": len(certifications),
        "total_internships": len(internships),
        "total_achievements": len(achievements),
    }

    connections = relationships.get_graph(db)

    return {
        "summary": summary,
        "education": education_out,
        "skills": skills_out,
        "projects": projects_out,
        "certifications": certifications_out,
        "internships": internships_out,
        "achievements": achievements_out,
        "statistics": statistics,
        "skill_evidence": skill_evidence,
        "connections": connections,
    }


# ---------------------------------------------------------------- Dashboard Aggregator
@app.get("/api/dashboard")
def dashboard_data(db: Session = Depends(get_db)):
    documents = db.query(Document).all()
    # Stats
    total_documents = len(documents)
    skill_doc_counts = {}
    for d in documents:
        for s in d.skills:
            skill_doc_counts[s.name] = skill_doc_counts.get(s.name, 0) + 1
    total_skills = len(skill_doc_counts)
    projects = [d for d in documents if d.category == "Project"]
    certifications = [d for d in documents if d.category == "Certification"]
    internships = [d for d in documents if d.category == "Internship"]
    achievements = [d for d in documents if d.category == "Achievement"]
    education = [d for d in documents if d.category == "Academic"]
    # Relationships summary
    graph = relationships.get_graph(db)
    rel_count = len(graph.get("edges", []))
    # Recent docs
    recent_docs = sorted(documents, key=lambda d: d.upload_date or d.doc_date or "", reverse=True)[:5]
    recent_serialized = [_serialize_doc(d) for d in recent_docs]
    # Profile completeness heuristic
    required_cats = {"Certification", "Project", "Internship", "Academic", "Resume", "Achievement"}
    present_cats = set(d.category for d in documents)
    completeness = int(len(present_cats & required_cats) / len(required_cats) * 100) if required_cats else 0
    # Top skills
    top_skills = sorted(skill_doc_counts.items(), key=lambda x: -x[1])[:5]
    # Skill categories mapping
    cat_map = {
        "Python": "Programming", "Java": "Programming", "C++": "Programming", "JavaScript": "Programming",
        "React": "Web Development", "Node.js": "Web Development", "HTML/CSS": "Web Development",
        "Machine Learning": "AI and Machine Learning", "Deep Learning": "AI and Machine Learning", "NLP": "AI and Machine Learning", "TensorFlow": "AI and Machine Learning", "PyTorch": "AI and Machine Learning", "AI": "AI and Machine Learning",
        "Cybersecurity": "Cybersecurity",
        "AWS": "Cloud", "Docker": "Cloud", "Cloud Computing": "Cloud",
        "SQL": "Databases",
    }
    skills_by_category = {}
    for name, cnt in skill_doc_counts.items():
        cat = cat_map.get(name, "Other")
        skills_by_category.setdefault(cat, []).append({"name": name, "count": cnt})
    # Career insights based on data
    strongest = [n for n, c in top_skills[:3]]
    weak = [n for n, c in skill_doc_counts.items() if c == 1]
    insights = []
    if projects:
        insights.append("You have project evidence for your skills.")
    if certifications:
        insights.append("Certifications strengthen your profile.")
    if weak:
        insights.append(f"Skills with limited evidence: {', '.join(weak[:3])}. Consider adding more documents.")
    if not internships:
        insights.append("Consider adding internship records to improve career readiness.")
    return {
        "stats": {
            "total_documents": total_documents,
            "total_skills": total_skills,
            "projects_completed": len(projects),
            "internships_certifications": len(internships) + len(certifications),
            "achievements": len(achievements),
            "relationships": rel_count
        },
        "identity": {
            "document_count": total_documents,
            "skill_count": total_skills,
            "completeness": completeness,
            "education_count": len(education),
            "top_skills": [n for n, _ in top_skills]
        },
        "skills_by_category": skills_by_category,
        "recent_documents": recent_serialized,
        "timeline": timeline_mod.get_timeline(db),
        "graph_summary": {
            "nodes": len(graph.get("nodes", [])),
            "edges": rel_count
        },
        "insights": insights,
        "recent_skills": [{"name": n, "count": c} for n, c in top_skills]
    }


# ---------------------------------------------------------------- Career Intelligence Engine
@app.post("/api/career/analyze")
def career_analyze(db: Session = Depends(get_db)):
    try:
        return career.run_career_analysis(db)
    except CareerEngineError as e:
        raise HTTPException(400, str(e))


@app.get("/api/career/profile")
def career_profile(db: Session = Depends(get_db)):
    report = career.get_latest_analysis(db)
    if not report:
        raise HTTPException(404, "No career analysis yet. Run one from the Career tab.")
    return report


@app.post("/api/career/copilot")
def career_copilot(question: str = Form(...), db: Session = Depends(get_db)):
    try:
        answer = career.copilot_chat(db, question)
        return {"answer": answer}
    except CareerEngineError as e:
        raise HTTPException(400, str(e))


@app.post("/api/career/job-match")
def career_job_match(job_description: str = Form(...), db: Session = Depends(get_db)):
    try:
        return career.match_job_description(db, job_description)
    except CareerEngineError as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------- World Tech News
@app.get("/api/news")
def get_news(category: str = "All", search: str = "", db: Session = Depends(get_db)):
    try:
        articles = news.fetch_news(category=category if category != "All" else None, search=search or None, limit=60)
        user_skills = news.get_user_skills(db)
        articles = news.personalize_articles(articles, user_skills)
        # Transform to frontend expected shape
        out_articles = []
        for a in articles:
            out_articles.append({
                "title": a.get("title"),
                "summary": a.get("summary"),
                "source": a.get("source"),
                "pub_date": a.get("published"),
                "category": a.get("category"),
                "link": a.get("url"),
                "image": a.get("image"),
                "related_skills": a.get("related_skills", []),
                "why_relevant": a.get("why_relevant", ""),
                "is_personalized": len(a.get("related_skills", [])) > 0,
            })
        # Add last updated timestamp from cache if available
        import time as _time
        last_updated = news._CACHE.get("timestamp", 0)
        if last_updated:
            last_updated_iso = _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime(last_updated))
        else:
            last_updated_iso = None
        return {
            "articles": out_articles,
            "user_skills": user_skills,
            "category": category,
            "search": search,
            "source_status": "ok" if out_articles else "no_articles",
            "last_updated": last_updated_iso,
            "total_articles": len(out_articles),
        }
    except Exception as e:
        # Graceful failure: return setup message instead of crashing
        return {
            "articles": [],
            "user_skills": [],
            "category": category,
            "search": search,
            "source_status": "error",
            "message": f"News source unavailable. Configure NEWS_RSS_URLS or check internet connection. Error: {str(e)}"
        }


# ---------------------------------------------------------------- Serve frontend
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
