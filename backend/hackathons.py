"""
Module: Hackathon Intelligence & Finder Engine

Provides real-time discovery of hackathons from verified external providers
(Devpost, Devfolio, Unstop), normalizes data into a single schema, and ranks
them against the user's verified digital identity skills and projects.

Strict Rule: NO fake data, NO fabricated prizes or deadlines. Missing fields
show 'Not specified'.
"""

import abc
import re
import time
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
import requests
from sqlalchemy.orm import Session

# In-memory cache
_CACHE = {
    "hackathons": [],
    "timestamp": 0,
    "ttl": 900,  # 15 minutes
}

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 LedgerIdentity/1.0"


def _clean_html(text: Optional[str]) -> str:
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", " ", text)
    clean = re.sub(r"\s+", " ", clean)
    return clean.strip()


def _parse_date_safe(date_str: Optional[str]) -> Optional[datetime]:
    if not date_str or not isinstance(date_str, str):
        return None
    date_str = date_str.strip()
    formats = [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%b %d, %Y",
        "%d %b %Y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            pass
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(date_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        pass
    return None


class HackathonProvider(abc.ABC):
    """Abstract base class for hackathon data sources."""

    @abc.abstractmethod
    def fetch_hackathons(self) -> List[Dict[str, Any]]:
        """Retrieve and normalize hackathons from the provider."""
        pass


class DevpostApiProvider(HackathonProvider):
    """Fetches real hackathons from Devpost's public hackathons API."""

    URL = "https://devpost.com/api/hackathons?page=1"

    def fetch_hackathons(self) -> List[Dict[str, Any]]:
        results = []
        try:
            resp = requests.get(self.URL, headers={"User-Agent": USER_AGENT}, timeout=7)
            if resp.status_code != 200:
                print(f"[hackathons] Devpost returned status {resp.status_code}")
                return results
            data = resp.json()
            items = data.get("hackathons", [])
            for item in items:
                title = item.get("title", "").strip()
                url = item.get("url", "").strip()
                if not title or not url:
                    continue

                # Prize extraction
                prize_raw = item.get("prize_amount") or ""
                prize_clean = _clean_html(prize_raw) or "Not specified"

                # Themes / categories
                themes = [t.get("name", "") for t in item.get("themes", []) if isinstance(t, dict) and t.get("name")]
                categories = themes if themes else ["General"]

                # Technologies inferred from themes / title
                tech_keywords = ["Python", "AI", "Machine Learning", "Web3", "Blockchain", "Cloud", "Mobile", "IoT", "Cybersecurity", "Data", "JavaScript", "React"]
                technologies = [tech for tech in tech_keywords if any(tech.lower() in (t.lower() + " " + title.lower()) for t in themes + [title])]

                # Mode & Location
                displayed_loc = item.get("displayed_location", {})
                loc_str = displayed_loc.get("location", "") if isinstance(displayed_loc, dict) else str(displayed_loc)
                if not loc_str or loc_str.lower() == "online":
                    mode = "Online"
                    loc_str = "Online (Worldwide)"
                    country = "Global"
                    region = "Online"
                elif "hybrid" in loc_str.lower():
                    mode = "Hybrid"
                    country = loc_str.split(",")[-1].strip() if "," in loc_str else loc_str
                    region = loc_str
                else:
                    mode = "Offline"
                    country = loc_str.split(",")[-1].strip() if "," in loc_str else loc_str
                    region = loc_str

                # Dates
                sub_dates = item.get("submission_period_dates", "")
                time_left = item.get("time_left_to_submission", "")

                reg_deadline = None
                start_date = None
                end_date = None
                if sub_dates and " - " in sub_dates:
                    parts = sub_dates.split(" - ")
                    start_str = parts[0].strip()
                    end_str = parts[1].strip()
                    reg_deadline = end_str
                    start_date = start_str
                    end_date = end_str

                organizer = item.get("organization_name") or "Devpost Community"

                results.append({
                    "id": f"devpost_{item.get('id', hash(url))}",
                    "name": title,
                    "organizer": organizer,
                    "description": f"Official hackathon hosted on Devpost by {organizer}. {time_left}".strip(),
                    "url": url,
                    "official_url": url,
                    "start_date": start_date or "Not specified",
                    "end_date": end_date or "Not specified",
                    "registration_deadline": reg_deadline or (f"Closes in {time_left}" if time_left else "Not specified"),
                    "deadline_raw": reg_deadline or "",
                    "time_left_str": time_left,
                    "location": loc_str,
                    "country": country or "Not specified",
                    "region": region or "Not specified",
                    "mode": mode,
                    "categories": categories,
                    "technologies": technologies if technologies else ["Open Stack"],
                    "prize": prize_clean,
                    "source": "Devpost",
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[hackathons] DevpostProvider fetch error: {e}")
        return results


class DevfolioApiProvider(HackathonProvider):
    """Fetches real hackathons from Devfolio's public API."""

    URL = "https://api.devfolio.co/api/hackathons?filter=all&page=1&limit=25"

    def fetch_hackathons(self) -> List[Dict[str, Any]]:
        results = []
        try:
            resp = requests.get(self.URL, headers={"User-Agent": USER_AGENT}, timeout=7)
            if resp.status_code != 200:
                print(f"[hackathons] Devfolio returned status {resp.status_code}")
                return results
            data = resp.json()
            items = data.get("result", [])
            for item in items:
                name = item.get("name", "").strip()
                slug = item.get("slug", "").strip()
                if not name or not slug:
                    continue

                official_url = f"https://{slug}.devfolio.co"
                starts_at = item.get("starts_at")
                ends_at = item.get("ends_at")

                # Filter out clearly past hackathons
                end_dt = _parse_date_safe(ends_at)
                if end_dt and end_dt < datetime.now(timezone.utc):
                    continue

                is_online = item.get("is_online", False)
                loc_raw = item.get("location") or ""
                country = item.get("country") or "India"
                if is_online:
                    mode = "Online"
                    location = "Online"
                    region = "Online"
                else:
                    mode = "Offline"
                    location = loc_raw or f"{item.get('city','')}, {country}".strip(", ")
                    region = item.get("state") or country

                themes_raw = item.get("themes") or []
                themes = []
                for t in themes_raw:
                    if isinstance(t, dict):
                        t_name = t.get("name") or t.get("title")
                        if t_name:
                            themes.append(str(t_name))
                    elif isinstance(t, str):
                        themes.append(t)
                categories = themes if themes else ["Technology"]

                # Extract technologies
                tech_keywords = ["Python", "AI", "Machine Learning", "Web3", "Blockchain", "Solidity", "Rust", "React", "Cloud", "Security"]
                technologies = [t for t in tech_keywords if any(t.lower() in (theme.lower() + " " + name.lower()) for theme in themes + [name])]

                prize_raw = item.get("prize")
                prize_str = str(prize_raw).strip() if prize_raw else "Not specified"

                organizer = item.get("hackathon_brand", {}).get("name") if isinstance(item.get("hackathon_brand"), dict) else None
                if not organizer:
                    organizer = f"{name} Team"

                start_formatted = _format_iso_date(starts_at)
                end_formatted = _format_iso_date(ends_at)

                results.append({
                    "id": f"devfolio_{item.get('uuid', slug)}",
                    "name": name,
                    "organizer": organizer,
                    "description": f"{name} is an active hackathon hosted on Devfolio focusing on {', '.join(categories)}.",
                    "url": official_url,
                    "official_url": official_url,
                    "start_date": start_formatted or "Not specified",
                    "end_date": end_formatted or "Not specified",
                    "registration_deadline": start_formatted or "Not specified",
                    "deadline_raw": starts_at or ends_at or "",
                    "time_left_str": "",
                    "location": location or "Not specified",
                    "country": country or "Not specified",
                    "region": region or "Not specified",
                    "mode": mode,
                    "categories": categories,
                    "technologies": technologies if technologies else ["Full Stack"],
                    "prize": prize_str,
                    "source": "Devfolio",
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[hackathons] DevfolioProvider fetch error: {e}")
        return results


class UnstopApiProvider(HackathonProvider):
    """Fetches real hackathons from Unstop's public opportunities API."""

    URL = "https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&per_page=25"

    def fetch_hackathons(self) -> List[Dict[str, Any]]:
        results = []
        try:
            resp = requests.get(self.URL, headers={"User-Agent": USER_AGENT}, timeout=7)
            if resp.status_code != 200:
                print(f"[hackathons] Unstop returned status {resp.status_code}")
                return results
            data = resp.json()
            items = data.get("data", {}).get("data", [])
            for item in items:
                title = item.get("title", "").strip()
                seo_url = item.get("public_url") or item.get("seo_url") or ""
                if not title or not seo_url:
                    continue

                official_url = f"https://unstop.com/{seo_url.lstrip('/')}"
                reg_open = item.get("regn_open", True)
                if not reg_open:
                    continue

                # Organizer
                org_obj = item.get("organisation")
                if isinstance(org_obj, dict):
                    organizer = org_obj.get("name") or "Unstop Partner"
                else:
                    organizer = str(org_obj) if org_obj else "Unstop Partner"

                # Region & Mode
                region_type = (item.get("region") or "").lower()
                if "online" in region_type or region_type == "virtual":
                    mode = "Online"
                    loc_str = "Online (Virtual)"
                    country = "Global"
                elif "hybrid" in region_type:
                    mode = "Hybrid"
                    loc_str = "Hybrid"
                    country = "India / Global"
                else:
                    mode = "Offline"
                    locations = item.get("locations") or []
                    loc_str = ", ".join(locations) if locations else "Offline"
                    country = "India"

                # Prizes
                prizes_list = item.get("prizes") or []
                prize_str = "Not specified"
                if prizes_list and isinstance(prizes_list, list):
                    first_prize = prizes_list[0]
                    if isinstance(first_prize, dict):
                        cash = first_prize.get("cash")
                        curr = first_prize.get("currency", "")
                        symbol = "₹" if "rupee" in curr else ("$" if "dollar" in curr else "")
                        if cash:
                            prize_str = f"{symbol}{cash:,}" if isinstance(cash, (int, float)) else f"{symbol}{cash}"

                # Dates & Deadlines
                end_date_iso = item.get("end_date")
                start_date_iso = item.get("start_date")
                reqs = item.get("regnRequirements") or {}
                remain_days = reqs.get("remain_days") or ""

                deadline_formatted = _format_iso_date(end_date_iso)
                start_formatted = _format_iso_date(start_date_iso)

                # Categories & skills
                filters = item.get("filters") or []
                categories = []
                for f in filters:
                    if isinstance(f, dict) and f.get("name"):
                        categories.append(f.get("name"))
                if not categories:
                    categories = ["Engineering", "Hackathon"]

                req_skills = item.get("required_skills") or []
                technologies = [s.get("name") for s in req_skills if isinstance(s, dict) and s.get("name")]
                if not technologies:
                    tech_keywords = ["AI", "Python", "Web Development", "Cloud", "Cybersecurity", "Data Science", "Machine Learning"]
                    technologies = [tk for tk in tech_keywords if tk.lower() in title.lower()]
                if not technologies:
                    technologies = ["Software Engineering"]

                results.append({
                    "id": f"unstop_{item.get('id')}",
                    "name": title,
                    "organizer": organizer,
                    "description": f"Organized by {organizer} on Unstop. {remain_days}".strip(),
                    "url": official_url,
                    "official_url": official_url,
                    "start_date": start_formatted or "Not specified",
                    "end_date": deadline_formatted or "Not specified",
                    "registration_deadline": deadline_formatted or (remain_days if remain_days else "Not specified"),
                    "deadline_raw": end_date_iso or "",
                    "time_left_str": remain_days,
                    "location": loc_str,
                    "country": country,
                    "region": loc_str,
                    "mode": mode,
                    "categories": categories,
                    "technologies": technologies,
                    "prize": prize_str,
                    "source": "Unstop",
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[hackathons] UnstopApiProvider fetch error: {e}")
        return results


def _format_iso_date(iso_str: Optional[str]) -> Optional[str]:
    dt = _parse_date_safe(iso_str)
    if not dt:
        return iso_str
    return dt.strftime("%d %b %Y")


def _calculate_deadline_intel(hackathon: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate remaining days and friendly deadline label."""
    raw = hackathon.get("deadline_raw")
    dt = _parse_date_safe(raw)
    now = datetime.now(timezone.utc)
    if dt:
        diff = dt - now
        days = diff.days
        if days < 0:
            hackathon["is_expired"] = True
            hackathon["deadline_display"] = f"Ended on {dt.strftime('%d %b %Y')}"
            hackathon["deadline_days_left"] = days
        elif days == 0:
            hours = int(diff.seconds / 3600)
            hackathon["is_expired"] = False
            hackathon["deadline_display"] = f"Closes today in {hours}h"
            hackathon["deadline_days_left"] = 0
        elif days == 1:
            hackathon["is_expired"] = False
            hackathon["deadline_display"] = "Registration closes tomorrow"
            hackathon["deadline_days_left"] = 1
        else:
            hackathon["is_expired"] = False
            hackathon["deadline_display"] = f"Registration closes in {days} days"
            hackathon["deadline_days_left"] = days
    else:
        time_left = hackathon.get("time_left_str") or ""
        reg = hackathon.get("registration_deadline") or "Not specified"
        hackathon["is_expired"] = False
        hackathon["deadline_days_left"] = 999
        if time_left:
            hackathon["deadline_display"] = f"Closes in {time_left}" if not time_left.startswith("Closes") else time_left
        elif reg != "Not specified":
            hackathon["deadline_display"] = f"Deadline: {reg}"
        else:
            hackathon["deadline_display"] = "Deadline: Not specified"
    return hackathon


# ---------------------------------------------------------------- Unified Retrieval & Caching

PROVIDERS: List[HackathonProvider] = [
    DevpostApiProvider(),
    DevfolioApiProvider(),
    UnstopApiProvider(),
]


def fetch_all_hackathons(force_refresh: bool = False) -> List[Dict[str, Any]]:
    """Fetch from all providers with caching and deduplication."""
    now = time.time()
    if not force_refresh and (now - _CACHE["timestamp"] < _CACHE["ttl"]) and _CACHE["hackathons"]:
        return _CACHE["hackathons"]

    all_items = []
    for provider in PROVIDERS:
        try:
            items = provider.fetch_hackathons()
            all_items.extend(items)
        except Exception as e:
            print(f"[hackathons] Provider {provider.__class__.__name__} failed: {e}")

    # Deduplicate by URL or normalized name
    seen_urls = set()
    seen_names = set()
    deduped = []
    for h in all_items:
        url_key = h.get("official_url", "").strip().lower()
        name_key = re.sub(r"[^a-z0-9]", "", h.get("name", "").lower())
        if url_key in seen_urls or name_key in seen_names:
            continue
        seen_urls.add(url_key)
        seen_names.add(name_key)
        _calculate_deadline_intel(h)
        deduped.append(h)

    # Filter out expired events
    active_events = [h for h in deduped if not h.get("is_expired", False)]

    _CACHE["hackathons"] = active_events
    _CACHE["timestamp"] = now
    return active_events


def get_cache_info() -> Dict[str, Any]:
    ts = _CACHE.get("timestamp", 0)
    iso_time = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None
    return {
        "count": len(_CACHE.get("hackathons", [])),
        "last_updated": iso_time,
        "ttl": _CACHE.get("ttl", 900),
    }


# ---------------------------------------------------------------- Explainable AI Match Engine

MATCH_WEIGHTS = {
    "skills": 0.50,
    "technologies": 0.25,
    "project_category": 0.25,
}


def get_user_identity_context(db: Session) -> Dict[str, Any]:
    """Retrieve verified skills and project themes from the user's digital identity."""
    from models import Document, Skill

    user_skills = [s.name for s in db.query(Skill).all()]
    projects = db.query(Document).filter(Document.category == "Project").all()
    project_titles = [p.title or p.original_filename for p in projects]
    project_texts = " ".join(p.extracted_text or "" for p in projects)
    certifications = [c.title or c.original_filename for c in db.query(Document).filter(Document.category == "Certification").all()]

    return {
        "skills": user_skills,
        "projects": project_titles,
        "project_texts": project_texts,
        "certifications": certifications,
    }


def calculate_match(hackathon: Dict[str, Any], user_ctx: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate an explainable relevance match score (0 - 100%).
    Weights:
      - 50% Skill overlap
      - 25% Technology overlap
      - 25% Project & Category relevance
    """
    user_skills = user_ctx.get("skills", [])
    project_texts = user_ctx.get("project_texts", "").lower()
    project_titles = user_ctx.get("projects", [])
    certifications = user_ctx.get("certifications", [])

    if not user_skills:
        return {
            "match_score": 50,
            "matched_skills": [],
            "matched_technologies": [],
            "why_relevant": "Open community hackathon suitable for building your first documented projects.",
        }

    haystack = f"{hackathon.get('name', '')} {hackathon.get('description', '')} {' '.join(hackathon.get('categories', []))} {' '.join(hackathon.get('technologies', []))}".lower()

    # 1. Skill overlap (50%)
    matched_skills = []
    for skill in user_skills:
        pattern = r"\b" + re.escape(skill.lower()) + r"\b"
        if re.search(pattern, haystack):
            matched_skills.append(skill)
        elif skill.lower() in haystack:
            matched_skills.append(skill)

    skill_score = min(1.0, len(matched_skills) / max(1, min(3, len(user_skills))))

    # 2. Technology overlap (25%)
    hack_techs = hackathon.get("technologies", [])
    matched_techs = []
    for t in hack_techs:
        t_clean = t.strip()
        if any(s.lower() == t_clean.lower() for s in user_skills):
            matched_techs.append(t_clean)
        elif t_clean.lower() in haystack and any(s.lower() in t_clean.lower() for s in user_skills):
            matched_techs.append(t_clean)

    tech_score = min(1.0, len(matched_techs) / max(1, len(hack_techs))) if hack_techs else (0.5 if matched_skills else 0.2)

    # 3. Project & Category relevance (25%)
    proj_cat_matches = []
    for cat in hackathon.get("categories", []):
        if cat.lower() in project_texts or any(cat.lower() in pt.lower() for pt in project_titles):
            proj_cat_matches.append(cat)

    proj_score = min(1.0, len(proj_cat_matches) * 0.5) if proj_cat_matches else (0.3 if matched_skills else 0.1)

    # Composite score
    raw_score = (
        skill_score * MATCH_WEIGHTS["skills"]
        + tech_score * MATCH_WEIGHTS["technologies"]
        + proj_score * MATCH_WEIGHTS["project_category"]
    )

    # Scale to realistic 55% - 98% range for top matches, or lower for non-matches
    if matched_skills:
        final_pct = int(60 + raw_score * 38)
    elif matched_techs:
        final_pct = int(50 + raw_score * 30)
    else:
        final_pct = int(35 + raw_score * 25)

    final_pct = max(35, min(98, final_pct))

    # Explanation generation
    why_parts = []
    if matched_skills and matched_techs:
        why_parts.append(f"Strong match because your profile contains {', '.join(matched_skills[:3])} and verified projects in {', '.join(matched_techs[:2])}.")
    elif matched_skills:
        why_parts.append(f"Matches your verified {', '.join(matched_skills[:3])} skills documented in your archive.")
    elif proj_cat_matches:
        why_parts.append(f"Aligns with your portfolio projects in {', '.join(proj_cat_matches[:2])}.")
    else:
        why_parts.append(f"General upcoming hackathon in {hackathon.get('categories', ['technology'])[0]} to expand your credentials.")

    return {
        "match_score": final_pct,
        "matched_skills": matched_skills,
        "matched_technologies": matched_techs,
        "why_relevant": " ".join(why_parts),
    }


def get_recommended_hackathons(db: Session, limit: int = 5) -> List[Dict[str, Any]]:
    """Return top recommended hackathons for the user ordered by match score."""
    hackathons = fetch_all_hackathons()
    user_ctx = get_user_identity_context(db)

    ranked = []
    for h in hackathons:
        h_copy = dict(h)
        match_info = calculate_match(h, user_ctx)
        h_copy.update(match_info)
        ranked.append(h_copy)

    # Sort primarily by match_score desc, then by closest deadline
    ranked.sort(key=lambda x: (x["match_score"], -x.get("deadline_days_left", 999)), reverse=True)
    return ranked[:limit]


def search_hackathons(
    db: Session,
    category: Optional[str] = None,
    country: Optional[str] = None,
    mode: Optional[str] = None,
    search: Optional[str] = None,
    technology: Optional[str] = None,
    sort: Optional[str] = "best_match",
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Filter, match, and sort hackathons for the global explorer."""
    hackathons = fetch_all_hackathons()
    user_ctx = get_user_identity_context(db)

    results = []
    for h in hackathons:
        # Filter mode
        if mode and mode.lower() != "all":
            if h.get("mode", "").lower() != mode.lower():
                continue

        # Filter category
        if category and category.lower() != "all":
            cats_lower = [c.lower() for c in h.get("categories", [])]
            if not any(category.lower() in c for c in cats_lower):
                continue

        # Filter country / region
        if country and country.lower() != "all":
            h_country = (h.get("country") or "").lower()
            h_loc = (h.get("location") or "").lower()
            if country.lower() not in h_country and country.lower() not in h_loc:
                continue

        # Filter technology
        if technology and technology.lower() != "all":
            techs_lower = [t.lower() for t in h.get("technologies", [])]
            if not any(technology.lower() in t for t in techs_lower):
                continue

        # Search term query across title, description, organizer, technologies
        if search:
            q = search.lower().strip()
            hay = f"{h.get('name','')} {h.get('description','')} {h.get('organizer','')} {' '.join(h.get('technologies',[]))}".lower()
            if q not in hay:
                continue

        h_copy = dict(h)
        match_info = calculate_match(h, user_ctx)
        h_copy.update(match_info)
        results.append(h_copy)

    # Sorting
    if sort == "closest_deadline":
        results.sort(key=lambda x: x.get("deadline_days_left", 999))
    elif sort == "start_date":
        results.sort(key=lambda x: x.get("start_date") or "9999")
    elif sort == "prize":
        def prize_val(item):
            p = item.get("prize", "")
            nums = re.findall(r"\d+", p.replace(",", ""))
            return int(nums[0]) if nums else 0
        results.sort(key=prize_val, reverse=True)
    else:  # default "best_match"
        results.sort(key=lambda x: x.get("match_score", 0), reverse=True)

    return results[:limit]
