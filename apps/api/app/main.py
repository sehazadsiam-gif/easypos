import os, hashlib, hmac, secrets
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import jwt
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, DateTime, UniqueConstraint, Boolean, Text
from sqlalchemy.orm import declarative_base, sessionmaker

SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
VAT = float(os.getenv("VAT_PCT", "5"))
SVC = float(os.getenv("SERVICE_PCT", "10"))
URL = os.getenv("DATABASE_URL", "sqlite:///./easypos.db")
engine = create_engine(URL, connect_args={"check_same_thread": False} if URL.startswith("sqlite") else {})
Session = sessionmaker(bind=engine)
Base = declarative_base()
now = lambda: datetime.now(timezone.utc)

# Models
class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(Integer, primary_key=True)
    code = Column(String, unique=True)
    name = Column(String)
    active = Column(Boolean, default=True)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    emp_id = Column(String)
    name = Column(String)
    role = Column(String)  # "owner", "manager", "cashier", "waiter"
    pw = Column(String)
    pin = Column(String, nullable=True)  # Manager PIN for approvals
    __table_args__ = (UniqueConstraint("tenant_id", "emp_id"),)

class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    name = Column(String)
    price = Column(Integer)  # paisa
    station = Column(String, default="kitchen")  # "kitchen", "bar"

class Shift(Base):
    __tablename__ = "shifts"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    client_uuid = Column(String, nullable=True)  # for offline shift creation
    label = Column(String)
    opened_by = Column(Integer)
    opened_at = Column(DateTime, default=now)
    closed_at = Column(DateTime, nullable=True)
    opening_cash = Column(Integer, default=0)
    closing_cash = Column(Integer, nullable=True)

class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    shift_id = Column(Integer, index=True)
    client_uuid = Column(String, index=True)
    channel = Column(String)
    slot = Column(String)
    waiter = Column(String, nullable=True)
    status = Column(String, default="open")  # "open", "paid", "voided"
    subtotal = Column(Integer)
    vat = Column(Integer)
    service = Column(Integer)
    total = Column(Integer)
    created_at = Column(DateTime, default=now)
    __table_args__ = (UniqueConstraint("tenant_id", "client_uuid"),)

class Line(Base):
    __tablename__ = "order_lines"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"))
    item_id = Column(Integer)
    name = Column(String)
    qty = Column(Integer)
    unit_price = Column(Integer)
    station = Column(String)

class Payment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"))
    client_uuid = Column(String, nullable=True, index=True)
    method = Column(String)
    amount = Column(Integer)
    created_at = Column(DateTime, default=now)

# Module 2 & 4 models
class Ingredient(Base):
    __tablename__ = "ingredients"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    name = Column(String)
    unit = Column(String)  # "g", "ml", "pcs"
    current_stock = Column(Integer, default=0)  # in base unit
    cost_per_unit = Column(Integer, default=0)  # paisa per unit

class RecipeItem(Base):
    __tablename__ = "recipe_items"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), index=True)
    qty = Column(Integer)  # amount consumed per item

class DailyBazar(Base):
    __tablename__ = "daily_bazar"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    client_uuid = Column(String, nullable=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"))
    qty_purchased = Column(Integer)
    total_cost = Column(Integer)  # paisa
    purchased_at = Column(DateTime, default=now)
    purchased_by = Column(Integer)

class VoidRefund(Base):
    __tablename__ = "voids_refunds"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"))
    type = Column(String)  # "void" or "refund"
    reason = Column(String)
    amount = Column(Integer)  # paisa refunded / voided
    approved_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=now)

class TableLayout(Base):
    __tablename__ = "table_layouts"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    channel = Column(String, default="dine_in")
    layout_json = Column(Text, default="[]")  # array of {id, label, x, y, width, height, shape}

class PrintJob(Base):
    __tablename__ = "print_jobs"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"))
    type = Column(String)  # "kot_kitchen", "kot_bar", "receipt", "bill"
    station = Column(String)  # "kitchen", "bar", "counter"
    payload = Column(Text)  # formatted text / ESC-POS / JSON
    status = Column(String, default="pending")  # "pending", "printed", "failed"
    created_at = Column(DateTime, default=now)

