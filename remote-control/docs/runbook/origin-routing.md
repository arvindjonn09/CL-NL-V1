# Origin Routing

The public frontend hostnames share the same Cloudflare/local origin entrypoint. Local routing must preserve this fixed port map.

## Fixed Ports

- `3000`: backend API — Cloudflare tunnel `netraapi.shivomsangha.com` → `http://127.0.0.1:3000`
- `3001`: origin router — Cloudflare tunnel `netralink.shivomsangha.com` → `http://127.0.0.1:3001`
- `3201`: SetuLink Next.js frontend behind the origin router
- `3478`: TURN server — Cloudflare tunnel `netraturn.shivomsangha.com` → `http://127.0.0.1:3478`

The origin router (`scripts/origin-router.js`) is the public entrypoint for the frontend. It forwards `netralink.shivomsangha.com` requests from port `3001` to the Next.js app on port `3201`.

Do not change these ports. They are registered in the Cloudflare tunnel configuration.

## Pre-Update Check

Run this before deploys, assistant updates, Claude sessions, Cloudflare changes, or service restarts:

```bash
ss -ltnp | grep -E ':3000|:3001|:3201|:3478'
curl -s http://localhost:3000/api/health
curl -s http://localhost:3201/ | grep -o '<title>[^<]*'
curl -s -H 'Host: netralink.shivomsangha.com' http://localhost:3001/ | grep -o '<title>[^<]*'
```

Expected:

- Port 3000: `{"ok":true,...}`
- Port 3201: Next.js HTML with app title
- Port 3001: router-served HTML for the frontend host
