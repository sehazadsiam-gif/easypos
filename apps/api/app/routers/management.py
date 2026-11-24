import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_db, auth, apply_postgres_rls, require_role
from app.models import TableLayout, PrintJob, Tenant, Branch, User, Order
from app.schemas import LayoutSaveIn, TenantCreateIn
from app.security import hp

router = APIRouter(tags=["management"])

@router.get("/layout/{channel}")
def get_layout(channel: str, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    tl = db.query(TableLayout).filter_by(tenant_id=u["tid"], channel=channel).first()
    return json.loads(tl.layout_json) if tl else []

@router.post("/layout")
def save_layout(b: LayoutSaveIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Managers only")
    apply_postgres_rls(db, u["tid"])
    tl = db.query(TableLayout).filter_by(tenant_id=u["tid"], channel=b.channel).first()
    if not tl:
        tl = TableLayout(tenant_id=u["tid"], channel=b.channel, layout_json=json.dumps(b.layout))
        db.add(tl)
    else:
        tl.layout_json = json.dumps(b.layout)
    db.commit()
    return {"status": "saved"}

@router.get("/printers/jobs")
def get_print_jobs(station: Optional[str] = None, status: str = "pending", u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    q = db.query(PrintJob).filter_by(tenant_id=u["tid"])
    if station:
        q = q.filter_by(station=station)
    if status:
        q = q.filter_by(status=status)
    jobs = q.order_by(PrintJob.created_at.asc()).all()
    return [
        {
            "id": j.id,
            "order_id": j.order_id,
            "type": j.type,
            "station": j.station,
            "payload": j.payload,
            "status": j.status,
            "created_at": j.created_at.isoformat()
        }
        for j in jobs
    ]

@router.post("/printers/jobs/{job_id}/ack")
def ack_print_job(job_id: int, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    job = db.get(PrintJob, job_id)
    if not job or job.tenant_id != u["tid"]:
        raise HTTPException(404, "Job not found")
    job.status = "printed"
    db.commit()
    return {"status": "printed"}

@router.get("/super-admin/tenants")
def super_list_tenants(u=Depends(require_role(["owner"])), db=Depends(get_db)):
    tenants = db.query(Tenant).all()
    res = []
    for t in tenants:
        order_count = db.query(Order).filter_by(tenant_id=t.id).count()
        user_count = db.query(User).filter_by(tenant_id=t.id).count()
        branches = db.query(Branch).filter_by(tenant_id=t.id).count()
        res.append({
            "id": t.id,
            "code": t.code,
            "name": t.name,
            "plan": t.plan,
            "active": t.active,
            "branch_count": branches or 1,
            "order_count": order_count,
            "user_count": user_count
        })
    return res

@router.post("/super-admin/tenants")
def super_create_tenant(b: TenantCreateIn, u=Depends(require_role(["owner"])), db=Depends(get_db)):
    if db.query(Tenant).filter_by(code=b.code).first():
        raise HTTPException(400, "Tenant code already exists")
    t = Tenant(code=b.code, name=b.name, plan=b.plan, active=True)
    db.add(t)
    db.flush()

    branch = Branch(tenant_id=t.id, code="main", name=b.branch_name, active=True)
    db.add(branch)
    db.flush()

    admin_user = User(
        tenant_id=t.id,
        branch_id=branch.id,
        emp_id=b.admin_emp_id,
        name=b.admin_name,
        role="owner",
        pw=hp(b.admin_password),
        pin="1234"
    )
    db.add(admin_user)
    db.commit()
    return {"id": t.id, "code": t.code, "name": t.name, "branch_id": branch.id}

@router.post("/super-admin/tenants/{tenant_id}/toggle-status")
def super_toggle_tenant(tenant_id: int, u=Depends(require_role(["owner"])), db=Depends(get_db)):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(404, "Tenant not found")
    t.active = not t.active
    db.commit()
    return {"id": t.id, "active": t.active}
