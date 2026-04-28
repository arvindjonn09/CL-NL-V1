# Production Setup & Port Configuration Guide

## Current Production Architecture (Vultr)

Your remote-control application is running on Vultr with the following configuration:

```
Internet Users
    ↓
Cloudflare Tunnel
├─ netralink.shivomsangha.com → localhost:3001
├─ netraapi.shivomsangha.com → localhost:3000  
└─ netraturn.shivomsangha.com → localhost:3478
    ↓
Origin Router (Port 3001) - scripts/origin-router.js
├─ Routes netralink.shivomsangha.com → localhost:3201 (Next.js)
└─ Routes other traffic to backend
    ↓
Next.js Frontend (Port 3201)
    ↓
Express Backend API (Port 3000)
    ↓
PostgreSQL Database
```

---

## 🔴 CRITICAL: Hard-Locked Ports

### ⛔ DO NOT CHANGE THESE PORTS ⛔

These ports are permanently registered in Cloudflare tunnel configuration:

| Port | Service | Tunnel Domain | Status | Change Cost |
|------|---------|---------------|--------|------------|
| **3001** | Origin Router | netralink.shivomsangha.com | Hard-Locked | VERY HIGH |
| **3000** | Backend API | netraapi.shivomsangha.com | Hard-Locked | VERY HIGH |
| **3478** | TURN/STUN | netraturn.shivomsangha.com | Hard-Locked | CRITICAL |

Changing ANY of these ports requires:
1. Manual Cloudflare tunnel reconfiguration (external to code)
2. DNS propagation time
3. Potential service downtime
4. Go agent re-registration

**Only change with explicit user authorization.**

---

## Port Assignment Details

### Port 3001: Origin Router (scripts/origin-router.js)

**What it does**: 
- Acts as the single entry point from Cloudflare tunnel
- Performs host-based routing
- Routes `netralink.shivomsangha.com` → `localhost:3201` (Next.js)
- Can route other hosts to backend as needed

**Configuration**:
```javascript
// scripts/origin-router.js
// Routes incoming requests to appropriate origin service
// Cloudflare tunnel → Port 3001 → Origin Router
//   ├─ Host: netralink.shivomsangha.com → Forward to :3201
//   └─ Other routes → Forward to :3000 (backend)
```

**Start command**:
```bash
node scripts/origin-router.js
```

**Verification**:
```bash
curl -s -H 'Host: netralink.shivomsangha.com' http://localhost:3001/
# Should return Next.js HTML
```

---

### Port 3201: Next.js Frontend (web/)

**What it does**:
- Serves the web UI (React 19 + Next.js 16)
- Listens on port 3201 locally
- Accessed via origin router (not directly from internet)
- Communicates with backend API on port 3000

**Configuration** (web/):
```json
// May use next.config.ts or environment variable
// Typically binds to port 3201
```

**Start command**:
```bash
cd web
npm run build  # Production build
npm start      # Starts on port 3201
```

**Verification**:
```bash
curl http://localhost:3201/
# Should return HTML with React app
```

---

### Port 3000: Backend API (server/)

**What it does**:
- Express.js API server
- WebSocket server for real-time communication
- PostgreSQL connectivity
- Device registration & heartbeat handling
- Remote desktop session management

**Configuration** (server/.env):
```env
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/remote_control
JWT_SECRET=your_secret_key
NODE_ENV=production
```

**Start command**:
```bash
cd server
npm start  # Or: node src/index.js
```

**Verification**:
```bash
curl http://localhost:3000/api/health
# Should return: {"ok":true,...}
```

---

### Port 3478: TURN/STUN Server

**What it does**:
- WebRTC relay server (TURN/STUN protocol)
- Helps devices behind NAT establish peer connections
- UDP/TCP traffic
- Standard TURN port (RFC 5766)

**Status**: Running as separate service (coturn or custom)

**Verification**:
```bash
ss -ltnup | grep ':3478'
# Should show TURN server listening on UDP/TCP
```

⚠️ **DO NOT attempt to change this port or restart without explicit authorization.**

---

## Health Check Commands

```bash
# Check all ports are listening
ss -ltnp | grep -E ':3000|:3001|:3201|:3478'

# Test each service
echo "=== Origin Router ==="
curl -s -H 'Host: netralink.shivomsangha.com' http://localhost:3001/ | head -20

echo "=== Backend API ==="
curl -s http://localhost:3000/api/health

echo "=== Frontend ==="
curl -s http://localhost:3201/ | head -20

echo "=== TURN Server ==="
ss -ltnup | grep ':3478'
```

---

## Service Management

### Start All Services

```bash
cd /home/shiva/remote-control/remote-control

# Run the restart script (handles all services)
bash scripts/restart-setulink.sh

# Or manually:
# Terminal 1 - Backend API
cd server && npm start

# Terminal 2 - Origin Router  
node scripts/origin-router.js

# Terminal 3 - Frontend
cd web && npm start

# Terminal 4 - TURN Server (already running as service)
```

