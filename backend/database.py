import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv()
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
try:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
except Exception:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    DATA_DIR = os.path.join(BASE_DIR, "data")
    UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)

DB_PATH = os.path.join(DATA_DIR, "identity.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


from sqlalchemy import text


def ensure_user_columns(eng):
    """Safely migrate existing SQLite tables to add user_id column if missing,
    and associate any legacy unowned rows with the demo user."""
    with eng.connect() as conn:
        for table in ["documents", "timeline_events", "relationships", "career_analysis"]:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER REFERENCES users(id)"))
                conn.commit()
            except Exception:
                pass  # column already exists or table not created yet

        # Ensure demo user exists in users table and assign legacy records
        try:
            res = conn.execute(text("SELECT id FROM users WHERE clerk_user_id = 'user_demo_ledger_2026'")).fetchone()
            demo_uid = res[0] if res else None
            if not demo_uid:
                conn.execute(text(
                    "INSERT INTO users (clerk_user_id, email, name, image_url, login_count) "
                    "VALUES ('user_demo_ledger_2026', 'demo@ledger.ai', 'Harshan Seliyan', "
                    "'https://ui-avatars.com/api/?name=Harshan+Seliyan&background=d2a24a&color=0B0E13', 1)"
                ))
                conn.commit()
                res = conn.execute(text("SELECT id FROM users WHERE clerk_user_id = 'user_demo_ledger_2026'")).fetchone()
                demo_uid = res[0] if res else 1

            if demo_uid:
                for table in ["documents", "timeline_events", "relationships", "career_analysis"]:
                    try:
                        conn.execute(text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL"), {"uid": demo_uid})
                    except Exception:
                        pass
                conn.commit()
        except Exception as e:
            print(f"[database] Migration warning: {e}")


def init_db():
    Base.metadata.create_all(bind=engine)
    ensure_user_columns(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
