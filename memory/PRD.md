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
- Attendance: Teams export parser (name normalize, duration→minutes, threshold), 3-tier name matching, append to Consolidated/Overall/Login sheets by copying existing cell styles, filename date-segment rename, streamed download + unmatched warnings — `/api/attendance/update`.
- Programs: card grid, add drawer (+optional schedule Excel parse), edit drawer with inline session table, delete w/ cascade — `/api/programs*`, `/api/sessions*`, `/api/programs/{id}/schedule`.
- Calendar: 7-col month grid, month nav, 3 simultaneous filters, per-program colors, clash banner/red borders/panel, session side panel — `/api/calendar`, `/api/clashes`, `/api/meta`.
- SOW: month/year/mentor/program filters, grouped preview w/ subtotals + grand total, styled xlsx export — `/api/sow`, `/api/sow/download`.
- Seed: 4 programs / 12 sessions / 1 intentional clash on first startup.
- Tested: 14/14 backend (pytest), 14/14 frontend (Playwright) — all passing.

## Backlog / Next
- P2: Replace native date input on Attendance with shadcn DatePicker.
- P2: Migrate FastAPI startup event to lifespan; clear toasts on route change.
- P2: Split server.py into per-domain routers if it grows.
- P2: Persist processed attendance trackers (history) — currently process-and-download only.
