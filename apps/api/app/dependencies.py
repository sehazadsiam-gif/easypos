import jwt
from fastapi import Header, HTTPException, Depends
from app.database import Session, SECRET
from app.models import Tenant

def get_db():
    db = Session()
    try:
        yield db
    finally:
        db.close()

def auth(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not logged in")
    token = authorization.split()[1]
    try:
        return jwt.decode(token, SECRET, algorithms=["HS256"], options={"verify_exp": True})
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except Exception:
        raise HTTPException(401, "Invalid token")

def require_role(roles: list):
    def check(u=Depends(auth)):
        if u.get("role") not in roles:
            raise HTTPException(403, f"Action restricted to {','.join(roles)}")
        return u
    return check

def verify_owner_password(db, tenant_id: int, owner_password: str = None):
    """Verify that the provided password matches an owner account in this tenant."""
    if not owner_password or not str(owner_password).strip():
        raise HTTPException(403, "Owner password is required to edit an approved record")
    from app.models import User
    from app.security import vp
    owners = db.query(User).filter_by(tenant_id=tenant_id, role="owner").all()
    for owner in owners:
        if vp(str(owner_password).strip(), owner.pw):
            return owner
    raise HTTPException(403, "Invalid owner password")

def apply_postgres_rls(db, tenant_id: int):
    """
    Enforces row level security parameter in PostgreSQL session if active.
    Uses set_config(..., false) which is safe both inside and outside transaction blocks.
    """
    try:
        bind = getattr(db, "bind", None)
        if bind and str(bind.url).startswith("postgresql"):
            from sqlalchemy import text
            tid = str(int(tenant_id))
            db.execute(text("SELECT set_config('app.current_tenant_id', :tid, false)"), {"tid": tid})
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
