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

from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import json
from sqlalchemy.orm import Session

from database import init_db, get_db, UPLOAD_DIR, BASE_DIR
from models import Document, Skill, User, SavedResume
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
import llm
import hackathons
import resume
import resume_pdf
import skills_research


app = FastAPI(title="AI Digital Identity System")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

init_db()


@app.get("/health")
def health_check():
    return {"status": "ok"}


def _seed_file(filepath: str, original_filename: str, db: Session):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    file_ext = os.path.splitext(original_filename)[1]
    stored_name = f"{uuid.uuid4().hex}{file_ext}"
    stored_path = os.path.join(UPLOAD_DIR, stored_name)
    shutil.copyfile(filepath, stored_path)

    text = ingestion.extract_text(stored_path, file_ext)
    category, _scores = categorize.categorize(text, original_filename)
    skills_found = categorize.extract_skills(text, original_filename)
    title = categorize.make_title(text, original_filename, category)
    summary = categorize.make_summary(text, category, skills_found)
    date_guess = ingestion.guess_date(text, original_filename)

    doc = Document(
        filename=stored_name,
        original_filename=original_filename,
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
    return doc


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
                            doc = _seed_file(filepath, filename, db)
                            print(f"[startup] Seeded {filename} -> {doc.category}")
                        except Exception as ex:
                            print(f"[startup] Failed to seed {filename}: {ex}")
            _refresh_derived_state(db)
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


@app.post("/api/auth/demo-login")
def demo_login(db: Session = Depends(get_db)):
    """Authenticate into the Demo Account with preloaded sample credentials."""
    demo_clerk_id = "user_demo_ledger_2026"
    now = datetime.utcnow()
    user = db.query(User).filter(User.clerk_user_id == demo_clerk_id).first()
    if not user:
        user = User(
            clerk_user_id=demo_clerk_id,
            email="demo@ledger.ai",
            name="Harshan Seliyan",
            image_url="https://ui-avatars.com/api/?name=Harshan+Seliyan&background=d2a24a&color=0B0E13",
            created_at=now,
            last_login_at=now,
            login_count=1,
        )
        db.add(user)
    else:
        user.last_login_at = now
        user.login_count = (user.login_count or 0) + 1
    db.commit()
    db.refresh(user)

    # Ensure sample documents are loaded if database is empty
    if db.query(Document).count() == 0:
        sample_dir = os.path.join(BASE_DIR, "sample_data")
        if os.path.exists(sample_dir):
            for filename in sorted(os.listdir(sample_dir)):
                filepath = os.path.join(sample_dir, filename)
                if os.path.isfile(filepath) and not filename.startswith("."):
                    try:
                        _seed_file(filepath, filename, db)
                    except Exception as ex:
                        print(f"[demo] Failed to seed {filename}: {ex}")
        _refresh_derived_state(db)

    doc_count = db.query(Document).count()
    skill_count = db.query(Skill).count()

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "image_url": user.image_url,
        "is_demo": True,
        "token": "demo-token-session-2026",
        "last_login_at": user.last_login_at.isoformat(),
        "login_count": user.login_count,
        "document_count": doc_count,
        "skills_count": skill_count,
        "message": "Demo account loaded with preloaded sample data."
    }


