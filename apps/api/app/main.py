import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import VAT, SVC
from app.seed import seed
from app.routers import auth, items, shifts, orders, reports, inventory, management, sync, realtime, recipes, batches

app = FastAPI(title="Crown Point of Sale API", version="2.1.0")

# Security-hardened CORS configuration
cors_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [
    "https://crownpointofsale.online",
    "http://crownpointofsale.online",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173"
]
if cors_env:
    for origin in cors_env.split(","):
        o = origin.strip()
        if o and o not in allowed_origins:
            allowed_origins.append(o)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

seed()

@app.get("/")
def root():
    return {
        "app": "Crown Point of Sale API",
        "status": "healthy",
        "version": "2.1.0",
        "endpoints": {
            "config": "/config",
            "docs": "/docs",
            "auth": "/auth/login",
            "items": "/items"
        }
    }

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
app.include_router(management.router)
app.include_router(sync.router)
app.include_router(realtime.router)
