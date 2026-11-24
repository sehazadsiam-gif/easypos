from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, UniqueConstraint, Boolean, Text
from app.database import Base, now

class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(Integer, primary_key=True)
    code = Column(String, unique=True, index=True)
    name = Column(String)
    active = Column(Boolean, default=True)
    plan = Column(String, default="standard")  # "trial", "standard", "pro"
    created_at = Column(DateTime, default=now)

class Branch(Base):
    __tablename__ = "branches"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    code = Column(String, index=True)
    name = Column(String)
    address = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    active = Column(Boolean, default=True)
    __table_args__ = (UniqueConstraint("tenant_id", "code"),)

class Terminal(Base):
    __tablename__ = "terminals"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), index=True)
    code = Column(String)
    name = Column(String)
    device_fingerprint = Column(String, nullable=True)
    active = Column(Boolean, default=True)
    __table_args__ = (UniqueConstraint("tenant_id", "code"),)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
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
    branch_id = Column(Integer, nullable=True, index=True)
    category = Column(String, default="General")
    name = Column(String)
    price = Column(Integer)  # paisa
    station = Column(String, default="kitchen")  # "kitchen", "bar"
    image_url = Column(String, nullable=True)

class Shift(Base):
    __tablename__ = "shifts"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    branch_id = Column(Integer, nullable=True, index=True)
    client_uuid = Column(String, nullable=True)
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
    branch_id = Column(Integer, nullable=True, index=True)
    shift_id = Column(Integer, index=True)
    client_uuid = Column(String, index=True)
    channel = Column(String)
    slot = Column(String)
    waiter = Column(String, nullable=True)
    status = Column(String, default="open")  # "open", "paid", "voided", "refunded"
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

class Ingredient(Base):
    __tablename__ = "ingredients"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    name = Column(String)
    unit = Column(String)  # "g", "ml", "pcs"
    current_stock = Column(Integer, default=0)
    cost_per_unit = Column(Integer, default=0)

class RecipeItem(Base):
    __tablename__ = "recipe_items"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), index=True)
    qty = Column(Integer)
    version = Column(Integer, default=1)

class StockMovement(Base):
    __tablename__ = "stock_movements"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), index=True)
    movement_type = Column(String)  # "sale_deduction", "daily_bazar", "wastage", "adjustment"
    qty_change = Column(Integer)    # positive for purchase/adj, negative for sale/waste
    unit = Column(String)
    cost_paisa = Column(Integer, default=0)
    ref_order_id = Column(Integer, nullable=True)
    reason = Column(String, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=now)

class DailyBazar(Base):
    __tablename__ = "daily_bazar"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    client_uuid = Column(String, nullable=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"))
    qty_purchased = Column(Integer)
    total_cost = Column(Integer)
    purchased_at = Column(DateTime, default=now)
    purchased_by = Column(Integer)

class VoidRefund(Base):
    __tablename__ = "voids_refunds"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"))
    type = Column(String)  # "void" or "refund"
    reason = Column(String)
    amount = Column(Integer)
    approved_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=now)

class TableLayout(Base):
    __tablename__ = "table_layouts"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    branch_id = Column(Integer, nullable=True)
    channel = Column(String, default="dine_in")
    layout_json = Column(Text, default="[]")

class PrintJob(Base):
    __tablename__ = "print_jobs"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    branch_id = Column(Integer, nullable=True)
    order_id = Column(Integer, ForeignKey("orders.id"))
    type = Column(String)  # "kot_kitchen", "kot_bar", "receipt", "bill"
    station = Column(String)  # "kitchen", "bar", "counter"
    payload = Column(Text)
    status = Column(String, default="pending")  # "pending", "printed", "failed"
    created_at = Column(DateTime, default=now)
