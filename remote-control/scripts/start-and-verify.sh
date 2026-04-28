#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
WEB_DIR="$PROJECT_ROOT/web"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"
LOG_DIR="$PROJECT_ROOT/.logs"
RUN_DIR="$PROJECT_ROOT/.run"

BACKEND_LOCAL="http://localhost:3000/health"
FRONTEND_LOCAL="http://localhost:3201"
ROUTER_LOCAL="http://localhost:3001"
BACKEND_PUBLIC="https://netraapi.shivomsangha.com/health"
FRONTEND_PUBLIC="https://netralink.shivomsangha.com"
TIMEOUT="${TIMEOUT:-45}"

RESTART=0
SKIP_PUBLIC=0

BACKEND_STATUS="FAIL"
FRONTEND_STATUS="FAIL"
ROUTER_STATUS="FAIL"
CLOUDFLARED_STATUS="FAIL"
BACKEND_PUBLIC_STATUS="SKIP"
FRONTEND_PUBLIC_STATUS="SKIP"

mkdir -p "$LOG_DIR" "$RUN_DIR"

step() {
  printf "\n==> %s\n" "$1"
}

fail() {
  printf "\n[FAIL] %s\n" "$1" >&2
  print_summary "FAILED"
  exit 1
}

check_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

package_has_script() {
  local package_file="$1"
  local script_name="$2"

  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.exit(pkg.scripts && pkg.scripts[process.argv[2]] ? 0 : 1);
  ' "$package_file" "$script_name"
}

