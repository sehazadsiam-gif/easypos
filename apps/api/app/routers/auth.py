import jwt
from fastapi import APIRouter, Depends, HTTPException
from app.database import SECRET
from app.dependencies import get_db, auth
from app.models import Tenant, Branch, Terminal, User
from app.security import hp, vp
from app.schemas import LoginIn

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login")
def login(b: LoginIn, db=Depends(get_db)):
    t = db.query(Tenant).filter_by(code=b.tenant).first()
    if not t or not t.active:
        raise HTTPException(401, "Invalid business code or account disabled")
    u = db.query(User).filter_by(tenant_id=t.id, emp_id=b.emp_id).first()
    if not u or not vp(b.password, u.pw):
        raise HTTPException(401, "Wrong employee ID or password")
    
    branch = db.query(Branch).filter_by(tenant_id=t.id, id=u.branch_id).first() if u.branch_id else None

    token_data = {
        "tid": t.id,
        "uid": u.id,
        "role": u.role,
        "name": u.name,
        "branch_id": u.branch_id
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
