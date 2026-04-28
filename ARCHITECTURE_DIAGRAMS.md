# Visual Architecture Diagrams

## Component Interaction Diagram

```mermaid
graph TB
    subgraph clients["👥 Clients"]
        browser["🌐 Web Browser<br/>https://netralink.shivomsangha.com"]
        mobile["📱 Mobile/Desktop App"]
        device["🖥️ Remote Device<br/>with Agent"]
    end
    
    subgraph cloudflare["☁️ Cloudflare Tunnel"]
        cf["Reverse Proxy<br/>SSL/TLS Termination"]
    end
    
    subgraph cloud["☁️ Your Server (Vultr → Cloud)"]
        frontend["🎨 Frontend<br/>Next.js :3001"]
        backend["⚙️ Backend API<br/>Express :3000"]
        turn["📡 TURN/STUN<br/>:3478"]
        db[(🗄️ PostgreSQL<br/>Database)]
    end
    
    browser -->|HTTPS| cf
    mobile -->|HTTPS| cf
    device -->|HTTPS/UDP| cf
    
    cf -->|HTTP| frontend
    cf -->|HTTP| backend
    cf -->|UDP/TCP| turn
    
    frontend -->|API Calls| backend
    backend -->|WebSocket| frontend
    backend -->|Query/Insert| db
    
    device -->|Register/Heartbeat| backend
    device -->|WebSocket Stream| backend
    backend -->|Send Control| device
    
    turn -->|Relay| device
    turn -->|Relay| browser
    
    style browser fill:#4CAF50
    style backend fill:#2196F3
    style frontend fill:#FF9800
    style db fill:#F44336
    style device fill:#9C27B0
    style turn fill:#00BCD4
    style cf fill:#FFC107
```

---

## Data Flow: Remote Desktop Session

```mermaid
sequenceDiagram
    participant Browser
    participant Frontend
    participant Backend
    participant Database
    participant Agent as Go Agent<br/>Remote Device
    
    Browser->>Frontend: 1. Load Dashboard
    Frontend->>Backend: 2. Get Device List (JWT)
    Backend->>Database: 3. Query Devices
    Database-->>Backend: Device List
    Backend-->>Frontend: Return Devices
    Frontend-->>Browser: Show Devices
    
    Browser->>Frontend: 4. Click Device (Start Session)
    Frontend->>Backend: 5. Create Session Request
    Backend->>Database: 6. Log Session
    Backend->>Agent: 7. Initiate WebSocket
    
    Agent-->>Backend: 8. Connect to Session
    Backend-->>Frontend: 9. WebSocket Ready
    Frontend-->>Browser: 10. Show Remote Screen
    
    loop Real-time Stream
        Agent->>Agent: Capture Screen
        Agent-->>Frontend: Send Frame (WebSocket)
        Frontend->>Browser: Render Frame
        
        Browser->>Frontend: Send Input (Click/Key)
        Frontend-->>Backend: Forward via WebSocket
        Backend-->>Agent: Send Command
        Agent->>Agent: Execute Locally
    end
```

---

## Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant Frontend
    participant Backend
    participant DB as PostgreSQL
    
    User->>Browser: 1. Open Login Page
    Browser->>Frontend: 2. Load Login UI (Next.js)
    
    User->>Browser: 3. Enter Credentials
    Browser->>Frontend: 4. Submit Form
    Frontend->>Backend: 5. POST /api/auth/login
    Backend->>DB: 6. Query User
    DB-->>Backend: 7. Return User Record
    
    Backend->>Backend: 8. Compare Password<br/>(bcrypt)
    
    alt Password Valid
        Backend->>Backend: 9. Generate JWT Token
        Backend-->>Frontend: 10. Return Token
        Frontend->>Browser: 11. Store Token<br/>(localStorage/cookie)
        Browser-->>User: 12. Redirect to Dashboard
    else Password Invalid
        Backend-->>Frontend: 13. Return Error
        Frontend->>Browser: 14. Show Error Message
    end
    
    Note over Frontend,Backend: Subsequent Requests include JWT<br/>Authorization: Bearer [token]
