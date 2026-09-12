"""
Module 6: World Tech News — live technology news integration.

Fetches current tech news from RSS feeds, categorizes articles,
and personalizes based on existing user skills extracted from documents.

No LLM used for fetching. Modular and safe: failures are caught and
return a clear setup message instead of fake news.
"""
import re
import time
from datetime import datetime, timezone
from typing import List, Dict, Any
import requests
import xml.etree.ElementTree as ET

# ---- RSS sources (reliable, free, no API key) ----
RSS_FEEDS = [
    "https://techcrunch.com/feed/",
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://www.theverge.com/rss/index.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
]

# Category keyword mapping for classification
CATEGORY_KEYWORDS = {
    "AI": ["artificial intelligence", "ai ", "gpt", "llm", "generative ai", "openai", "anthropic"],
    "ML": ["machine learning", "ml ", "deep learning", "neural network", "tensorflow", "pytorch"],
    "Cybersecurity": ["cybersecurity", "cyber security", "hacking", "malware", "ransomware", "penetration testing", "zero day"],
    "Programming": ["programming", "developer", "software engineering", "coding", "javascript", "python", "rust", "go ", "programming language"],
    "Cloud": ["cloud computing", "aws", "azure", "gcp", "google cloud", "serverless"],
    "Robotics": ["robot", "robotics", "autonomous"],
    "Space": ["space", "nasa", "satellite", "rocket", "spacex"],
    "Semiconductor": ["semiconductor", "chip", "gpu", "cpu", "tsmc", "nvidia"],
    "Emerging Technologies": ["quantum", "blockchain", "metaverse", "web3"],
}

# Simple in-memory cache to avoid hammering feeds on every request
_CACHE = {
    "articles": [],
    "timestamp": 0,
    "ttl": 600,  # 10 minutes
}


def _fetch_feed(url: str, timeout: int = 5) -> List[Dict[str, Any]]:
    try:
        resp = requests.get(url, timeout=timeout, headers={"User-Agent": "Ledger-Digital-Identity/1.0"})
        resp.raise_for_status()
        # Parse RSS 2.0
        root = ET.fromstring(resp.content)
        channel = root.find("channel")
        if channel is None:
            # Some feeds use default namespace
            ns = {"rss": "http://purl.org/rss/1.0/"}
            items = []
            return items
        items = []
        for item in channel.findall("item"):
            title = _text(item.find("title"))
            link = _text(item.find("link"))
            description = _text(item.find("description"))
            pub_date = _text(item.find("pubDate"))
            source = _text(channel.find("title")) or "Tech News"
            if not title or not link:
                continue
            # Try to extract image URL from enclosure or media:content
            image_url = ""
            enclosure = item.find("enclosure")
            if enclosure is not None:
                enc_url = enclosure.get("url") or ""
                enc_type = enclosure.get("type") or ""
                if enc_url and enc_type.startswith("image"):
                    image_url = enc_url
            if not image_url:
                # media namespace
                for child in item:
                    if child.tag.endswith("content") and child.get("url"):
                        mime = child.get("type", "")
                        if mime.startswith("image"):
                            image_url = child.get("url")
                            break
            items.append({
                "title": title.strip(),
                "summary": _clean_html(description)[:300],
                "url": link.strip(),
                "source": source.strip(),
                "published": pub_date,
                "image": image_url or None,
            })
        return items
    except Exception as e:
        # Fail silently for individual feeds; log for debugging
        print(f"[news] Feed fetch failed {url}: {e}")
        return []


def _text(elem):
    if elem is None or elem.text is None:
        return ""
    return elem.text


def _clean_html(text: str) -> str:
    # Remove basic HTML tags
    clean = re.sub(r"<[^>]+>", "", text or "")
    clean = re.sub(r"\s+", " ", clean)
    return clean.strip()


def _categorize_article(title: str, summary: str) -> str:
    hay = f"{title} {summary}".lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in hay:
                return cat
    return "Emerging Technologies"


def _parse_pubdate(date_str: str) -> str:
    # Return ISO-ish string or original
    if not date_str:
        return ""
    # Most feeds use RFC 2822
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(date_str)
        if dt.tzinfo is None:
            return dt.isoformat()
        # Normalize to UTC isoformat
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        try:
            dt = datetime.strptime(date_str[:25], "%a, %d %b %Y %H:%M:%S")
            return dt.isoformat()
        except Exception:
            return date_str


def _match_skills(article_text: str, skill_names: List[str]) -> List[str]:
    matched = []
    text_lower = article_text.lower()
    for skill in skill_names:
        # Simple containment check; avoid matching substrings inside words
        pattern = r"\b" + re.escape(skill.lower()) + r"\b"
        if re.search(pattern, text_lower):
            matched.append(skill)
    return matched


