import os
from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
VAT = float(os.getenv("VAT_PCT", "5"))
SVC = float(os.getenv("SERVICE_PCT", "10"))
URL = os.getenv("DATABASE_URL", "sqlite:///./easypos.db")

engine = create_engine(
    URL,
    connect_args={"check_same_thread": False} if URL.startswith("sqlite") else {}
)
Session = sessionmaker(bind=engine)
Base = declarative_base()
now = lambda: datetime.now(timezone.utc)
