# EasyPOS
Cloud POS for cafés and restaurants. This is the **Phase 0/1 starter**: working login, shifts, menu, orders, payments and a daily report.

## Run in Antigravity (2 terminals)
**API** (Python 3.11+)
```
cd apps/api
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
**Web** (Node 18+)
```
cd apps/web
npm install
npm run dev
```
Open http://localhost:5173. Demo login: tenant `crown`, employee `1001`, password `admin123`. API docs: http://localhost:8000/docs

Default DB is SQLite (`easypos.db`). For Postgres: `docker compose up -d db`, then set `DATABASE_URL=postgresql+psycopg://easypos:easypos@localhost:5432/easypos` and `pip install psycopg[binary]`.

## Included
Login (JWT) · multi-tenant `tenant_id` on every table · shifts (open/close, cash) · menu items (Kitchen/Bar station) · dine-in table layout + takeaway/delivery slots · orders with VAT/service charge in paisa · idempotent order create (`client_uuid`) · payments with change · per-shift daily report · no delete endpoints (append-only direction).

## Next (see AGENTS.md and docs/SPEC.md)
Offline outbox sync · recipes + inventory + Daily Bazar · KOT/receipt print agent · voids/refunds with manager PIN · roles enforcement · Postgres RLS · super-admin · billing.

Before production: change `JWT_SECRET`, enable HTTPS, set up off-server backups.