def hp(pw, salt=None):
    salt = salt or secrets.token_hex(8)
    return f"{salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 200_000).hex()}"

def vp(pw, s):
    if not s or "$" not in s: return False
    return hmac.compare_digest(hp(pw, s.split("$")[0]), s)

def seed():
    Base.metadata.create_all(engine)
    db = Session()
    if not db.query(Tenant).first():
        t = Tenant(code="crown", name="Crown Coffee")
        db.add(t)
        db.flush()
        owner = User(tenant_id=t.id, emp_id="1001", name="Owner", role="owner", pw=hp("admin123"), pin="1234")
        manager = User(tenant_id=t.id, emp_id="1002", name="Manager", role="manager", pw=hp("admin123"), pin="9999")
        cashier = User(tenant_id=t.id, emp_id="1003", name="Cashier", role="cashier", pw=hp("admin123"), pin=None)
        db.add_all([owner, manager, cashier])
        
        items = [
            ("Cappuccino", 19000, "bar"),
            ("Latte", 20000, "bar"),
            ("Cold Coffee", 22000, "bar"),
            ("Club Sandwich", 28000, "kitchen"),
            ("French Fries", 15000, "kitchen"),
            ("Chicken Burger", 32000, "kitchen")
        ]
        created_items = {}
        for n, p, s in items:
            it = Item(tenant_id=t.id, name=n, price=p, station=s)
            db.add(it)
            db.flush()
            created_items[n] = it

        # Seed Ingredients & Recipes
        milk = Ingredient(tenant_id=t.id, name="Milk", unit="ml", current_stock=20000, cost_per_unit=10) # 0.10 tk/ml = 100 tk/L
        coffee_beans = Ingredient(tenant_id=t.id, name="Coffee Beans", unit="g", current_stock=5000, cost_per_unit=200) # 2 tk/g
        chicken = Ingredient(tenant_id=t.id, name="Chicken Patty", unit="pcs", current_stock=100, cost_per_unit=8000) # 80 tk
        bun = Ingredient(tenant_id=t.id, name="Burger Bun", unit="pcs", current_stock=100, cost_per_unit=2500) # 25 tk
        fries = Ingredient(tenant_id=t.id, name="Potatoes", unit="g", current_stock=20000, cost_per_unit=5)
        db.add_all([milk, coffee_beans, chicken, bun, fries])
        db.flush()

        # Recipes
        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["Cappuccino"].id, ingredient_id=coffee_beans.id, qty=18))
        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["Cappuccino"].id, ingredient_id=milk.id, qty=150))
        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["Chicken Burger"].id, ingredient_id=chicken.id, qty=1))
        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["Chicken Burger"].id, ingredient_id=bun.id, qty=1))
        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["French Fries"].id, ingredient_id=fries.id, qty=200))

        # Default layout
        default_layout = [
            {"id": "T1", "label": "T1", "x": 40, "y": 40, "width": 80, "height": 80, "shape": "square"},
            {"id": "T2", "label": "T2", "x": 160, "y": 40, "width": 80, "height": 80, "shape": "square"},
            {"id": "T3", "label": "T3", "x": 280, "y": 40, "width": 80, "height": 80, "shape": "square"},
            {"id": "T4", "label": "T4", "x": 400, "y": 40, "width": 80, "height": 80, "shape": "square"},
            {"id": "T5", "label": "T5", "x": 40, "y": 160, "width": 80, "height": 80, "shape": "square"},
            {"id": "T6", "label": "T6", "x": 160, "y": 160, "width": 80, "height": 80, "shape": "square"},
            {"id": "T7", "label": "T7", "x": 280, "y": 160, "width": 80, "height": 80, "shape": "round"},
            {"id": "T8", "label": "T8", "x": 400, "y": 160, "width": 80, "height": 80, "shape": "round"},
        ]
        import json
        db.add(TableLayout(tenant_id=t.id, channel="dine_in", layout_json=json.dumps(default_layout)))
        db.commit()
    db.close()

