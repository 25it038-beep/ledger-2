"""
Module 4: Digital Journey Timeline
Turns the flat document set into a chronological growth story, grouped by
year, e.g. 2023 -> Python Certification, 2024 -> Data Science Club Lead ...
"""
from sqlalchemy.orm import Session
from models import Document, TimelineEvent


def rebuild_timeline(db: Session, user_id: int | None = None):
    q_del = db.query(TimelineEvent)
    q_doc = db.query(Document).filter(Document.doc_date != "")
    if user_id is not None:
        q_del = q_del.filter(TimelineEvent.user_id == user_id)
        q_doc = q_doc.filter(Document.user_id == user_id)
    q_del.delete()
    documents = q_doc.all()
    for doc in documents:
        db.add(TimelineEvent(
            user_id=doc.user_id,
            document_id=doc.id,
            year=doc.doc_date,
            label=doc.title or doc.original_filename,
            category=doc.category,
        ))
    db.commit()


def get_timeline(db: Session, user_id: int | None = None) -> list[dict]:
    q = db.query(TimelineEvent)
    if user_id is not None:
        q = q.filter(TimelineEvent.user_id == user_id)
    events = q.order_by(TimelineEvent.year.asc()).all()
    grouped: dict[str, list[dict]] = {}
    for e in events:
        grouped.setdefault(e.year, []).append({
            "document_id": e.document_id,
            "label": e.label,
            "category": e.category,
        })
    return [{"year": y, "events": grouped[y]} for y in sorted(grouped.keys())]