```

---

## Go Agent Registration & Communication

```mermaid
sequenceDiagram
    participant Device as Go Agent<br/>Remote Device
    participant Backend
    participant DB as PostgreSQL
    
    Device->>Device: 1. Start Agent Service
    Device->>Device: 2. Load config.json
    Device->>Backend: 3. POST /api/devices/register<br/>(Device ID, OS, Version)
    
    Backend->>DB: 4. Check If Exists
    alt First Registration
        Backend->>DB: 5. Create Device Record
    else Already Registered
        Backend->>DB: 5. Update Last Seen
    end
    
    DB-->>Backend: 6. Confirm
    Backend-->>Device: 7. Return Registration Token
    Device->>Device: 8. Save Token
    
    loop Heartbeat Every 30s
        Device->>Backend: 9. POST /api/devices/heartbeat<br/>(Device ID, Status)
        Backend->>DB: 10. Update Last Heartbeat
        Backend-->>Device: 11. ACK + Pending Commands
        Device->>Device: 12. Execute Commands
    end
    
    alt User Requests Control
        Backend->>Device: 13. Initiate WebSocket
        Device->>Backend: 14. Open WebSocket
        Backend->>Device: 15. Send: 'StartRemoteDesktop'
        Device->>Device: 16. Start Screen Capture
        Device-->>Backend: 17. Stream Video Frames
        Backend-->>Frontend: 18. Relay to User
    end
```

---

## Deployment Architecture

```mermaid
graph LR
    subgraph internet["Internet"]
        users["👥 Users Worldwide"]
    end
    
    subgraph cloudflare["Cloudflare CDN & Tunnel"]
        cdn["Global CDN<br/>Edge Servers"]
        tunnel["Secure Tunnel"]
    end
    
    subgraph cloud_provider["Cloud Provider<br/>(AWS/GCP/Azure/DigitalOcean)"]
        lb["Load Balancer"]
        
        subgraph instances["Compute Instances<br/>(Auto-scaling)"]
            app1["Node.js + Next.js<br/>Instance 1"]
            app2["Node.js + Next.js<br/>Instance 2"]
            appN["Node.js + Next.js<br/>Instance N"]
        end
        
        turn_server["TURN Server<br/>Instance"]
        
        subgraph storage["Storage"]
            db_primary["PostgreSQL<br/>Primary"]
            db_replica["PostgreSQL<br/>Replica"]
            uploads["File Storage<br/>S3/Blob"]
        end
        
        monitoring["Monitoring &<br/>Logging"]
    end
    
    users -->|DNS| cdn
    users -->|HTTPS| tunnel
    
    cdn -->|Cache| tunnel
    tunnel -->|Route| lb
    
    lb -->|Distribute| app1
    lb -->|Distribute| app2
    lb -->|Distribute| appN
    
    app1 -->|Query| db_primary
    app2 -->|Query| db_primary
    appN -->|Query| db_primary
    
    db_primary -->|Replicate| db_replica
    
    app1 -->|Upload| uploads
    app2 -->|Upload| uploads
    appN -->|Upload| uploads
    
    app1 -->|Metrics| monitoring
    app2 -->|Metrics| monitoring
    turn_server -->|Metrics| monitoring
    
    lb -->|UDP/TCP| turn_server
    
    style users fill:#4CAF50
    style cdn fill:#FFC107
    style tunnel fill:#FFC107
    style app1 fill:#2196F3
    style db_primary fill:#F44336
    style uploads fill:#9C27B0
    style monitoring fill:#00BCD4
```

---

## Technology Stack Overview

```mermaid
graph TB
    subgraph client_layer["CLIENT LAYER"]
        web["🌐 Web UI<br/>Next.js 16<br/>React 19<br/>TailwindCSS"]
        mobile["📱 Mobile<br/>Via Browser<br/>Responsive"]
    end
    
    subgraph network["NETWORK LAYER"]
        cf["Cloudflare Tunnel<br/>SSL/TLS<br/>DDoS Protection"]
    end
    
    subgraph api_layer["API LAYER"]
        express["Express.js 5.2<br/>REST API<br/>HTTP/HTTPS"]
        ws["WebSocket (ws 8.20)<br/>Real-time<br/>Bidirectional"]
    end
    
    subgraph service_layer["SERVICE LAYER"]
        auth["🔐 Authentication<br/>JWT + bcrypt<br/>Session Mgmt"]
        device["🖥️ Device Mgmt<br/>Registration<br/>Status Tracking"]
        remote["🎮 Remote Control<br/>Screen Share<br/>Input Relay"]
        file["📁 File Transfer<br/>Upload/Download<br/>Multer"]
    end
    
    subgraph data_layer["DATA LAYER"]
        postgres["PostgreSQL 12+<br/>Users, Devices,<br/>Sessions, Logs"]
        cache["Cache<br/>Optional:<br/>Redis"]
    end
    
    subgraph edge["EDGE / RELAY"]
        turn["TURN/STUN<br/>WebRTC<br/>NAT Traversal"]
    end
    
    subgraph agent_layer["REMOTE DEVICES"]
        agent["Go Agent<br/>Screen Capture<br/>Command Execute<br/>File Ops"]
    end
    
    web -->|HTTPS| cf
    mobile -->|HTTPS| cf
    cf -->|HTTP| express
    cf -->|WS| ws
    cf -->|UDP/TCP| turn
    
    express --> auth
    express --> device
    express --> remote
    express --> file
    
    ws --> remote
    
    auth --> postgres
    device --> postgres
    remote --> postgres
    file --> postgres
    
    remote -.->|Optional| cache
    
    express -.->|Heartbeat| agent
    ws -.->|Stream| agent
    ws -.->|Control| agent
    
    turn -.->|Relay| agent
    
    style web fill:#FF9800
    style cf fill:#FFC107
    style express fill:#2196F3
    style postgres fill:#F44336
    style agent fill:#9C27B0
    style turn fill:#00BCD4
