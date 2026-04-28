# Remote Control Application - Architecture Overview

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    USERS / EXTERNAL CLIENTS                     │
├─────────────────┬───────────────────────┬───────────────────────┤
│                 │                       │                       │
│          Browser (HTTPS)         Mobile/Desktop        Control UI
│                 │                       │                       │
└────────┬────────┴───────────────────────┴───────────────────────┘
         │
    ┌────▼─────────────────────────────────────────────────────────┐
    │              CLOUDFLARE TUNNEL (Reverse Proxy)              │
    │  ├─ https://netralink.shivomsangha.com → :3001            │
    │  ├─ https://netraapi.shivomsangha.com → :3000             │
    │  └─ https://netraturn.shivomsangha.com → :3478 (TURN)     │
    └────┬──────────────────┬──────────────────┬─────────────────┘
         │                  │                  │
    ┌────▼──────┐    ┌─────▼──────┐    ┌─────▼────────┐
    │ FRONTEND  │    │  BACKEND   │    │ TURN/STUN    │
    │ (Port 3001)    │ (Port 3000)    │ (Port 3478)  │
    └───────────┘    └────────────┘    └──────────────┘
         │                  │                  │
    ┌────▼──────────────────▼──────────────────▼─────┐
    │         PostgreSQL Database                    │
    │         (Device registry, user auth, logs)     │
    └──────────────────────────────────────────────┘
         │
    ┌────▼──────────────────────────────────────────┐
    │    GO AGENT (Runs on Remote Devices)          │
    │    - Device registration & heartbeat          │
    │    - Remote desktop streaming                 │
    │    - File transfer                            │
    │    - Command execution                        │
    └───────────────────────────────────────────────┘
