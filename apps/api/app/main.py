from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import VAT, SVC
from app.seed import seed
from app.routers import auth, items, shifts, orders, reports, inventory, management, sync, realtime

app = FastAPI(title="EasyPOS Modular Monolith API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Seed initial tenant, branch, items, recipe and staff
seed()

@app.get("/config")
def config():
    return {
        "vat": VAT,
        "service": SVC,
        "currency": "BDT",
        "currency_symbol": "৳",
        "version": "2.0.0"
    }

# Register modular routers
app.include_router(auth.router)
app.include_router(items.router)
app.include_router(shifts.router)
app.include_router(orders.router)
app.include_router(reports.router)
app.include_router(inventory.router)
app.include_router(management.router)
app.include_router(sync.router)
app.include_router(realtime.router)
