from typing import List, Dict, Any, Optional
from pydantic import BaseModel

class LoginIn(BaseModel):
    tenant: str
    emp_id: str
    password: str

class ItemIn(BaseModel):
    name: str
    price: Optional[int] = None
    barcode: Optional[str] = None
    category: str = "General"
    station: str = "kitchen"
    image_url: Optional[str] = None

class ItemUpdateIn(BaseModel):
    name: Optional[str] = None
    price: Optional[int] = None
    barcode: Optional[str] = None
    category: Optional[str] = None
    station: Optional[str] = None
    image_url: Optional[str] = None

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

class TableTransferIn(BaseModel):
    order_id: int
    target_slot: str

class PayIn(BaseModel):
    method: str
    amount: int
    client_uuid: Optional[str] = None

class SyncItemIn(BaseModel):
    action: str
    client_uuid: str
    data: Dict[str, Any]

class SyncBatchIn(BaseModel):
    items: List[SyncItemIn]

class IngredientIn(BaseModel):
    name: str
    unit: str
    barcode: Optional[str] = None
    pack_size: float = 1.0
    pack_unit: str = "pcs"
    min_stock: int = 0
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

class WastageIn(BaseModel):
    ingredient_id: int
    qty_lost: int
    reason: str

class VoidRefundIn(BaseModel):
    order_id: int
    type: str
    reason: str
    manager_pin: str

class LayoutSaveIn(BaseModel):
    channel: str = "dine_in"
    layout: List[Dict[str, Any]]

class TenantCreateIn(BaseModel):
    code: str
    name: str
    plan: str = "standard"
    admin_emp_id: str = "1001"
    admin_name: str = "Owner"
    admin_password: str = "admin123"
    branch_name: str = "Main Branch"

# Production Barcode Trip Schemas
class BazarTripLineIn(BaseModel):
    ingredient_id: int
    pack_count: float
    unit_cost: int  # paisa
    total_cost: int  # paisa

class BazarTripIn(BaseModel):
    trip_name: str
    shopper_name: str
    receipt_memo: Optional[str] = None
    lines: List[BazarTripLineIn]

# Practice Mode Schemas (Public, Frictionless)
class PracticeItemIn(BaseModel):
    barcode: str
    name: str
    category: str = "General"
    base_unit: str
    pack_size: float
    pack_unit: str
    par_level: float = 10.0
    default_cost: int = 0

class PracticeTripLineIn(BaseModel):
    item_id: int
    pack_count: float
    unit_cost: int
    total_cost: int

class PracticeTripIn(BaseModel):
    trip_name: str
    shopper_name: str
    lines: List[PracticeTripLineIn]

class PracticeUsageIn(BaseModel):
    item_id: int
    qty_used: float
    reason: str = "Kitchen Practice Simulation"


# New Barcode-Driven Inventory, Recipes, Batches & Ledger Schemas
class RecipeLineIn(BaseModel):
    bazar_item_id: int
    amount: float
    unit: str  # g, kg, ml, L, pcs


class RecipeDraftIn(BaseModel):
    ingredients: List[RecipeLineIn]


class BatchCreateIn(BaseModel):
    batch_type: str  # "central", "bazar", "sale"
    batch_date: Optional[str] = None  # YYYY-MM-DD, defaults to today
    note: Optional[str] = None


class BatchLineIn(BaseModel):
    bazar_item_id: Optional[int] = None
    menu_item_id: Optional[int] = None
    quantity: int  # base units for central/bazar, servings for sale
    pack_count: float = 1.0


class BatchLinesUpdateIn(BaseModel):
    lines: List[BatchLineIn]
    batch_date: Optional[str] = None
    note: Optional[str] = None
    allow_negative_stock: Optional[bool] = None


class BatchApproveIn(BaseModel):
    allow_negative_stock: bool = False


class LedgerReversalIn(BaseModel):
    reason: str
