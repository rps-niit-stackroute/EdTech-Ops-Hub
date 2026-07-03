# EdTech Ops Hub

An internal operations management tool built for NIIT Stackroute to streamline 
EdTech program management, attendance tracking, mentor scheduling, and SOW generation.

**Engineered by Arya Ghai**

---

## What This Tool Does

EdTech Ops Hub is a centralised dashboard that gives the operations team a single 
place to manage all program-related activities. It replaces manual Excel-based 
workflows with an automated, web-based system.

### Features

- **Operations Dashboard** — Live snapshot of programs, sessions, and mentor activity
- **Attendance Management** — Upload raw attendance data and generate consolidated 
  reports with automatic calculations. Output file is named using the original 
  report name with the latest attendance date appended
- **Program Calendar** — View and manage session schedules across all programs
- **Program Management** — Add, edit, and track all active EdTech programs
- **Mentor SOW (Statement of Work)** — Auto-generate SOW sheets based on session 
  duration. Highlights changes between old and new SOW versions showing 
  Old value → New value in yellow for any modified cells
- **Backup & Export** — Generate ZIP backups and export reports
- **Audit Logging** — All actions are logged for accountability
- **Role-Based Access** — JWT-based authentication with admin and user roles

---

## Tech Stack

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 19 with TypeScript |
| Build Tool | CRACO (Create React App Configuration Override) |
| Routing | react-router-dom |
| Styling | Tailwind CSS + custom CSS variables |
| UI Components | shadcn/ui (Radix UI primitives) |
| Icons | lucide-react |
| HTTP Client | Axios (withCredentials for cookie auth) |
| Notifications | Sonner |
| Date Handling | dayjs |
| Package Manager | yarn |

### Backend
| Layer | Technology |
|---|---|
| Framework | FastAPI (Python 3.11) |
| Server | Uvicorn |
| Database | MongoDB via Motor (async) |
| Authentication | JWT (PyJWT) in httpOnly cookies + bcrypt |
| Excel Processing | openpyxl |
| File Handling | python-multipart, zipfile, csv |
| Validation | Pydantic v2 |

### Infrastructure
| Layer | Technology |
|---|---|
| Containerisation | Docker + Docker Compose |
| Frontend Serving | Nginx |
| Database | MongoDB 7 |

---

## Project Structure
EdTech-Ops-Hub/
├── frontend/                    # React TypeScript frontend
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/               # Page components (Dashboard, Attendance, etc.)
│   │   └── App.tsx              # Main app with routing
│   ├── public/
│   ├── package.json
│   ├── craco.config.js
│   ├── tailwind.config.js
│   ├── .env                     # Frontend environment variables (not committed)
│   └── .env.example             # Template for environment variables
│
├── backend/                     # FastAPI Python backend
│   ├── server.py                # Main app, all API routes
│   ├── auth.py                  # JWT authentication
│   ├── db.py                    # MongoDB connection and seeding
│   ├── audit.py                 # Audit logging
│   ├── logic.py                 # Health and availability logic
│   ├── backup.py                # Backup ZIP generation
│   ├── attendance_processor.py  # Excel attendance processing
│   ├── schedule_parser.py       # Schedule Excel parsing
│   ├── sow_export.py            # SOW Excel generation
│   ├── excel_utils.py           # Shared Excel utilities
│   ├── requirements.txt         # Python dependencies
│   ├── .env                     # Backend environment variables (not committed)
│   └── .env.example             # Template for environment variables
│
├── Dockerfile.frontend          # Docker build for React app
├── Dockerfile.backend           # Docker build for FastAPI app
├── docker-compose.yml           # Orchestrates all three containers
├── .dockerignore                # Files excluded from Docker builds
└── README.md                    # This file


---

## Getting Started (Local Development)

### Prerequisites
- Docker Desktop installed and running
- Git

### Steps

**1. Clone the repository**
```bash
git clone https://github.com/aryaghai6/EdTech-Ops-Hub.git
cd EdTech-Ops-Hub
```

