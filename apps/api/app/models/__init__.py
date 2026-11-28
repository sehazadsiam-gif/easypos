from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, UniqueConstraint, Boolean, Text, Float
from app.database import Base, now

class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(Integer, primary_key=True)
    code = Column(String, unique=True, index=True)
    name = Column(String)
    active = Column(Boolean, default=True)
    plan = Column(String, default="standard")
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
    role = Column(String)
    pw = Column(String)
    pin = Column(String, nullable=True)
    __table_args__ = (UniqueConstraint("tenant_id", "emp_id"),)

class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    branch_id = Column(Integer, nullable=True, index=True)
    category = Column(String, default="General")
    name = Column(String)
    barcode = Column(String, index=True, nullable=True)
    price = Column(Integer, nullable=True)  # paisa (optional)
    station = Column(String, default="kitchen")
    image_url = Column(String, nullable=True)
    __table_args__ = (UniqueConstraint("tenant_id", "barcode"),)

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
    status = Column(String, default="open")
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

# Production Ingredients with Barcode and Pack Specs
class Ingredient(Base):
    __tablename__ = "ingredients"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    barcode = Column(String, index=True, nullable=True)
    name = Column(String)
    unit = Column(String)  # Base unit: "g", "ml", "pcs"
    pack_size = Column(Float, default=1.0)
    pack_unit = Column(String, default="pcs")
    min_stock = Column(Integer, default=0)  # par level in base units
    current_stock = Column(Integer, default=0)
    cost_per_unit = Column(Integer, default=0)
    __table_args__ = (UniqueConstraint("tenant_id", "barcode"),)

class Recipe(Base):
    __tablename__ = "recipes"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), index=True)
    version = Column(Integer, default=1)
    status = Column(String, default="draft")  # "draft", "approved", "superseded"
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)

class RecipeItem(Base):
    __tablename__ = "recipe_items"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=True, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), index=True)
    qty = Column(Integer)  # base units (g, ml, pcs)
    input_amount = Column(Float, nullable=True)
    input_unit = Column(String, nullable=True)
    version = Column(Integer, default=1)

class InventoryBatch(Base):
    __tablename__ = "inventory_batches"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    batch_type = Column(String, index=True)  # "central", "bazar", "sale"
    batch_date = Column(String, index=True)  # YYYY-MM-DD
    status = Column(String, default="draft")  # "draft", "approved"
    note = Column(String, nullable=True)
    allow_negative_stock = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)

class InventoryBatchLine(Base):
    __tablename__ = "inventory_batch_lines"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    batch_id = Column(Integer, ForeignKey("inventory_batches.id"), index=True)
    bazar_item_id = Column(Integer, ForeignKey("ingredients.id"), nullable=True)
    menu_item_id = Column(Integer, ForeignKey("items.id"), nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=True)
    recipe_version = Column(Integer, nullable=True)
    quantity = Column(Integer)  # base units for central/bazar, servings for sale
    pack_count = Column(Float, default=1.0)
    total_cost = Column(Integer, default=0)  # integer paisa paid for this line (Daily Bazar)

class StockLedger(Base):
    __tablename__ = "stock_ledger"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    bazar_item_id = Column(Integer, ForeignKey("ingredients.id"), index=True)
    quantity = Column(Integer)  # + added, - removed (in base units)
    type = Column(String, index=True)  # "central", "bazar", "sale", "reversal"
    batch_id = Column(Integer, ForeignKey("inventory_batches.id"), nullable=True, index=True)
    ref_ledger_id = Column(Integer, nullable=True)
    date = Column(String, index=True)  # YYYY-MM-DD
    reason = Column(String, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now)

class StockMovement(Base):
    __tablename__ = "stock_movements"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), index=True)
    movement_type = Column(String)  # "sale_deduction", "daily_bazar", "wastage", "adjustment"
    qty_change = Column(Integer)
    unit = Column(String)
    cost_paisa = Column(Integer, default=0)
    ref_order_id = Column(Integer, nullable=True)
    ref_trip_id = Column(Integer, nullable=True)
    reason = Column(String, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=now)

class BazarTrip(Base):
    __tablename__ = "bazar_trips"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    trip_name = Column(String)
    shopper_name = Column(String)
    total_cost = Column(Integer, default=0)
    status = Column(String, default="completed")  # "completed", "approved"
    receipt_memo = Column(String, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=now)

class DailyBazar(Base):
    __tablename__ = "daily_bazar"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, index=True)
    trip_id = Column(Integer, ForeignKey("bazar_trips.id"), nullable=True, index=True)
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
    type = Column(String)
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
    type = Column(String)
    station = Column(String)
    payload = Column(Text)
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=now)

# =========================================================================
# PRACTICE SANDBOX TABLES (Completely isolated from real production data)
# =========================================================================

class PracticeItem(Base):
    __tablename__ = "practice_items"
    id = Column(Integer, primary_key=True)
    barcode = Column(String, unique=True, index=True)
    name = Column(String)
    category = Column(String, default="General")
    base_unit = Column(String)  # "g", "ml", "pcs"
    pack_size = Column(Float, default=1.0)
    pack_unit = Column(String, default="pack")
    current_stock = Column(Float, default=0.0)
    par_level = Column(Float, default=10.0)
    default_cost = Column(Integer, default=0)  # paisa

class PracticeTrip(Base):
    __tablename__ = "practice_trips"
    id = Column(Integer, primary_key=True)
    trip_name = Column(String)
    shopper_name = Column(String)
    total_cost = Column(Integer, default=0)  # paisa
    item_count = Column(Integer, default=0)
    status = Column(String, default="approved")
    created_at = Column(DateTime, default=now)

class PracticeTripLine(Base):
    __tablename__ = "practice_trip_lines"
    id = Column(Integer, primary_key=True)
    trip_id = Column(Integer, ForeignKey("practice_trips.id"), index=True)
    item_id = Column(Integer, ForeignKey("practice_items.id"))
    pack_count = Column(Float, default=1.0)
    total_units = Column(Float)
    unit_cost = Column(Integer, default=0)
    total_cost = Column(Integer, default=0)

class PracticeStockMovement(Base):
    __tablename__ = "practice_stock_movements"
    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("practice_items.id"), index=True)
    movement_type = Column(String)  # "practice_bazar", "practice_usage", "reset"
    qty_change = Column(Float)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime, default=now)