### Stop Services

```bash
# Using script
bash scripts/restart-setulink.sh --stop

# Or manually kill processes
pkill -f "node src/index.js"     # Backend
pkill -f "origin-router.js"      # Router
pkill -f "next start"             # Frontend
```

---

## Environment Variables

### Backend (.env)

```env
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/remote_control
DB_POOL_SIZE=10

# Authentication
JWT_SECRET=your_secret_key_here
JWT_EXPIRY=24h

# Email (optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASS=your_password

# File uploads
UPLOAD_DIR=/home/shiva/remote-control/remote-control/server/uploads

# Logging
LOG_LEVEL=info
```

### Frontend (.env.production)

```env
# API endpoint
NEXT_PUBLIC_API_URL=https://netraapi.shivomsangha.com
```

### Origin Router (scripts/origin-router.js)

```javascript
// Hardcoded routes - modify in script if needed
const ROUTES = {
  'netralink.shivomsangha.com': 'http://localhost:3201',
  'netraapi.shivomsangha.com': 'http://localhost:3000',
  'default': 'http://localhost:3000'
};
```

---

## Database

### PostgreSQL Configuration

```bash
# Connect to database
psql -U remote_user -d remote_control -h localhost

# Show schema
\dt  # List tables
\d sessions  # Describe table

# Backup
pg_dump -U remote_user remote_control > backup.sql

# Restore
psql -U remote_user remote_control < backup.sql
```

---

## Logs & Monitoring

### Log Locations

```bash
# Backend logs
tail -f /home/shiva/remote-control/remote-control/.logs/server.log
tail -f /home/shiva/remote-control/remote-control/logs/app.log

# Check process status
ps aux | grep -E "node|origin-router|next"

# Active connections
ss -ltnp | grep -E ':3000|:3001|:3201|:3478'
```

### Real-time Status

```bash
# Watch services
watch 'ss -ltnp | grep -E ":3000|:3001|:3201|:3478"'

# Check backend health every 5s
watch -n 5 'curl -s http://localhost:3000/api/health'
```

---

## Restart Procedure (Safe)

```bash
# 1. Verify current state
echo "=== BEFORE RESTART ==="
ss -ltnp | grep -E ':3000|:3001|:3201|:3478'

# 2. Run restart script
bash scripts/restart-setulink.sh

# 3. Verify new state
echo "=== AFTER RESTART ==="
ss -ltnp | grep -E ':3000|:3001|:3201|:3478'

# 4. Health check
curl -s http://localhost:3000/api/health
curl -s http://localhost:3201/ | head -5
```

---

## Troubleshooting

### "Address already in use"

```bash
# Find process using port
lsof -i :3000
lsof -i :3001
lsof -i :3201

# Kill process (last resort)
kill -9 <PID>
```

### "Port 3478 must not change"

**Reference**: See CLAUDE.md in remote-control/ directory

### Database Connection Error

```bash
# Check PostgreSQL is running
systemctl status postgresql

# Check connection string
psql "postgresql://user:pass@localhost:5432/remote_control"

# Verify in .env
grep DATABASE_URL server/.env
```

### Origin Router Not Routing

```bash
# Check router is running
ps aux | grep origin-router

# Check it's listening
ss -ltnp | grep 3001

# Test manually
curl -v -H 'Host: netralink.shivomsangha.com' http://localhost:3001/
```

---

## Cloud Migration Considerations

When migrating to cloud (AWS/GCP/Azure):

✅ **Keep same port structure**:
- Port 3000 for backend
- Port 3201 for frontend
- Port 3001 for origin router  
- Port 3478 for TURN (if using cloud TURN, can change)

✅ **Database**:
- Migrate PostgreSQL to managed service (RDS, Cloud SQL, etc.)
- Update DATABASE_URL in environment

✅ **Storage**:
- Move file uploads to S3/GCS/Blob Storage
- Update UPLOAD_DIR or use cloud SDK

✅ **Cloudflare Tunnel**:
- Update tunnel configuration to point to cloud instance
- Verify all URLs are accessible after migration

⚠️ **Go Agent**:
- Update agent registration endpoint to new cloud URL
- Rebuild agent binaries for target OS
- Test on representative devices

---

## Reference Files

- **CLAUDE.md** - Operating notes with port restrictions
- **scripts/restart-setulink.sh** - Service restart script
- **scripts/origin-router.js** - Origin router implementation
- **server/src/index.js** - Backend API entry point
- **web/next.config.ts** - Frontend configuration

---

**Last Updated**: April 28, 2026  
**Environment**: Production (Vultr)  
**Status**: Active ✅

