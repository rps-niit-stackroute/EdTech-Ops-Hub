# EdTech Ops Hub — PRD

## Original Problem Statement
Internal SaaS operations tool for a 10-person corporate training (edtech) team at NIIT StackRoute. Automates 3 manual weekly workflows: attendance reporting, program scheduling, mentor billing. Private internal tool (no auth), shared URL. Spec requested Node/Express/SQLite/exceljs; user approved building on the platform stack instead.

## Architecture
- **Frontend**: React + Tailwind + shadcn/ui. Dark fixed sidebar + light content, footer "Engineered by Arya Ghai" on every page. Fonts: Satoshi (display), Inter (body), IBM Plex Mono (data).
- **Backend**: FastAPI, all routes under `/api`. Excel via **openpyxl** (full color/merge/border/style fidelity).
- **DB**: MongoDB — collections `programs`, `sessions` (uuid string ids, `_id` projected out).

## User Personas
- Ops team members managing programs, schedules, attendance, and mentor SOW billing.

## Core Requirements (static)
- 5 pages: Dashboard, Attendance Tracker, Programs (CRUD), Master Calendar (grid + clash detection), Mentor SOW (billing export).
- Excel append must preserve exact format/colors/merges; clash math uses time-overlap; SOW filters wired end-to-end.

## Implemented (2026-06)
- Dashboard: 4 metric cards (red clash card), quick actions — `/api/dashboard`.
- Attendance: Teams parser (normalize, duration→minutes, threshold), computed attentiveness (=duration/max), 3-sheet append with exact style copy, date-segment rename, auto-detect session date, optional program-link auto-saves attendance summary for Health.
- Programs: card grid, add drawer (+schedule Excel with conflict-resolution), edit drawer with inline session table + live mentor availability, delete cascade.
- Calendar: month grid, filters, clash detection (banner/red borders/panel), session panel.
- SOW: filters, grouped preview (S.No + Dates + subtotals + grand total), styled xlsx (S.No, Dates, no subtotals).
- **Program Health Score**: equal-weight attendance/attentiveness/completion → green/amber/red badge with popover breakdown (program cards + dashboard table) — `/api/programs/{id}/health`.
- **Mentor Availability**: overlap check blocks session save (409) + live UI indicator + schedule-upload conflict resolution — `/api/availability/check`, `/programs/{id}/schedule` (preview), `/sessions/bulk`.
- **Role-Based Auth**: JWT httpOnly cookie + bcrypt, roles admin/team_member/viewer, `/login` + `/viewer`, forced admin password change, user mgmt — `/api/auth/*`, `/api/users`.
- **Audit Log** (admin): every action logged, filterable table + CSV export — `/api/audit`, `/api/audit/export`.
- **Backup & Export** (admin Settings): ZIP (database.json, programs.json, attendance_records.json, audit_log.csv, sow_records.json, backup_info.txt) + last-backup time — `/api/admin/backup`.
- Seed: 4 programs / 12 sessions / 1 clash / attendance records for health. Default admin: admin/admin123 (must change on first login).
- Tested: backend 46/46 pytest, frontend 100% (iterations 1–3) — all passing.

## Backlog / Next
- P2: Migrate `@app.on_event('startup')` to FastAPI lifespan.
- P2: Add login rate-limiting / brute-force protection.
- P2: Split server.py into per-domain routers.
- P2: Viewer "shared programs" client-facing summary page + per-viewer program sharing UI.
- P2: Persist processed attendance trackers (history).
