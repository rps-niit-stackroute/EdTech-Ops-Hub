# Auth Testing Playbook — EdTech Ops Hub

Username/password JWT auth (httpOnly cookie, bcrypt). Main app is open; login unlocks roles.

## Step 1 — MongoDB
```
mongosh
use test_database
db.users.find({role:"admin"}).pretty()
```
Verify admin exists, password_hash starts with `$2b$`, must_change_password=true initially.

## Step 2 — API
```
# login (sets httpOnly cookie)
curl -c cookies.txt -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}'

# whoami
curl -b cookies.txt http://localhost:8001/api/auth/me

# admin-only audit log
curl -b cookies.txt "http://localhost:8001/api/audit?"

# change password (clears must_change_password)
curl -b cookies.txt -X POST http://localhost:8001/api/auth/change-password \
  -H "Content-Type: application/json" -d '{"current_password":"admin123","new_password":"newpass123"}'

# logout
curl -b cookies.txt -X POST http://localhost:8001/api/auth/logout
```

## Step 3 — Role checks
- Without cookie, `/api/audit`, `/api/users`, `/api/admin/backup` must return 401.
- team_member token must NOT access `/api/audit` (403) or `/api/users` (403).

## Frontend
- `/login` admin login → forced change-password screen on first login.
- `/viewer` viewer login.
- Sidebar shows Audit Log + Settings only for admin; logout button in footer.
- All axios calls use withCredentials:true.