app = FastAPI(title="EasyPOS API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
seed()

def get_db():
    db = Session()
    try: yield db
    finally: db.close()

def auth(authorization: str = Header(None)):
    try: return jwt.decode(authorization.split()[1], SECRET, algorithms=["HS256"])
    except Exception: raise HTTPException(401, "Not logged in")

def require_role(roles: list):
    def check(u=Depends(auth)):
        if u.get("role") not in roles:
            raise HTTPException(403, f"Action restricted to {','.join(roles)}")
        return u
    return check

# DTO schemas
class LoginIn(BaseModel):
    tenant: str
    emp_id: str
    password: str

class ItemIn(BaseModel):
    name: str
    price: int
    station: str = "kitchen"

class ShiftIn(BaseModel):
    label: str = "Shift 1"
    opening_cash: int = 0
    client_uuid: Optional[str] = None

class CloseIn(BaseModel):
    closing_cash: int

class LineIn(BaseModel):
    item_id: int
    qty: int

class OrderIn(BaseModel):
    client_uuid: str
    channel: str
    slot: Optional[str] = None
    waiter: Optional[str] = None
    lines: List[LineIn]

class PayIn(BaseModel):
    method: str
    amount: int
    client_uuid: Optional[str] = None

class SyncItemIn(BaseModel):
    action: str  # "create_order", "pay_order"
    client_uuid: str
    data: Dict[str, Any]

class SyncBatchIn(BaseModel):
    items: List[SyncItemIn]

class IngredientIn(BaseModel):
    name: str
    unit: str
    current_stock: int = 0
    cost_per_unit: int = 0

class RecipeItemIn(BaseModel):
    ingredient_id: int
    qty: int

class RecipeSetIn(BaseModel):
    item_id: int
    ingredients: List[RecipeItemIn]

class DailyBazarIn(BaseModel):
    ingredient_id: int
    qty_purchased: int
    total_cost: int
    client_uuid: Optional[str] = None

class VoidRefundIn(BaseModel):
    order_id: int
    type: str  # "void" or "refund"
    reason: str
    manager_pin: str

class LayoutSaveIn(BaseModel):
    channel: str = "dine_in"
    layout: List[Dict[str, Any]]

class TenantCreateIn(BaseModel):
    code: str
    name: str
    admin_emp_id: str = "1001"
    admin_name: str = "Owner"
    admin_password: str = "admin123"

@app.get("/config")
def config():
    return {"vat": VAT, "service": SVC}

@app.post("/auth/login")
def login(b: LoginIn, db=Depends(get_db)):
    t = db.query(Tenant).filter_by(code=b.tenant).first()
    if not t or not t.active: raise HTTPException(401, "Invalid business code or account disabled")
    u = db.query(User).filter_by(tenant_id=t.id, emp_id=b.emp_id).first()
    if not u or not vp(b.password, u.pw): raise HTTPException(401, "Wrong employee ID or password")
    tok = jwt.encode({"tid": t.id, "uid": u.id, "role": u.role, "name": u.name}, SECRET, algorithm="HS256")
    return {"token": tok, "name": u.name, "role": u.role, "tenant": t.name, "tid": t.id}

@app.get("/items")
def items(u=Depends(auth), db=Depends(get_db)):
    items_list = db.query(Item).filter_by(tenant_id=u["tid"]).all()
    res = []
    for i in items_list:
        recipes = db.query(RecipeItem).filter_by(tenant_id=u["tid"], item_id=i.id).all()
        res.append({
            "id": i.id,
            "name": i.name,
            "price": i.price,
            "station": i.station,
            "recipe_count": len(recipes)
        })
    return res

@app.post("/items")
def add_item(b: ItemIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"): raise HTTPException(403, "Managers only")
    i = Item(tenant_id=u["tid"], name=b.name, price=b.price, station=b.station)
    db.add(i)
    db.commit()
    return {"id": i.id}

def cur(db, tid):
    return db.query(Shift).filter_by(tenant_id=tid, closed_at=None).first()

@app.get("/shifts/current")
def shift_now(u=Depends(auth), db=Depends(get_db)):
    s = cur(db, u["tid"])
    return s and {"id": s.id, "label": s.label, "opening_cash": s.opening_cash, "opened_at": s.opened_at.isoformat()}

@app.post("/shifts/open")
def shift_open(b: ShiftIn, u=Depends(auth), db=Depends(get_db)):
    if cur(db, u["tid"]): raise HTTPException(400, "A shift is already open")
    s = Shift(tenant_id=u["tid"], client_uuid=b.client_uuid, label=b.label, opened_by=u["uid"], opening_cash=b.opening_cash)
    db.add(s)
    db.commit()
    return {"id": s.id, "label": s.label}

@app.post("/shifts/close")
def shift_close(b: CloseIn, u=Depends(auth), db=Depends(get_db)):
    s = cur(db, u["tid"])
    if not s: raise HTTPException(400, "No open shift")
    paid = db.query(Payment).join(Order, Order.id == Payment.order_id).filter(Order.shift_id == s.id, Payment.method == "cash").all()
    expected = s.opening_cash + sum(p.amount for p in paid)
    s.closed_at, s.closing_cash = now(), b.closing_cash
    db.commit()
    return {"expected_cash": expected, "counted_cash": b.closing_cash, "difference": b.closing_cash - expected}

def ser(o, db=None):
    res = {
        "id": o.id,
        "client_uuid": o.client_uuid,
        "channel": o.channel,
        "slot": o.slot,
        "waiter": o.waiter,
        "status": o.status,
        "subtotal": o.subtotal,
        "vat": o.vat,
        "service": o.service,
        "total": o.total,
        "created_at": o.created_at.isoformat() if o.created_at else None
    }
    if db:
        lines = db.query(Line).filter_by(tenant_id=o.tenant_id, order_id=o.id).all()
        res["lines"] = [{"id": l.id, "item_id": l.item_id, "name": l.name, "qty": l.qty, "unit_price": l.unit_price, "station": l.station} for l in lines]
    return res

def deduct_inventory_for_order(db, tenant_id: int, order_id: int):
    """Auto-deduct raw ingredients stock based on recipe items."""
    lines = db.query(Line).filter_by(tenant_id=tenant_id, order_id=order_id).all()
    for line in lines:
        recipes = db.query(RecipeItem).filter_by(tenant_id=tenant_id, item_id=line.item_id).all()
        for r in recipes:
            ing = db.query(Ingredient).filter_by(tenant_id=tenant_id, id=r.ingredient_id).first()
            if ing:
                ing.current_stock = max(0, ing.current_stock - (r.qty * line.qty))

def generate_print_jobs(db, tenant_id: int, order: Order, lines: List[Line]):
    """Create print jobs for KOT (by station) and Counter receipt/bill."""
    # Group lines by station
    stations = {}
    for l in lines:
        stations.setdefault(l.station, []).append(l)
    
    # 1. Station KOTs
    for station, s_lines in stations.items():
        text_lines = [
            f"=== KOT: {station.upper()} ===",
            f"Order #{order.id} | Slot: {order.slot or '-'} | Ch: {order.channel}",
            f"Waiter: {order.waiter or '-'}",
            f"Time: {order.created_at.strftime('%Y-%m-%d %H:%M:%S')}",
            "--------------------------------",
        ]
        for sl in s_lines:
            text_lines.append(f"{sl.qty}x {sl.name}")
        text_lines.append("================================")
        
        job = PrintJob(
            tenant_id=tenant_id,
            order_id=order.id,
            type=f"kot_{station}",
            station=station,
            payload="\n".join(text_lines),
            status="pending"
        )
        db.add(job)

    # 2. Bill / Receipt at counter
    bill_lines = [
        "*** EASYPOS RECEIPT ***",
        f"Order #{order.id} | Slot: {order.slot or '-'}",
        f"Channel: {order.channel}",
        "--------------------------------",
    ]
    for l in lines:
        bill_lines.append(f"{l.name} x{l.qty} = ৳{(l.unit_price * l.qty)/100:.2f}")
    bill_lines.append("--------------------------------")
    bill_lines.append(f"Subtotal: ৳{order.subtotal/100:.2f}")
    bill_lines.append(f"VAT: ৳{order.vat/100:.2f}")
    if order.service > 0:
        bill_lines.append(f"Service: ৳{order.service/100:.2f}")
    bill_lines.append(f"Total: ৳{order.total/100:.2f}")
    bill_lines.append("================================")

    db.add(PrintJob(
        tenant_id=tenant_id,
        order_id=order.id,
        type="receipt",
        station="counter",
        payload="\n".join(bill_lines),
        status="pending"
    ))

@app.post("/orders")
def create_order(b: OrderIn, u=Depends(auth), db=Depends(get_db)):
    t = u["tid"]
    ex = db.query(Order).filter_by(tenant_id=t, client_uuid=b.client_uuid).first()
    if ex: return ser(ex, db)
    s = cur(db, t)
    if not s: raise HTTPException(400, "Open a shift first")
    lines, sub = [], 0
    for l in b.lines:
        it = db.get(Item, l.item_id)
        if not it or it.tenant_id != t or l.qty < 1: raise HTTPException(400, "Bad item")
        sub += it.price * l.qty
        lines.append(Line(tenant_id=t, item_id=it.id, name=it.name, qty=l.qty, unit_price=it.price, station=it.station))
    if not lines: raise HTTPException(400, "Empty order")
    svc = round(sub * SVC / 100) if b.channel == "dine_in" else 0
    vat = round(sub * VAT / 100)
    o = Order(tenant_id=t, shift_id=s.id, client_uuid=b.client_uuid, channel=b.channel, slot=b.slot, waiter=b.waiter,
              subtotal=sub, vat=vat, service=svc, total=sub + vat + svc)
    db.add(o)
    db.flush()
    for l in lines:
        l.order_id = o.id
        db.add(l)
    
    # Generate KOT and receipt print jobs
    generate_print_jobs(db, t, o, lines)
    # Deduct raw ingredient stocks
    deduct_inventory_for_order(db, t, o.id)

    db.commit()
    return ser(o, db)

@app.get("/orders/open")
def open_orders(u=Depends(auth), db=Depends(get_db)):
    orders = db.query(Order).filter_by(tenant_id=u["tid"], status="open").all()
    return [ser(o, db) for o in orders]

@app.post("/orders/{oid}/pay")
def pay(oid: int, b: PayIn, u=Depends(auth), db=Depends(get_db)):
    o = db.get(Order, oid)
    if not o or o.tenant_id != u["tid"]: raise HTTPException(404, "Order not found")
    if o.status == "paid":
        # idempotent response
        return {"change": 0, "status": "paid"}
    if o.status != "open": raise HTTPException(400, f"Cannot pay order in status {o.status}")
    if b.amount < o.total: raise HTTPException(400, "Amount is less than the total")
    
    db.add(Payment(tenant_id=o.tenant_id, order_id=o.id, client_uuid=b.client_uuid, method=b.method, amount=o.total))
    o.status = "paid"
    db.commit()
    return {"change": b.amount - o.total, "status": "paid"}

# Module 1: Outbox Sync Endpoint
@app.post("/sync/outbox")
def sync_outbox(b: SyncBatchIn, u=Depends(auth), db=Depends(get_db)):
    results = []
    t = u["tid"]
    s = cur(db, t)
    for itm in b.items:
        act = itm.action
        uuid = itm.client_uuid
        data = itm.data
        if act == "create_order":
            ex = db.query(Order).filter_by(tenant_id=t, client_uuid=uuid).first()
            if ex:
                results.append({"client_uuid": uuid, "status": "success", "order": ser(ex, db)})
                continue
            if not s:
                results.append({"client_uuid": uuid, "status": "error", "error": "No open shift"})
                continue
            try:
                lines, sub = [], 0
                for l in data.get("lines", []):
                    item_id = l.get("item_id")
                    qty = l.get("qty", 1)
                    item_obj = db.get(Item, item_id)
                    if item_obj and item_obj.tenant_id == t and qty > 0:
                        sub += item_obj.price * qty
                        lines.append(Line(tenant_id=t, item_id=item_obj.id, name=item_obj.name, qty=qty, unit_price=item_obj.price, station=item_obj.station))
                if not lines:
                    results.append({"client_uuid": uuid, "status": "error", "error": "Empty or invalid items"})
                    continue
                svc = round(sub * SVC / 100) if data.get("channel") == "dine_in" else 0
                vat = round(sub * VAT / 100)
                o = Order(tenant_id=t, shift_id=s.id, client_uuid=uuid, channel=data.get("channel"), slot=data.get("slot"), waiter=data.get("waiter"),
                          subtotal=sub, vat=vat, service=svc, total=sub + vat + svc)
                db.add(o)
                db.flush()
                for l in lines:
                    l.order_id = o.id
                    db.add(l)
                generate_print_jobs(db, t, o, lines)
                deduct_inventory_for_order(db, t, o.id)
                db.commit()
                results.append({"client_uuid": uuid, "status": "success", "order": ser(o, db)})
            except Exception as e:
                db.rollback()
                results.append({"client_uuid": uuid, "status": "error", "error": str(e)})

        elif act == "pay_order":
            order_uuid = data.get("order_client_uuid")
            order_id = data.get("order_id")
            o = None
            if order_uuid:
                o = db.query(Order).filter_by(tenant_id=t, client_uuid=order_uuid).first()
            elif order_id:
                o = db.get(Order, order_id)
            if not o or o.tenant_id != t:
                results.append({"client_uuid": uuid, "status": "error", "error": "Order not found"})
                continue
            if o.status == "paid":
                results.append({"client_uuid": uuid, "status": "success", "paid": True, "change": 0})
                continue
            db.add(Payment(tenant_id=t, order_id=o.id, client_uuid=uuid, method=data.get("method", "cash"), amount=o.total))
            o.status = "paid"
            db.commit()
            results.append({"client_uuid": uuid, "status": "success", "paid": True, "change": max(0, data.get("amount", o.total) - o.total)})
        else:
            results.append({"client_uuid": uuid, "status": "error", "error": f"Unknown action: {act}"})
    return {"results": results}

# Module 2: Recipes, Inventory & Daily Bazar
@app.get("/inventory")
def list_inventory(u=Depends(auth), db=Depends(get_db)):
    ings = db.query(Ingredient).filter_by(tenant_id=u["tid"]).all()
    return [{"id": i.id, "name": i.name, "unit": i.unit, "current_stock": i.current_stock, "cost_per_unit": i.cost_per_unit} for i in ings]

@app.post("/inventory")
def add_ingredient(b: IngredientIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"): raise HTTPException(403, "Managers only")
    ing = Ingredient(tenant_id=u["tid"], name=b.name, unit=b.unit, current_stock=b.current_stock, cost_per_unit=b.cost_per_unit)
    db.add(ing)
    db.commit()
    return {"id": ing.id}

@app.get("/items/{item_id}/recipe")
def get_recipe(item_id: int, u=Depends(auth), db=Depends(get_db)):
    recipes = db.query(RecipeItem).filter_by(tenant_id=u["tid"], item_id=item_id).all()
    res = []
    for r in recipes:
        ing = db.get(Ingredient, r.ingredient_id)
        res.append({
            "ingredient_id": r.ingredient_id,
            "ingredient_name": ing.name if ing else "Unknown",
            "unit": ing.unit if ing else "",
            "qty": r.qty,
            "cost_paisa": (ing.cost_per_unit * r.qty) if ing else 0
        })
    return res

@app.post("/items/recipe")
def set_recipe(b: RecipeSetIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"): raise HTTPException(403, "Managers only")
    it = db.get(Item, b.item_id)
    if not it or it.tenant_id != u["tid"]: raise HTTPException(404, "Item not found")
    # Delete old recipe items for this item
    db.query(RecipeItem).filter_by(tenant_id=u["tid"], item_id=b.item_id).delete()
    for ri in b.ingredients:
        ing = db.get(Ingredient, ri.ingredient_id)
        if not ing or ing.tenant_id != u["tid"]: raise HTTPException(400, "Invalid ingredient")
        db.add(RecipeItem(tenant_id=u["tid"], item_id=b.item_id, ingredient_id=ri.ingredient_id, qty=ri.qty))
    db.commit()
    return {"status": "ok"}

@app.get("/inventory/daily-bazar")
def get_daily_bazar(u=Depends(auth), db=Depends(get_db)):
    records = db.query(DailyBazar).filter_by(tenant_id=u["tid"]).order_by(DailyBazar.purchased_at.desc()).all()
    res = []
    for r in records:
        ing = db.get(Ingredient, r.ingredient_id)
        usr = db.get(User, r.purchased_by)
        res.append({
            "id": r.id,
            "ingredient_id": r.ingredient_id,
            "ingredient_name": ing.name if ing else "Unknown",
            "unit": ing.unit if ing else "",
            "qty_purchased": r.qty_purchased,
            "total_cost": r.total_cost,
            "purchased_by": usr.name if usr else "Staff",
            "purchased_at": r.purchased_at.isoformat()
        })
    return res

@app.post("/inventory/daily-bazar")
def add_daily_bazar(b: DailyBazarIn, u=Depends(auth), db=Depends(get_db)):
    ing = db.get(Ingredient, b.ingredient_id)
    if not ing or ing.tenant_id != u["tid"]: raise HTTPException(404, "Ingredient not found")
    if b.qty_purchased <= 0 or b.total_cost < 0: raise HTTPException(400, "Invalid quantities")
    
    # Update ingredient current stock and weighted average cost
    new_cost_per_unit = round(b.total_cost / b.qty_purchased)
    ing.current_stock += b.qty_purchased
    ing.cost_per_unit = new_cost_per_unit

    record = DailyBazar(
        tenant_id=u["tid"],
        client_uuid=b.client_uuid,
        ingredient_id=b.ingredient_id,
        qty_purchased=b.qty_purchased,
        total_cost=b.total_cost,
        purchased_by=u["uid"]
    )
    db.add(record)
    db.commit()
    return {"id": record.id, "new_stock": ing.current_stock, "cost_per_unit": ing.cost_per_unit}

# Module 3: KOT / Print Agent
@app.get("/printers/jobs")
def get_print_jobs(station: Optional[str] = None, status: str = "pending", u=Depends(auth), db=Depends(get_db)):
    """Print agent endpoint to poll jobs for kitchen/bar/counter."""
    q = db.query(PrintJob).filter_by(tenant_id=u["tid"])
    if station:
        q = q.filter_by(station=station)
    if status:
        q = q.filter_by(status=status)
    jobs = q.order_by(PrintJob.created_at.asc()).all()
    return [{
        "id": j.id,
        "order_id": j.order_id,
        "type": j.type,
        "station": j.station,
        "payload": j.payload,
        "status": j.status,
        "created_at": j.created_at.isoformat()
    } for j in jobs]

@app.post("/printers/jobs/{job_id}/ack")
def ack_print_job(job_id: int, u=Depends(auth), db=Depends(get_db)):
    job = db.get(PrintJob, job_id)
    if not job or job.tenant_id != u["tid"]: raise HTTPException(404, "Job not found")
    job.status = "printed"
    db.commit()
    return {"status": "printed"}

# Module 4: Voids and Refunds with Manager PIN
@app.post("/orders/void-refund")
def void_or_refund(b: VoidRefundIn, u=Depends(auth), db=Depends(get_db)):
    if b.type not in ("void", "refund"): raise HTTPException(400, "Type must be void or refund")
    o = db.get(Order, b.order_id)
    if not o or o.tenant_id != u["tid"]: raise HTTPException(404, "Order not found")
    
    # Manager PIN validation
    managers = db.query(User).filter(
        User.tenant_id == u["tid"],
        User.role.in_(["owner", "manager"])
    ).all()
    approver = None
    for m in managers:
        if m.pin and m.pin == b.manager_pin:
            approver = m
            break
    if not approver:
        raise HTTPException(403, "Invalid manager approval PIN")

    # Sales are append-only. Voids/refunds are new records with reason + approver.
    if b.type == "void":
        if o.status == "paid": raise HTTPException(400, "Paid order cannot be voided; use refund")
        o.status = "voided"
        rec = VoidRefund(tenant_id=u["tid"], order_id=o.id, type="void", reason=b.reason, amount=o.total, approved_by=approver.id)
        db.add(rec)
    elif b.type == "refund":
        if o.status != "paid": raise HTTPException(400, "Only paid orders can be refunded")
        o.status = "refunded"
        rec = VoidRefund(tenant_id=u["tid"], order_id=o.id, type="refund", reason=b.reason, amount=o.total, approved_by=approver.id)
        db.add(rec)
    
    db.commit()
    return {"status": o.status, "type": b.type, "approved_by": approver.name}

# Module 5: Draggable Table Layout Editor
@app.get("/layout/{channel}")
def get_layout(channel: str, u=Depends(auth), db=Depends(get_db)):
    tl = db.query(TableLayout).filter_by(tenant_id=u["tid"], channel=channel).first()
    import json
    if not tl:
        return []
    return json.loads(tl.layout_json)

@app.post("/layout")
def save_layout(b: LayoutSaveIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"): raise HTTPException(403, "Managers only")
    import json
    tl = db.query(TableLayout).filter_by(tenant_id=u["tid"], channel=b.channel).first()
    if not tl:
        tl = TableLayout(tenant_id=u["tid"], channel=b.channel, layout_json=json.dumps(b.layout))
        db.add(tl)
    else:
        tl.layout_json = json.dumps(b.layout)
    db.commit()
    return {"status": "saved"}

# Module 6: Super Admin, Multi-tenancy & Billing
@app.get("/super-admin/tenants")
def super_list_tenants(u=Depends(require_role(["owner"])), db=Depends(get_db)):
    tenants = db.query(Tenant).all()
    res = []
    for t in tenants:
        order_count = db.query(Order).filter_by(tenant_id=t.id).count()
        user_count = db.query(User).filter_by(tenant_id=t.id).count()
        res.append({
            "id": t.id,
            "code": t.code,
            "name": t.name,
            "active": t.active,
            "order_count": order_count,
            "user_count": user_count
        })
    return res

@app.post("/super-admin/tenants")
def super_create_tenant(b: TenantCreateIn, u=Depends(require_role(["owner"])), db=Depends(get_db)):
    if db.query(Tenant).filter_by(code=b.code).first():
        raise HTTPException(400, "Tenant code already exists")
    t = Tenant(code=b.code, name=b.name, active=True)
    db.add(t)
    db.flush()
    admin_user = User(
        tenant_id=t.id,
        emp_id=b.admin_emp_id,
        name=b.admin_name,
        role="owner",
        pw=hp(b.admin_password),
        pin="1234"
    )
    db.add(admin_user)
    db.commit()
    return {"id": t.id, "code": t.code, "name": t.name}

@app.post("/super-admin/tenants/{tenant_id}/toggle-status")
def super_toggle_tenant(tenant_id: int, u=Depends(require_role(["owner"])), db=Depends(get_db)):
    t = db.get(Tenant, tenant_id)
    if not t: raise HTTPException(404, "Tenant not found")
    t.active = not t.active
    db.commit()
    return {"id": t.id, "active": t.active}

# Enhanced Reports: Combine shifts, food cost %, voids/refunds
@app.get("/reports/daily")
def daily(u=Depends(auth), db=Depends(get_db)):
    out = {"by_shift": {}, "by_channel": {}, "total": 0, "total_cost": 0, "food_cost_pct": 0, "voids_refunds_total": 0}
    # One ledger: include all shifts in the combined total
    paid_orders = db.query(Order).filter_by(tenant_id=u["tid"], status="paid").all()
    for o in paid_orders:
        sh = db.get(Shift, o.shift_id)
        label = sh.label if sh else "Unassigned"
        out["by_shift"][label] = out["by_shift"].get(label, 0) + o.total
        out["by_channel"][o.channel] = out["by_channel"].get(o.channel, 0) + o.total
        out["total"] += o.total

        # Calculate ingredient cost for this order
        lines = db.query(Line).filter_by(tenant_id=u["tid"], order_id=o.id).all()
        for l in lines:
            recipes = db.query(RecipeItem).filter_by(tenant_id=u["tid"], item_id=l.item_id).all()
            for r in recipes:
                ing = db.get(Ingredient, r.ingredient_id)
                if ing:
                    out["total_cost"] += ing.cost_per_unit * r.qty * l.qty

    if out["total"] > 0:
        out["food_cost_pct"] = round((out["total_cost"] / out["total"]) * 100, 2)

    # Voids/refunds tally
    vrs = db.query(VoidRefund).filter_by(tenant_id=u["tid"]).all()
    out["voids_refunds_total"] = sum(vr.amount for vr in vrs)
    out["voids_refunds_count"] = len(vrs)

    return out
