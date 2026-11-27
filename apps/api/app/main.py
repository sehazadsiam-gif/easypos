from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import VAT, SVC
from app.seed import seed
from app.routers import auth, items, shifts, orders, reports, inventory, management, sync, realtime, practice_bazar, recipes, batches

app = FastAPI(title="Crown Point of Sale API", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

seed()

@app.get("/config")
def config():
    return {
        "app_name": "crownpointofsale",
        "vat": VAT,
        "service": SVC,
        "currency": "BDT",
        "currency_symbol": "৳",
        "version": "2.1.0"
    }

app.include_router(auth.router)
app.include_router(items.router)
app.include_router(shifts.router)
app.include_router(orders.router)
app.include_router(reports.router)
app.include_router(inventory.router)
app.include_router(recipes.router)
app.include_router(batches.router)
app.include_router(practice_bazar.router)  # Public practice sandbox
app.include_router(management.router)
app.include_router(sync.router)
app.include_router(realtime.router)