**2. Set up environment variables**

Create `backend/.env`:

MONGO_URL=mongodb://mongo:27017
DB_NAME=edtech_ops_production
CORS_ORIGINS=http://localhost:3000
JWT_SECRET=your-64-char-hex-secret-here
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
NODE_ENV=production

Create `frontend/.env`:

REACT_APP_BACKEND_URL=http://localhost:8001
NODE_ENV=production

**3. Start all containers**
```bash
docker compose up --build
```

**4. Open in browser**
http://localhost:3000

**5. Login with default credentials**
Username: admin
Password: admin123

You will be prompted to change the password on first login.

### Stopping the app
```bash
docker compose down
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Example |
|---|---|---|
| MONGO_URL | MongoDB connection string | mongodb://mongo:27017 |
| DB_NAME | Database name | edtech_ops_production |
| CORS_ORIGINS | Allowed frontend origins (comma separated) | http://localhost:3000 |
| JWT_SECRET | 64-char hex string for signing JWT tokens | generate with: openssl rand -hex 32 |
| ADMIN_USERNAME | Default admin username | admin |
| ADMIN_PASSWORD | Default admin password | admin123 |
| NODE_ENV | Environment | production |

### Frontend (`frontend/.env`)

| Variable | Description | Example |
|---|---|---|
| REACT_APP_BACKEND_URL | Backend API base URL | http://localhost:8001 |
| NODE_ENV | Environment | production |

---

## API Overview

All backend routes are prefixed with `/api`

| Method | Route | Description |
|---|---|---|
| POST | /api/auth/login | Login and receive JWT cookie |
| POST | /api/auth/logout | Clear JWT cookie |
| GET | /api/auth/me | Get current logged in user |
| GET | /api/dashboard | Dashboard summary stats |
| GET | /api/programs | List all programs |
| POST | /api/programs | Create a new program |
| GET | /api/calendar | Session calendar data |
| POST | /api/attendance/upload | Upload and process attendance Excel |
| POST | /api/sow/generate | Generate SOW Excel for a program |
| GET | /api/audit | Audit log entries |
| POST | /api/backup | Generate backup ZIP |

Full interactive API documentation available at:
http://localhost:8001/docs

---

## Docker Architecture
┌─────────────────────────────────────────┐
│           Docker Compose                │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │  Frontend   │  │    Backend      │  │
│  │  React+Nginx│  │  FastAPI+Uvicorn│  │
│  │  Port 3000  │  │   Port 8001     │  │
│  └──────┬──────┘  └────────┬────────┘  │
│         │                  │            │
│         └────────┬─────────┘            │
│                  │                      │
│          ┌───────▼──────┐              │
│          │   MongoDB 7  │              │
│          │  Port 27017  │              │
│          └──────────────┘              │
└─────────────────────────────────────────┘

---

## AWS Deployment

For AWS deployment refer to `DEPLOYMENT.md` in this repository which covers:
- Building and pushing images to AWS ECR
- Deploying on AWS ECS Fargate
- Setting up MongoDB Atlas or AWS DocumentDB
- Configuring secrets in AWS Secrets Manager
- Setting up Application Load Balancer
- Configuring Route 53 and HTTPS

**Critical note for AWS builds:**
`REACT_APP_BACKEND_URL` must be passed as a Docker build argument:
```bash
docker build -f Dockerfile.frontend \
  --build-arg REACT_APP_BACKEND_URL=https://your-backend-url.com \
  -t edtech-frontend .
```

---

## Known Notes

- The app was initially scaffolded using the Emergent AI-assisted development 
  platform and subsequently fully customised, containerised, and prepared for 
  independent deployment
- `emergentintegrations` package was removed as it is a private Emergent dependency 
  not required for the core functionality of this tool
- yarn must always be used instead of npm for frontend operations

---

## Author

**Arya Ghai**
NIIT Stackroute
GitHub: [@aryaghai6](https://github.com/aryaghai6)
