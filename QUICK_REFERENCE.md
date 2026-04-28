# Quick Reference Guide

## 📌 Essential Commands

### Health Check (All Services)
```bash
cd /home/shiva/remote-control/remote-control

# Quick status
ss -ltnp | grep -E ':3000|:3001|:3201|:3478'

# Full health check
curl http://localhost:3000/api/health
curl http://localhost:3201/
curl -H 'Host: netralink.shivomsangha.com' http://localhost:3001/
```

### Start All Services
```bash
cd /home/shiva/remote-control/remote-control
bash scripts/restart-setulink.sh
```

### Stop All Services
```bash
cd /home/shiva/remote-control/remote-control
bash scripts/restart-setulink.sh --stop
```

### View Logs
```bash
# Backend
tail -f .logs/server.log

# Combined (all)
tail -f logs/app.log
```

---

## 🔧 Development

### Frontend (Port 3201)
```bash
cd /home/shiva/remote-control/remote-control/web

# Development mode with hot reload
npm run dev

# Production build
npm run build

# Start production build
npm start
```

### Backend (Port 3000)
```bash
cd /home/shiva/remote-control/remote-control/server

# Development mode
npm start

# With nodemon (auto-reload)
npx nodemon src/index.js
```

### Origin Router (Port 3001)
```bash
cd /home/shiva/remote-control/remote-control
node scripts/origin-router.js
```

---

## 🗄️ Database

### Connect to PostgreSQL
```bash
psql -U remote_user -d remote_control -h localhost
```

### Backup Database
```bash
pg_dump -U remote_user remote_control > backup_$(date +%Y%m%d).sql
```

### Restore Database
```bash
psql -U remote_user remote_control < backup.sql
```

### Check Database Size
```bash
psql -U remote_user -d remote_control -c "SELECT pg_size_pretty(pg_database_size('remote_control'));"
```

---

## 🚀 Deployment

### Build Frontend
```bash
cd web
npm run build
# Output: .next/ directory
```

### Check Dependencies
```bash
# Backend
cd server && npm outdated

# Frontend
cd ../web && npm outdated
```

### Update Dependencies
```bash
# Backend (be careful!)
cd server
npm update

# Frontend
cd ../web
npm update
```

---

## 🔐 Security

### Generate New JWT Secret
```bash
openssl rand -base64 32
# Use output in .env: JWT_SECRET=...
```

### Reset Database (Careful!)
```bash
# Backup first!
pg_dump -U remote_user remote_control > backup_$(date +%Y%m%d).sql

# Drop and recreate
dropdb -U remote_user remote_control
createdb -U remote_user remote_control

# Run migrations if available
# (check server/src/db/schema.js or migrations folder)
```

---

## 📊 Monitoring

### Real-time Service Monitor
```bash
# Watch ports every 2 seconds
watch -n 2 'ss -ltnp | grep -E ":3000|:3001|:3201|:3478"'
```

### Check Process CPU/Memory
```bash
ps aux | grep -E "node|origin-router|next" | grep -v grep
```

### Disk Space
```bash
df -h /home/shiva/remote-control/
du -sh /home/shiva/remote-control/*
```

### Database Connections
```bash
psql -U remote_user -d remote_control -c "SELECT count(*) FROM pg_stat_activity;"
```

---

## ⚠️ CRITICAL Reminders

### DO NOT CHANGE THESE PORTS
```
3001  - Origin Router (Cloudflare hard-lock)
3000  - Backend API (Cloudflare hard-lock)
3478  - TURN/STUN (CRITICAL hard-lock)
```

See: `CLAUDE.md` and `PRODUCTION_SETUP.md`

### Port 3201 Notes
- This is the Next.js frontend port
- NOT exposed to internet directly
- Accessed via Origin Router (3001)
- Safe to change if needed (change in origin-router.js)

---

## 🔧 Troubleshooting

### Port Already in Use
```bash
# Find what's using the port
lsof -i :3000
lsof -i :3001
lsof -i :3201

# Kill process (get PID from above)
kill -9 <PID>
```

### Can't Connect to Database
```bash
# Check PostgreSQL status
systemctl status postgresql

# Try connecting directly
psql -U remote_user -h localhost -d remote_control

# Check .env DATABASE_URL is correct
cat server/.env | grep DATABASE_URL
```

### Services Won't Start
```bash
# Check if ports are available
ss -ltnp | grep -E ':3000|:3001|:3201'

# Check logs
tail -f .logs/server.log
tail -f web/web.log

# Verify .env files exist
ls server/.env
ls web/.env.production
```

### Origin Router Not Working
```bash
# Check it's running
ps aux | grep origin-router

# Check it's listening
ss -ltnp | grep :3001

# Test directly
curl -v http://localhost:3001/
```

---

## 📁 File Locations

```
/home/shiva/remote-control/
├── ARCHITECTURE.md              # System design
├── DEPENDENCIES.md              # Dependency list
├── ARCHITECTURE_DIAGRAMS.md     # Mermaid diagrams
├── PRODUCTION_SETUP.md          # This is where you are now
├── README_DOCUMENTATION.md      # Documentation index
│
└── remote-control/
    ├── CLAUDE.md                # ⚠️ Operating notes
    ├── server/                  # Backend (Port 3000)
    │   ├── src/index.js
    │   └── .env
    ├── web/                     # Frontend (Port 3201)
    │   ├── app/
    │   └── .env.production
    ├── scripts/
    │   ├── restart-setulink.sh  # ⭐ Use this to restart all
    │   └── origin-router.js     # Origin Router (Port 3001)
    ├── agent/                   # Go Agent
    └── docs/                    # Additional docs
```

---

## 🌐 URLs

### Local Development
- Frontend: http://localhost:3201/
- Backend API: http://localhost:3000/api/
- Origin Router: http://localhost:3001/

### Production (via Cloudflare)
- Web UI: https://netralink.shivomsangha.com/
- API: https://netraapi.shivomsangha.com/
- TURN: turn.shivomsangha.com:3478

---

## 📞 Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Port 3000 in use | `lsof -i :3000 && kill -9 <PID>` |
| DB connection fails | Check `DATABASE_URL` in `.env` |
| Frontend blank | Check backend is running on 3000 |
| Can't reach origin router | Check port 3001 is open |
| TURN not working | DON'T CHANGE IT - see CLAUDE.md |
| Services not auto-start | Run `bash scripts/restart-setulink.sh` |

---

## 🚀 Next Steps

1. **Read full docs**: See `README_DOCUMENTATION.md`
2. **Understand architecture**: Read `ARCHITECTURE.md`
3. **Check production setup**: See `PRODUCTION_SETUP.md`
4. **Review restrictions**: See `CLAUDE.md` in remote-control/
5. **Monitor services**: Use commands from this guide
6. **Plan cloud migration**: Follow cloud migration guides

---

**Version**: 1.0  
**Last Updated**: April 28, 2026  
**Status**: Active ✅  
**Maintenance**: Low - mostly running services