@app.post("/api/demo/reset-sample-data")
def demo_reset_sample_data(db: Session = Depends(get_db)):
    """Reset the database to clean sample data from sample_data/ directory."""
    try:
        from models import TimelineEvent, KnowledgeRelationship, document_skills, CareerAnalysis, SavedResume
        db.query(TimelineEvent).delete()
        db.query(KnowledgeRelationship).delete()
        db.execute(document_skills.delete())
        db.query(Document).delete()
        db.query(Skill).delete()
        db.query(CareerAnalysis).delete()
        db.query(SavedResume).delete()
        db.commit()

        sample_dir = os.path.join(BASE_DIR, "sample_data")
        seeded = 0
        if os.path.exists(sample_dir):
            for filename in sorted(os.listdir(sample_dir)):
                filepath = os.path.join(sample_dir, filename)
                if os.path.isfile(filepath) and not filename.startswith("."):
                    try:
                        _seed_file(filepath, filename, db)
                        seeded += 1
                    except Exception as ex:
                        print(f"[demo] Failed to seed {filename}: {ex}")

        _refresh_derived_state(db)
        doc_count = db.query(Document).count()
        skill_count = db.query(Skill).count()

        return {
            "status": "ok",
            "seeded_files": seeded,
            "document_count": doc_count,
            "skills_count": skill_count,
            "message": "Sample data reset and derived states refreshed."
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Failed to reset sample data: {e}")



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


# ---------------------------------------------------------------- Hackathon Intelligence
@app.get("/api/hackathons")
def get_hackathons(
    category: str = "All",
    country: str = "All",
    mode: str = "All",
    search: str = "",
    technology: str = "All",
    sort: str = "best_match",
    limit: int = 50,
    db: Session = Depends(get_db)
):
    try:
        results = hackathons.search_hackathons(
            db=db,
            category=category if category != "All" else None,
            country=country if country != "All" else None,
            mode=mode if mode != "All" else None,
            search=search or None,
            technology=technology if technology != "All" else None,
            sort=sort,
            limit=limit,
        )
        cache_info = hackathons.get_cache_info()
        return {
            "hackathons": results,
            "total": len(results),
            "last_updated": cache_info["last_updated"],
            "source_status": "ok",
        }
    except Exception as e:
        return {
            "hackathons": [],
            "total": 0,
            "last_updated": None,
            "source_status": "error",
            "message": f"Hackathon sources temporarily unavailable: {str(e)}",
        }


@app.get("/api/hackathons/recommended")
def get_recommended_hackathons_endpoint(limit: int = 5, db: Session = Depends(get_db)):
    try:
        recs = hackathons.get_recommended_hackathons(db=db, limit=limit)
        cache_info = hackathons.get_cache_info()
        user_ctx = hackathons.get_user_identity_context(db)
        return {
            "hackathons": recs,
            "total": len(recs),
            "user_skills": user_ctx.get("skills", []),
            "last_updated": cache_info["last_updated"],
            "source_status": "ok",
        }
    except Exception as e:
        return {
            "hackathons": [],
            "total": 0,
            "user_skills": [],
            "last_updated": None,
            "source_status": "error",
            "message": f"Could not compute recommendations: {str(e)}",
        }


@app.post("/api/hackathons/refresh")
def refresh_hackathons(db: Session = Depends(get_db)):
    try:
        hackathons.fetch_all_hackathons(force_refresh=True)
        cache_info = hackathons.get_cache_info()
        return {"status": "ok", "count": cache_info["count"], "last_updated": cache_info["last_updated"]}
    except Exception as e:
        raise HTTPException(500, f"Refresh failed: {e}")


@app.get("/api/hackathons/web-search")
def web_search_hackathons_endpoint(q: str = "", limit: int = 30, db: Session = Depends(get_db)):
    """Live on-demand web search for hackathons matching any custom query across Google indexes."""
    try:
        results = hackathons.web_search_hackathons_live(db=db, query=q, limit=limit)
        return {
            "hackathons": results,
            "total": len(results),
            "query": q,
            "source_status": "ok",
        }
    except Exception as e:
        return {
            "hackathons": [],
            "total": 0,
            "query": q,
            "source_status": "error",
            "message": f"Web search failed: {str(e)}",
        }


@app.get("/api/skills/trending-today")
def get_trending_skills_today_endpoint(db: Session = Depends(get_db)):
    """Live web-researched trending tech skills and personal identity alignment."""
    try:
        data = skills_research.get_trending_skills_intelligence(db=db)
        return data
    except Exception as e:
        return {
            "trending_skills": [],
            "verified_matches": [],
            "upskill_recommendations": [],
            "source_status": "error",
            "message": f"Trending skills research unavailable: {str(e)}"
        }



#
# ---------------------------------------------------------------- Optional LLM Chat
@app.post("/api/llm")
def llm_chat(message: str = Form(...), history: str = Form(""), db: Session = Depends(get_db)):
    """Call NVIDIA LLM for a chat-style response.
    Requires NVIDIA_API_KEY in environment variable.
    Returns the model's reply or a clear message if not configured."""
    from llm import _is_configured as llm_configured
    if not llm_configured():
        return JSONResponse(status_code=200, content={"reply": "LLM not configured. Set NVIDIA_API_KEY in .env to enable.", "raw": None})
    # Build messages list
    messages = [{"role": "user", "content": message}]
    if history.strip():
        for line in history.split("\n"):
            line = line.strip()
            if line.lower().startswith("user:"):
                messages.append({"role": "user", "content": line[5:].strip()})
            elif line.lower().startswith("assistant:"):
                messages.append({"role": "assistant", "content": line[10:].strip()})
    result = llm.call_llm(messages)
    if not result:
        return JSONResponse(status_code=200, content={"reply": "Failed to get LLM response. Check server logs.", "raw": None})
    return {"reply": result.get("reply"), "raw": result.get("raw")}


# ---------------------------------------------------------------- Resume Creator Engine
class ResumeSaveRequest(BaseModel):
    target: Optional[str] = "General"
    template: Optional[str] = "minimal_professional"
    resume_data: Dict[str, Any]


class ResumeGenerateRequest(BaseModel):
    resume_data: Dict[str, Any]


@app.get("/api/resume/data")
def get_resume_data(
    target: str = "General",
    template: str = "minimal_professional",
    db: Session = Depends(get_db)
):
    """
    Returns the user's available resume information automatically extracted
    from their digital identity archive, along with available templates,
    target modes, and deep skill intelligence.
    """
    data = resume.build_initial_resume_data(db, target=target, template=template)
    skill_intel = resume.get_skill_intelligence(db)
    quality = resume.analyze_resume_quality(data)
    return {
        "resume": data,
        "templates": resume.AVAILABLE_TEMPLATES,
        "target_modes": resume.TARGET_MODES,
        "skill_intelligence": skill_intel,
        "analysis": quality,
    }


@app.get("/api/resume/templates")
def get_resume_templates():
    """Returns available resume templates and target modes."""
    return {
        "templates": resume.AVAILABLE_TEMPLATES,
        "target_modes": resume.TARGET_MODES
    }


@app.post("/api/resume/preview")
def preview_resume(req: ResumeGenerateRequest, db: Session = Depends(get_db)):
    """Validates resume data and returns quality analysis for live preview."""
    quality = resume.analyze_resume_quality(req.resume_data)
    return {
        "resume": req.resume_data,
        "analysis": quality
    }


@app.post("/api/resume/save")
def save_resume_endpoint(req: ResumeSaveRequest, request: Request, db: Session = Depends(get_db)):
    """Saves the user's edited resume configuration and custom tweaks."""
    claims = getattr(request.state, "user_claims", None)
    user_id = claims.get("sub", "default") if claims else "default"
    
    saved = db.query(SavedResume).filter(SavedResume.user_id == user_id).first()
    json_str = json.dumps(req.resume_data)
    now = datetime.utcnow()
    target_mode = req.target or req.resume_data.get("target", "General")
    template_id = req.template or req.resume_data.get("template", "minimal_professional")
    
    if not saved:
        saved = SavedResume(
            user_id=user_id,
            target=target_mode,
            template=template_id,
            resume_data=json_str,
            updated_at=now
        )
        db.add(saved)
    else:
        saved.target = target_mode
        saved.template = template_id
        saved.resume_data = json_str
        saved.updated_at = now
    db.commit()
    db.refresh(saved)
    return {
        "status": "ok",
        "saved": True,
        "updated_at": saved.updated_at.isoformat()
    }


@app.post("/api/resume/generate")
def generate_resume_endpoint(req: ResumeGenerateRequest):
    """
    Generates an authentic A4 PDF resume with selectable text, clickable links,
    and ATS-compliant formatting using ReportLab.
    """
    try:
        pdf_bytes = resume_pdf.generate_resume_pdf(req.resume_data)
        candidate_name = req.resume_data.get("personal", {}).get("name", "Resume").strip() or "Resume"
        safe_name = "".join(c for c in candidate_name if c.isalnum() or c in (" ", "_", "-")).strip().replace(" ", "_")
        filename = f"{safe_name}_Resume.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Type": "application/pdf"
            }
        )
    except Exception as e:
        raise HTTPException(500, f"PDF generation failed: {str(e)}")


