from typing import List, Dict, Any, Optional
from pydantic import BaseModel

class LoginIn(BaseModel):
    tenant: str
    emp_id: str
    password: str

class ItemIn(BaseModel):
    name: str
    price: int
    category: str = "General"
    station: str = "kitchen"
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
    type: str  # "void" or "refund"
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