check_port() {
  local port="$1"

  if has_command ss; then
    ss -ltn "( sport = :$port )" | tail -n +2 | grep -q ":$port"
    return $?
  fi

  if has_command lsof; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

wait_for_url() {
  local url="$1"
  local timeout="$2"
  local expected="${3:-}"
  local start
  local body

  start="$(date +%s)"
  while true; do
    body="$(curl -fsS --max-time 5 "$url" 2>/dev/null || true)"
    if [[ -n "$body" ]]; then
      if [[ -z "$expected" || "$body" == *"$expected"* ]]; then
        return 0
      fi
    fi

    if [ $(( $(date +%s) - start )) -ge "$timeout" ]; then
      return 1
    fi

    sleep 2
  done
}

stop_pidfile_process() {
  local name="$1"
  local pid_file="$2"

  [ -f "$pid_file" ] || return 0

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$pid_file"
    return 0
  fi

  echo "Stopping $name pid $pid"
  kill "$pid" >/dev/null 2>&1 || true

  for _ in {1..15}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$pid_file"
      return 0
    fi
    sleep 1
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
  rm -f "$pid_file"
}

pm2_process_exists() {
  has_command pm2 && pm2 describe "$1" >/dev/null 2>&1
}

start_pm2_if_configured() {
  local name="$1"

  if ! pm2_process_exists "$name"; then
    return 1
  fi

  if [ "$RESTART" -eq 1 ]; then
    pm2 restart "$name" --update-env
  else
    pm2 start "$name" --update-env
  fi
}

start_backend() {
  step "Checking backend"

  if [ "$RESTART" -eq 1 ]; then
    if pm2_process_exists setulink-backend; then
      pm2 restart setulink-backend --update-env
    else
      stop_pidfile_process backend "$RUN_DIR/backend.pid"
    fi
  fi

  if check_port 3000; then
    echo "Backend already listening on 3000"
  else
    echo "Starting backend"
    if ! start_pm2_if_configured setulink-backend; then
      (
        cd "$SERVER_DIR"
        if package_has_script package.json start; then
          nohup npm start > "$LOG_DIR/backend.out.log" 2> "$LOG_DIR/backend.err.log" &
        else
          nohup node src/index.js > "$LOG_DIR/backend.out.log" 2> "$LOG_DIR/backend.err.log" &
        fi
        echo "$!" > "$RUN_DIR/backend.pid"
      )
    fi
  fi

  wait_for_url "$BACKEND_LOCAL" "$TIMEOUT" '"ok":true' || {
    tail -n 50 "$LOG_DIR/backend.err.log" 2>/dev/null || true
    pm2_process_exists setulink-backend && pm2 logs setulink-backend --lines 50 --nostream || true
    fail "Backend failed health check: $BACKEND_LOCAL"
  }

  BACKEND_STATUS="OK"
}

start_frontend() {
  step "Checking frontend"

  if [ "$RESTART" -eq 1 ]; then
    if pm2_process_exists setulink-frontend; then
      pm2 restart setulink-frontend --update-env
    else
      stop_pidfile_process frontend "$RUN_DIR/frontend.pid"
    fi
  fi

  if check_port 3201; then
    echo "Frontend already listening on 3201"
  else
    echo "Starting frontend"
    if ! start_pm2_if_configured setulink-frontend; then
      (
        cd "$WEB_DIR"
        if [ ! -d .next ]; then
          npm run build > "$LOG_DIR/frontend.build.log" 2>&1
        fi
        nohup npm start -- -H 127.0.0.1 -p 3201 > "$LOG_DIR/frontend.out.log" 2> "$LOG_DIR/frontend.err.log" &
        echo "$!" > "$RUN_DIR/frontend.pid"
      )
    fi
  fi

  wait_for_url "$FRONTEND_LOCAL" "$TIMEOUT" "<html" || {
    tail -n 50 "$LOG_DIR/frontend.err.log" 2>/dev/null || true
    tail -n 50 "$LOG_DIR/frontend.build.log" 2>/dev/null || true
    pm2_process_exists setulink-frontend && pm2 logs setulink-frontend --lines 50 --nostream || true
    fail "Frontend failed local check: $FRONTEND_LOCAL"
  }

  FRONTEND_STATUS="OK"
}

start_router() {
  step "Checking origin router"

  if [ "$RESTART" -eq 1 ]; then
    if pm2_process_exists setulink-origin-router; then
      pm2 restart setulink-origin-router --update-env
    else
      stop_pidfile_process router "$RUN_DIR/router.pid"
    fi
  fi

  if check_port 3001; then
    echo "Origin router already listening on 3001"
  else
    echo "Starting origin router"
    if ! start_pm2_if_configured setulink-origin-router; then
      (
        cd "$PROJECT_ROOT"
        nohup node "$SCRIPTS_DIR/origin-router.js" > "$LOG_DIR/router.out.log" 2> "$LOG_DIR/router.err.log" &
        echo "$!" > "$RUN_DIR/router.pid"
      )
    fi
  fi

  wait_for_url "$ROUTER_LOCAL" "$TIMEOUT" "<html" || {
    tail -n 50 "$LOG_DIR/router.err.log" 2>/dev/null || true
    tail -n 50 "$LOG_DIR/router.out.log" 2>/dev/null || true
    pm2_process_exists setulink-origin-router && pm2 logs setulink-origin-router --lines 50 --nostream || true
    fail "Origin router failed local check: $ROUTER_LOCAL"
  }

  ROUTER_STATUS="OK"
}

ensure_cloudflared() {
  step "Checking Cloudflare tunnel service"
  systemctl list-unit-files cloudflared.service --no-pager --no-legend 2>/dev/null \
    | awk '{print $1}' \
    | grep -qx 'cloudflared.service' \
    || fail "cloudflared service not installed"

  if ! systemctl is-active --quiet cloudflared; then
    echo "Starting cloudflared"
    if [ "$(id -u)" -eq 0 ]; then
      systemctl start cloudflared || true
    elif has_command sudo; then
      sudo -n systemctl start cloudflared || true
    else
      systemctl start cloudflared || true
    fi
  fi

  systemctl is-active --quiet cloudflared || {
    systemctl status cloudflared --no-pager || true
    journalctl -u cloudflared -n 50 --no-pager || true
    fail "cloudflared service is not running"
  }

  CLOUDFLARED_STATUS="OK"
}

verify_public() {
  if [ "$SKIP_PUBLIC" -eq 1 ]; then
    BACKEND_PUBLIC_STATUS="SKIP"
    FRONTEND_PUBLIC_STATUS="SKIP"
    return 0
  fi

  step "Verifying public endpoints"

  if wait_for_url "$BACKEND_PUBLIC" "$TIMEOUT" '"ok":true'; then
    BACKEND_PUBLIC_STATUS="OK"
  else
    BACKEND_PUBLIC_STATUS="FAIL"
    fail "Public backend failed: $BACKEND_PUBLIC"
  fi

  if wait_for_url "$FRONTEND_PUBLIC" "$TIMEOUT" "<html"; then
    FRONTEND_PUBLIC_STATUS="OK"
  else
    FRONTEND_PUBLIC_STATUS="FAIL"
    fail "Public frontend failed: $FRONTEND_PUBLIC"
  fi
}

print_summary() {
  local overall="${1:-HEALTHY}"

  printf "\n=== FINAL STATUS ===\n"
  printf "Backend local: %s\n" "$BACKEND_STATUS"
  printf "Frontend local: %s\n" "$FRONTEND_STATUS"
  printf "Origin router local: %s\n" "$ROUTER_STATUS"
  printf "Cloudflared service: %s\n" "$CLOUDFLARED_STATUS"
  printf "Backend public: %s\n" "$BACKEND_PUBLIC_STATUS"
  printf "Frontend public: %s\n" "$FRONTEND_PUBLIC_STATUS"
  printf "Overall: %s\n" "$overall"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --restart)
        RESTART=1
        shift
        ;;
      --skip-public)
        SKIP_PUBLIC=1
        shift
        ;;
      --timeout)
        [ "$#" -ge 2 ] || fail "--timeout requires seconds"
        TIMEOUT="$2"
        shift 2
        ;;
      -h|--help)
        echo "Usage: $0 [--restart] [--skip-public] [--timeout seconds]"
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  step "Preflight checks"
  check_command node
  check_command npm
  check_command curl
  check_command systemctl

  [ -d "$SERVER_DIR" ] || fail "Missing server directory: $SERVER_DIR"
  [ -d "$WEB_DIR" ] || fail "Missing web directory: $WEB_DIR"
  [ -f "$SERVER_DIR/.env" ] || fail "Missing backend .env: $SERVER_DIR/.env"

  if [ ! -f "$WEB_DIR/.env" ] && [ ! -f "$WEB_DIR/.env.local" ] && [ ! -f "$WEB_DIR/.env.production" ]; then
    echo "Frontend env file not found; continuing because defaults may be sufficient"
  fi

  start_backend
  start_frontend
  start_router
  ensure_cloudflared
  verify_public

  print_summary "HEALTHY"
}

main "$@"
