import time
from datetime import datetime, timezone, timedelta
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from app.database import SECRET
from app.dependencies import get_db, auth
from app.models import Tenant, Branch, Terminal, User
from app.security import hp, vp, check_rate_limit, record_failed_attempt, clear_rate_limit
from app.schemas import LoginIn

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login")
def login(b: LoginIn, request: Request, db=Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"login:{client_ip}:{b.tenant}:{b.emp_id}"
    
    if not check_rate_limit(rate_key, max_attempts=5, window_seconds=60):
        raise HTTPException(429, "Too many failed login attempts. Please wait 1 minute.")

    t = db.query(Tenant).filter_by(code=b.tenant).first()
    if not t or not t.active:
        record_failed_attempt(rate_key)
        raise HTTPException(401, "Invalid business code or account disabled")
    u = db.query(User).filter_by(tenant_id=t.id, emp_id=b.emp_id).first()
    if not u or not vp(b.password, u.pw):
        record_failed_attempt(rate_key)
        raise HTTPException(401, "Wrong employee ID or password")
    
    clear_rate_limit(rate_key)
    branch = db.query(Branch).filter_by(tenant_id=t.id, id=u.branch_id).first() if u.branch_id else None

    now = datetime.now(timezone.utc)
    token_data = {
        "tid": t.id,
        "uid": u.id,
        "role": u.role,
        "name": u.name,
        "branch_id": u.branch_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=24)).timestamp())
    }
    tok = jwt.encode(token_data, SECRET, algorithm="HS256")
    return {
        "token": tok,
        "name": u.name,
        "role": u.role,
        "tenant": t.name,
        "tid": t.id,
        "branch": branch.name if branch else "Main Branch",
        "plan": t.plan
    }
