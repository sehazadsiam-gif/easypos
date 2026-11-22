# EasyPOS rules for the coding agent
- Money is **integer paisa**. Never floats.
- Every table has `tenant_id`; every query filters by it.
- Sales are **append-only**. No delete/update of paid orders. Voids/refunds are new records with reason + approver.
- One ledger. Shifts are a `shift_id` tag on sales; reports must always include all shifts in the combined total.
- Order line items snapshot name and price.
- Stack: FastAPI + SQLAlchemy (apps/api), React + Vite (apps/web). Keep the API a modular monolith.
- Terminals must keep working offline (outbox + client UUIDs). Build this before new features.
- Work one module at a time per docs/SPEC.md. Add tests for each module.
- Never commit secrets. Use env vars.