def get_news_articles(db, category: str = None, search: str = None, limit: int = 50) -> List[Dict[str, Any]]:
    """
    Fetch and enrich news articles.
    Personalization: matches article text against existing skills in DB.
    Returns list of article dicts with metadata.
    """
    now = time.time()
    # Use cache if fresh
    if now - _CACHE["timestamp"] < _CACHE["ttl"] and _CACHE["articles"]:
        articles = _CACHE["articles"]
    else:
        all_items = []
        for feed_url in RSS_FEEDS:
            items = _fetch_feed(feed_url)
            all_items.extend(items)
        # De-duplicate by URL
        seen = set()
        deduped = []
        for it in all_items:
            if it["url"] in seen:
                continue
            seen.add(it["url"])
            deduped.append(it)
        # Categorize
        categorized = []
        for it in deduped:
            cat = _categorize_article(it["title"], it["summary"])
            it["category"] = cat
            it["published_iso"] = _parse_pubdate(it["published"])
            categorized.append(it)
        _CACHE["articles"] = categorized
        _CACHE["timestamp"] = now
        articles = categorized

    # Load user skills for personalization
    # Import here to avoid circular imports
    from models import Skill
    from sqlalchemy.orm import Session
    skill_names = []
    try:
        # db is a Session
        skills = db.query(Skill).all()
        skill_names = [s.name for s in skills]
    except Exception:
        skill_names = []

    enriched = []
    for art in articles:
        text_combined = f"{art['title']} {art['summary']}"
        related_skills = _match_skills(text_combined, skill_names)
        # Filter by category
        if category and category.lower() != "all":
            if art["category"].lower() != category.lower():
                # Allow partial match for common aliases
                if category.upper() == "ML" and art["category"] != "ML":
                    # keep strict
                    pass
                else:
                    continue
        # Filter by search
        if search:
            q = search.lower()
            if q not in art["title"].lower() and q not in art["summary"].lower():
                continue
        enriched.append({
            "title": art["title"],
            "summary": art["summary"],
            "source": art["source"],
            "published": art["published_iso"] or art["published"],
            "category": art["category"],
            "url": art["url"],
            "image": art.get("image"),
            "related_skills": related_skills,
            "why_relevant": f"This topic matches your {', '.join(related_skills)} skill." if related_skills else "General technology update.",
        })

    # Sort by relevance: articles with related skills first, then newest
    def sort_key(a):
        has_skill = 1 if a["related_skills"] else 0
        # Simple date sort fallback
        return (has_skill, a["published"] or "")
    enriched.sort(key=sort_key, reverse=True)
    return enriched[:limit]


def health_check() -> Dict[str, Any]:
    """Return status of news integration."""
    working_feeds = 0
    for url in RSS_FEEDS:
        try:
            r = requests.head(url, timeout=3)
            if r.status_code < 400:
                working_feeds += 1
        except Exception:
            pass
    if working_feeds == 0:
        return {"status": "no_source", "message": "No news feeds reachable. Check internet connection."}
    return {"status": "ok", "feeds": working_feeds}


def fetch_news(category: str = None, search: str = None, limit: int = 60) -> List[Dict[str, Any]]:
    """Fetch news articles from RSS feeds without personalization."""
    now = time.time()
    # Use cache if fresh
    if now - _CACHE["timestamp"] < _CACHE["ttl"] and _CACHE["articles"]:
        articles = _CACHE["articles"]
    else:
        all_items = []
        for feed_url in RSS_FEEDS:
            items = _fetch_feed(feed_url)
            all_items.extend(items)
        seen = set()
        deduped = []
        for it in all_items:
            if it["url"] in seen:
                continue
            seen.add(it["url"])
            deduped.append(it)
        categorized = []
        for it in deduped:
            cat = _categorize_article(it["title"], it["summary"])
            it["category"] = cat
            it["published_iso"] = _parse_pubdate(it["published"])
            categorized.append(it)
        _CACHE["articles"] = categorized
        _CACHE["timestamp"] = now
        articles = categorized

    results = []
    for art in articles:
        # Filter by category
        if category:
            if art["category"].lower() != category.lower():
                continue
        # Filter by search
        if search:
            q = search.lower()
            if q not in art["title"].lower() and q not in art["summary"].lower():
                continue
        results.append({
            "title": art["title"],
            "summary": art["summary"],
            "source": art["source"],
            "published": art["published_iso"] or art["published"],
            "category": art["category"],
            "url": art["url"],
            "image": art.get("image"),
        })
    return results[:limit]


def get_user_skills(db, user_id: int | None = None) -> list[str]:
    """Return list of skill names extracted from documents belonging to user_id."""
    from models import Document
    try:
        q = db.query(Document)
        if user_id is not None:
            q = q.filter(Document.user_id == user_id)
        skills_set = set()
        for doc in q.all():
            for s in doc.skills:
                skills_set.add(s.name)
        return sorted(skills_set)
    except Exception:
        return []


def personalize_articles(articles: List[Dict[str, Any]], user_skills: List[str]) -> List[Dict[str, Any]]:
    """Add related skills and relevance why to articles."""
    if not user_skills:
        for art in articles:
            art["related_skills"] = []
            art["why_relevant"] = "General technology update."
        return articles
    for art in articles:
        text_combined = f"{art['title']} {art.get('summary','')}"
        related = _match_skills(text_combined, user_skills)
        art["related_skills"] = related
        if related:
            art["why_relevant"] = f"This topic matches your {', '.join(related)} skill."
        else:
            art["why_relevant"] = "General technology update."
    return articles
