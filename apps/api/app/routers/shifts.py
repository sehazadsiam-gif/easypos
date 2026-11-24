from fastapi import APIRouter, Depends, HTTPException
from app.database import now
from app.dependencies import get_db, auth, apply_postgres_rls
from app.models import Shift, Order, Payment
from app.schemas import ShiftIn, CloseIn

router = APIRouter(prefix="/shifts", tags=["shifts"])

def cur(db, tid):
    return db.query(Shift).filter_by(tenant_id=tid, closed_at=None).first()

@router.get("/current")
def shift_now(u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    s = cur(db, u["tid"])
    return s and {
        "id": s.id,
        "label": s.label,
        "opening_cash": s.opening_cash,
        "opened_at": s.opened_at.isoformat()
    }

@router.post("/open")
def shift_open(b: ShiftIn, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    if cur(db, u["tid"]):
        raise HTTPException(400, "A shift is already open")
    s = Shift(
        tenant_id=u["tid"],
        branch_id=u.get("branch_id"),
        client_uuid=b.client_uuid,
        label=b.label,
        opened_by=u["uid"],
        opening_cash=b.opening_cash
    )
    db.add(s)
    db.commit()
    return {"id": s.id, "label": s.label}

@router.post("/close")
def shift_close(b: CloseIn, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    s = cur(db, u["tid"])
    if not s:
        raise HTTPException(400, "No open shift")
    paid = db.query(Payment).join(Order, Order.id == Payment.order_id).filter(
        Order.shift_id == s.id,
        Payment.method == "cash"
    ).all()
    expected = s.opening_cash + sum(p.amount for p in paid)
    s.closed_at, s.closing_cash = now(), b.closing_cash
    db.commit()
    return {
        "expected_cash": expected,
        "counted_cash": b.closing_cash,
        "difference": b.closing_cash - expected
    }