@app.get("/api/resume/download")
def download_resume_get(
    target: str = "General",
    template: str = "minimal_professional",
    db: Session = Depends(get_db)
):
    """
    Direct GET download endpoint for the resume PDF.
    Generates authentic PDF directly for browser download or navigation.
    """
    try:
        draft = db.query(SavedResume).order_by(SavedResume.updated_at.desc()).first()
        if draft and draft.resume_data:
            try:
                resume_data = json.loads(draft.resume_data)
                if template:
                    resume_data["template"] = template
                if target:
                    resume_data["target"] = target
            except Exception:
                resume_data = resume.build_initial_resume_data(db, target=target, template=template)
        else:
            resume_data = resume.build_initial_resume_data(db, target=target, template=template)

        pdf_bytes = resume_pdf.generate_resume_pdf(resume_data)
        candidate_name = resume_data.get("personal", {}).get("name", "Resume").strip() or "Resume"
        safe_name = "".join(c for c in candidate_name if c.isalnum() or c in (" ", "_", "-")).strip().replace(" ", "_")
        filename = f"{safe_name}_Resume.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Type": "application/pdf"
            }
        )
    except Exception as e:
        raise HTTPException(500, f"PDF download failed: {str(e)}")


@app.post("/api/resume/analyze")
def analyze_resume_endpoint(req: ResumeGenerateRequest):
    """Runs ATS compatibility, completeness, and action verbs checker."""
    return resume.analyze_resume_quality(req.resume_data)


# ---------------------------------------------------------------- Serve frontend
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

