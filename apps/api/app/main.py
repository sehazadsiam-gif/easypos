import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.database import VAT, SVC
from app.seed import seed
from app.routers import auth, items, shifts, orders, reports, inventory, management, sync, realtime, recipes, batches

app = FastAPI(title="Crown Point of Sale API", version="2.1.0")

# Security-hardened CORS configuration
cors_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [
    "https://crownpointofsale.online",
    "http://crownpointofsale.online",
    "https://www.crownpointofsale.online",
    "http://www.crownpointofsale.online",
    "http://localhost",
    "http://127.0.0.1",
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

@app.get("/config")
@app.get("/api/config")
def config():
    return {
        "app_name": "crownpointofsale",
        "vat": VAT,
        "service": SVC,
        "currency": "BDT",
        "currency_symbol": "৳",
        "version": "2.1.0"
    }

# Register all routers both directly and with /api prefix for compatibility
all_routers = [auth, items, shifts, orders, reports, inventory, recipes, batches, management, sync, realtime]
for r in all_routers:
    app.include_router(r.router)
    app.include_router(r.router, prefix="/api")

# Static frontend serving fallback (handles both port 8000 direct access and Docker volume)
static_dir = os.getenv("STATIC_DIR", "/app/static")
if not os.path.exists(static_dir) or not os.path.exists(os.path.join(static_dir, "index.html")):
    local_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../web/dist"))
    if os.path.exists(local_dist):
        static_dir = local_dist

if os.path.exists(static_dir) and os.path.exists(os.path.join(static_dir, "index.html")):
    assets_dir = os.path.join(static_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    def serve_root_html():
        return FileResponse(os.path.join(static_dir, "index.html"))

    @app.get("/{full_path:path}")
    def serve_frontend_spa(full_path: str):
        if full_path.startswith(("docs", "redoc", "openapi.json", "auth", "items", "orders", "shifts", "reports", "inventory", "recipes", "batches", "management", "sync", "realtime", "config", "api")):
            raise HTTPException(404, "Not Found")
        target = os.path.join(static_dir, full_path)
        if os.path.isfile(target):
            return FileResponse(target)
        return FileResponse(os.path.join(static_dir, "index.html"))
else:
    @app.get("/")
    def root_api():
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
