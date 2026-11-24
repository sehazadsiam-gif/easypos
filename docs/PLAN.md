# EasyPOS: Full Plan

## 1. Product
A cloud POS for cafés and restaurants, sold as a monthly subscription. Works offline, prints KOTs and bills, tracks stock from recipes, and reports per shift.

**Target customer:** small and mid-size cafés/restaurants in Bangladesh. Crown Coffee is your first tenant and test bed.

## 2. Scope
| Module | What it does |
|---|---|
| Auth and roles | Employee ID + password (Argon2), roles (cashier, manager, owner), manager PIN override |
| Shifts | Open/close shift, opening and closing cash, per-shift reports, combined daily report |
| Home | Channel tiles (Dine In, Takeaway, Foodpanda, Foodi, Pathao, custom), Settings, Logout |
| Dine-in | Drag-and-drop table layout, table status, waiter select, split/merge/transfer |
| Other channels | Numbered order slots per channel |
| Order screen | Menu grid with photos/badges, item list, VAT, service charge, total, Print Bill, Submit |
| Payment | Cash/Card/MFS/Delivery app/Other, numpad, change due, receipt print |
| Menu and recipes | Items, categories, recipe (ingredient, portion, cost), Kitchen/Bar tag |
| Inventory | Stock movements, auto-deduct on sale, wastage, adjustments, versioned recipes |
| Daily Bazar | Purchase entry that feeds inventory with cost price |
| Printing | KOT routing (kitchen/bar printers), bill and receipt, reprint, ESC/POS agent |
| Reports | Sales by shift/day/channel/item/waiter, food cost %, stock, payment methods, Mushak tax info |
| Super-admin | Manage all tenants, branches and terminals, support access, plans, suspend |
| Billing | Plans, per-branch pricing, trial tracking |

## 3. Architecture
- **Tenancy:** Tenant → Branch → Terminal. One shared Postgres, `tenant_id` on every table, Row-Level Security.
- **Frontend:** React PWA, offline-first (local DB + outbox sync, client UUIDs, idempotency keys). Clean blue & white professional theme.
- **Backend:** FastAPI modular monolith + Postgres + Redis.
- **Ledger:** append-only sales, reversing entries for void/refund, money in integer paisa, price/tax snapshot on every order line.
- **Inventory:** stock movements table, versioned recipes, unit conversion.
- **Printing:** local print agent (`apps/print-agent/`) with ESC/POS over WebSocket, routing rules per branch.
- **Realtime:** WebSocket for table status and order updates.
- **Config-driven:** channels, tiles, VAT, service charge, receipt layout, shifts, plan features per tenant/branch.
- **Security:** Argon2, short-lived JWT, device registration, audit log, tenant-isolation tests.
- **Infra:** Contabo Core VPS + Coolify, GitHub auto-deploy, staging + production, daily off-server backups to R2/B2, Sentry + uptime monitoring.