```

---

## 📦 Component Breakdown

### 1. **Frontend (Next.js on Port 3001)**
**Location**: `/remote-control/web/`  
**Tech Stack**: 
- Next.js 16.2.3 (React 19.2.4)
- TypeScript
- TailwindCSS + PostCSS
- ESLint for code quality

**Key Features**:
- User authentication UI
- Device list/dashboard
- Remote desktop viewer
- Control panel
- Settings management

**Dependencies**: 
```
react, react-dom, next, tailwindcss, typescript
```

---

### 2. **Backend API (Express.js on Port 3000)**
**Location**: `/remote-control/server/src/`  
**Tech Stack**: 
- Express.js 5.2.1 (Node.js)
- PostgreSQL (pg 8.20.0)
- WebSockets (ws 8.20.0)
- JWT authentication

**Key Features**:
- RESTful API endpoints
- WebSocket server for real-time communication
- User management & authentication
- Device registration & management
- File upload/download handling
- Logging system

**Dependencies**:
```
express, cors, cookie-parser, jsonwebtoken, bcrypt/bcryptjs,
multer (file uploads), nodemailer (email), pg (database), 
ws (WebSockets), dotenv, uuid
```

**Key Endpoints** (assumed):
- `/api/auth/*` - Authentication
- `/api/devices/*` - Device management
- `/api/sessions/*` - Remote sessions
- `/api/files/*` - File operations
- `/api/health` - Health check

---

### 3. **Go Agent (Remote Device Control)**
**Location**: `/remote-control/agent/`  
**Language**: Go

**Key Features**:
- Device registration with backend
- Heartbeat/health monitoring
- Remote desktop capture & streaming
- Command execution
- File transfer
- Service management (Windows/Linux)
- Agent upgrades
- Device diagnostics & recovery

**Core Files**:
```
main.go                  - Entry point
config.go               - Configuration loading
register.go             - Device registration
heartbeat.go            - Keep-alive pings
remote_desktop.go       - Screen capture/streaming
file_transfer.go        - File operations
executor.go             - Command execution
agent_upgrade.go        - Self-update logic
health.go               - Health checks
ws.go                   - WebSocket communication
http_client.go          - HTTP client setup
service_*.go            - Platform-specific services
action_*.go             - Platform-specific actions
```

---

### 4. **TURN/STUN Server (Port 3478)**
**Purpose**: WebRTC peer connection relay  
**Why**: Helps devices behind NAT/firewalls establish peer connections  
**⚠️ HARD-LOCKED**: Must always run on port 3478 (Cloudflare tunneled)

---

### 5. **Shared Code**
**Location**: `/remote-control/shared/`  
**Purpose**: Common utilities, types, and constants used across components

---

### 6. **Database**
**Type**: PostgreSQL  
**Contains**:
- User accounts & credentials
- Device registry
- Session logs
- File metadata
- Configuration

---

## 🔄 Communication Flow

### User Remote Control Scenario:

```
1. User opens browser → netralink.shivomsangha.com (Port 3001)
   │
2. Frontend authenticates with Backend (Port 3000)
   │
3. User selects device → Backend queries PostgreSQL
   │
4. Initiates WebSocket connection to Go Agent
   │
5. Go Agent streams screen data via WebSocket
   │
6. Frontend renders remote desktop
   │
7. User sends input (keyboard/mouse) → Frontend sends via WebSocket
   │
8. Go Agent receives input → Executes locally on device
   │
9. Screen changes → Agent captures & sends to Frontend
```

---

## 🚀 Deployment Ports (Fixed)

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| Frontend | 3001 | `https://netralink.shivomsangha.com` | Web UI |
| Backend API | 3000 | `https://netraapi.shivomsangha.com` | API endpoints |
| TURN/STUN | 3478 | `https://netraturn.shivomsangha.com` | WebRTC relay |

All routed through **Cloudflare Tunnel** (no direct internet exposure).

---

## 📊 Dependency Graph

### Frontend Dependencies
```
next (framework)
├── react & react-dom
├── typescript (compilation)
└── tailwindcss (styling)
```

### Backend Dependencies
```
express (server)
├── cors (cross-origin requests)
├── cookie-parser (session handling)
├── jsonwebtoken (JWT auth)
├── bcrypt/bcryptjs (password hashing)
├── multer (file uploads)
├── nodemailer (email notifications)
├── pg (PostgreSQL driver)
├── ws (WebSocket support)
├── uuid (ID generation)
└── dotenv (environment config)
```

### Go Agent Dependencies
```
Standard Library
├── net (networking)
├── encoding/json (JSON handling)
├── os (system calls)
└── ... (see go.mod for full list)
```

---

## 🔐 Security Highlights

✅ **JWT-based authentication**  
✅ **Bcrypt password hashing**  
✅ **CORS protection**  
✅ **Cloudflare tunnel (no direct exposure)**  
✅ **WebSocket encryption via HTTPS**  
✅ **PostgreSQL for secure data storage**  

---

## 🌐 Cloud Migration Path

### Current Setup (Vultr/Self-hosted)
→ *To migrate to cloud provider (AWS/GCP/Azure)*

**Before migration, verify**:
```bash
# Health checks
curl -s http://localhost:3000/api/health
curl -s http://localhost:3001/
ss -ltnup | rg ':3000|:3001|:3478'
```

**What to migrate**:
1. Node.js backend (Express.js server code)
2. Next.js frontend
3. PostgreSQL database
4. File uploads directory
5. Environment variables
6. Go agent (distribute to devices)

---

## 📁 Full Directory Structure

```
/remote-control
├── agent/                    # Go agent (remote device control)
│   ├── main.go
│   ├── config.go
│   ├── register.go
│   ├── heartbeat.go
│   ├── remote_desktop.go
│   ├── file_transfer.go
│   ├── executor.go
│   ├── ws.go
│   └── go.mod, go.sum
├── server/                   # Node.js Express backend
│   ├── src/
│   │   ├── index.ts (or .js)
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   └── utils/
│   ├── package.json
│   ├── .env.example
│   └── uploads/
├── web/                      # Next.js frontend
│   ├── app/
│   ├── public/
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   └── .env.production
├── shared/                   # Common code/types
├── scripts/                  # Utility scripts
├── docs/                     # Documentation
├── installer/               # Setup/deployment scripts
└── CLAUDE.md                # Operating notes
```

---

## 🔍 How to Use This Guide

1. **For Cloud Migration**: Review "Cloud Migration Path" section
2. **For Understanding Dependencies**: Check "Dependency Graph"
3. **For Deployment**: See "Deployment Ports (Fixed)"
4. **For Adding Features**: Understand component locations
5. **For Debugging**: Trace "Communication Flow"