```

---

## Cloud Migration Path

```mermaid
graph LR
    A["📍 Current Setup<br/>Vultr VPS<br/>Single Server"] -->|Decision| B{Choose Cloud}
    
    B -->|Quick & Easy| C["☁️ Heroku<br/>Git Push Deploy<br/>$7-25/mo"]
    B -->|Good Balance| D["☁️ DigitalOcean<br/>App Platform<br/>$12-30/mo"]
    B -->|Enterprise| E["☁️ AWS<br/>EC2 + RDS<br/>$20-100/mo"]
    B -->|Multi-Cloud| F["☁️ Azure<br/>App Service<br/>$15-50/mo"]
    
    C --> G["✅ Migration Steps<br/>1. Setup App Platform<br/>2. Push Code<br/>3. Configure DB<br/>4. Set Env Vars<br/>5. Deploy"]
    D --> G
    E --> G
    F --> G
    
    G --> H["🚀 Live in Cloud"]
    
    H --> I["📊 Monitor &<br/>Optimize<br/>- Performance<br/>- Cost<br/>- Security"]
    
    I --> J{Need More<br/>Scale?}
    
    J -->|No| K["✅ Success"]
    J -->|Yes| L["🔄 Upgrade Plan<br/>or Migrate to<br/>AWS/Multi-region"]
    
    L --> K
    
    style A fill:#2196F3
    style C fill:#FF9800
    style D fill:#4CAF50
    style E fill:#F44336
    style G fill:#FFC107
    style H fill:#9C27B0
    style K fill:#4CAF50
```

---

## File Structure & Module Organization

```mermaid
graph TB
    root["remote-control/"]
    
    root --> agent["📁 agent/<br/>Go Application"]
    agent --> a1["main.go"]
    agent --> a2["config.go"]
    agent --> a3["register.go"]
    agent --> a4["heartbeat.go"]
    agent --> a5["remote_desktop.go"]
    agent --> a6["file_transfer.go"]
    agent --> a7["executor.go"]
    agent --> a8["ws.go<br/>(WebSocket)"]
    agent --> amod["go.mod<br/>go.sum"]
    
    root --> server["📁 server/<br/>Node.js Backend"]
    server --> src["src/"]
    src --> s1["index.ts<br/>(Entry)"]
    src --> s2["routes/"]
    src --> s3["controllers/"]
    src --> s4["middleware/"]
    src --> s5["utils/"]
    server --> spkg["package.json"]
    server --> senv[".env"]
    
    root --> web["📁 web/<br/>Next.js Frontend"]
    web --> app["app/"]
    web --> pub["public/"]
    web --> wpkg["package.json"]
    web --> wenv[".env.production"]
    
    root --> shared["📁 shared/<br/>Common Code"]
    shared --> types["types/"]
    shared --> utils["utils/"]
    shared --> const["constants/"]
    
    root --> docs["📁 docs/"]
    docs --> readme["README.md"]
    docs --> arch["ARCHITECTURE.md"]
    docs --> deps["DEPENDENCIES.md"]
    
    root --> scripts["📁 scripts/"]
    scripts --> deploy["deploy.sh"]
    scripts --> backup["backup.sh"]
    
    style root fill:#f0f0f0
    style agent fill:#9C27B0
    style server fill:#2196F3
    style web fill:#FF9800
    style docs fill:#4CAF50
```

