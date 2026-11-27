import os
import time
import logging
from datetime import datetime, timezone
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger("easypos.database")
logging.basicConfig(level=logging.INFO)

SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
VAT = float(os.getenv("VAT_PCT", "5"))
SVC = float(os.getenv("SERVICE_PCT", "10"))
URL = os.getenv("DATABASE_URL", "sqlite:///./easypos.db")

def init_engine(db_url: str):
    if db_url.startswith("sqlite"):
        return create_engine(db_url, connect_args={"check_same_thread": False})
    return create_engine(db_url, pool_pre_ping=True, pool_recycle=300)

engine = init_engine(URL)
Session = sessionmaker(bind=engine)
Base = declarative_base()
now = lambda: datetime.now(timezone.utc)

def wait_for_db(max_retries: int = 15, delay: float = 2.0) -> bool:
    """Ensure database connection is ready, with automatic retries and safe fallback."""
    global engine, Session
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Database connection established successfully.")
            return True
        except Exception as e:
            last_err = e
            logger.warning(f"Database connection attempt {attempt}/{max_retries} failed: {e}. Retrying in {delay}s...")
            time.sleep(delay)

    # If primary remote DB failed (e.g. Postgres creds error), fall back to SQLite to prevent 502 Bad Gateway
    if not str(engine.url).startswith("sqlite"):
        logger.error(f"Could not connect to primary database ({last_err}). Falling back to local SQLite to keep API online.")
        fallback_url = "sqlite:///./easypos.db"
        engine = init_engine(fallback_url)
        Session.configure(bind=engine)
        return True

    return False
