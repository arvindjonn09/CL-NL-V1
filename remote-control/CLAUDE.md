# Repository Operating Notes

## Fixed Origin Ports

Before any update, deploy, restart, or routing change, check the current origin port map. These ports are operational contracts and must not be changed unless the user explicitly asks for a port migration.

- `3000`: backend API for `https://netraapi.shivomsangha.com` — Cloudflare tunnel hard-lock
- `3001`: origin router for `https://netralink.shivomsangha.com` — Cloudflare tunnel hard-lock
- `3201`: NetraLink frontend behind the origin router
- `3478`: TURN/STUN server for `https://netraturn.shivomsangha.com` — **CLOUDFLARE TUNNEL HARD-LOCK** (see section below)

The Cloudflare tunnel routes frontend traffic to the origin router on port `3001`. The origin router (`scripts/origin-router.js`) forwards the `netralink.shivomsangha.com` host to the frontend on port `3201`.

Before changing runtime setup, verify:

```bash
ss -ltnp | grep -E ':3000|:3001|:3201|:3478'
curl -s http://localhost:3000/api/health
curl -s http://localhost:3201/
curl -s -H 'Host: netralink.shivomsangha.com' http://localhost:3001/
```

Expected:

- Port 3000: `{"ok":true,...}`
- Port 3201: Next.js HTML response
- Port 3001: router-served HTML response for the frontend host

---

## HARD-LOCKED PORT — DO NOT CHANGE — PORT 3478 (TURN Server)

**`netraturn.shivomsangha.com` is tunneled to Cloudflare and MUST always run on port `3478`.**

### ⛔ STOP — If you or any AI assistant is about to change, reassign, kill, or move port 3478:

> **DO NOT PROCEED.**
>
> Port `3478` is the standard TURN/STUN protocol port and is permanently registered in the Cloudflare tunnel configuration for `netraturn.shivomsangha.com`. Cloudflare routes external UDP/TCP traffic for WebRTC peer connections directly to `localhost:3478`. Changing this port will:
>
> - Immediately break all WebRTC connections relayed through this server
> - Require a Cloudflare tunnel reconfiguration (external action, not a code change)
> - Cause outages for all users relying on TURN for NAT traversal
>
> **This port is NOT configurable via any local file, environment variable, or code change alone.**
> If a port change is truly required, the user (Shiva) must explicitly authorize it AND update the Cloudflare tunnel config manually before touching the application.

### Allowed actions on port 3478:
- Restarting the TURN server process (same port, no change)
- Checking if the process is alive: `ss -ltnup | rg ':3478'`
- Viewing logs of the TURN server

### Forbidden without explicit user authorization:
- Changing the port number in any config file
- Binding the TURN server to any port other than `3478`
- Stopping the TURN server without an immediate restart plan on the same port
