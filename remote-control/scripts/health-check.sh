#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
WEB_DIR="$PROJECT_ROOT/web"
LOG_DIR="$PROJECT_ROOT/.logs"

BACKEND_LOCAL="http://localhost:3000/health"
FRONTEND_LOCAL="http://localhost:3201"
ROUTER_LOCAL="http://localhost:3001"
BACKEND_PUBLIC="https://setuapi.shivomsangha.com/health"
FRONTEND_PUBLIC="https://setulink.shivomsangha.com"

CURL_TIMEOUT="${CURL_TIMEOUT:-8}"

BACKEND_STATUS="FAIL"
FRONTEND_STATUS="FAIL"
ROUTER_STATUS="FAIL"
CLOUDFLARED_STATUS="FAIL"
BACKEND_PUBLIC_STATUS="FAIL"
FRONTEND_PUBLIC_STATUS="FAIL"

mkdir -p "$LOG_DIR"

step() {
  printf "\n==> %s\n" "$1"
}

check_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf "[FAIL] Missing required command: %s\n" "$name" >&2
    return 1
  fi
}

has_command() {
  command -v "$1" >/dev/null 2>&1
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

fetch_url() {
  local url="$1"
  local body_file="$2"
  local status

  status="$(
    curl --silent --show-error --location \
      --max-time "$CURL_TIMEOUT" \
      --output "$body_file" \
      --write-out "%{http_code}" \
      "$url" 2>/dev/null || true
  )"

  [[ "$status" =~ ^[23] ]]
}

check_url() {
  local label="$1"
  local url="$2"
  local expected="${3:-}"
  local body_file

  body_file="$(mktemp)"

  if fetch_url "$url" "$body_file"; then
    if [[ -z "$expected" ]] || grep -q "$expected" "$body_file"; then
      rm -f "$body_file"
      printf "%s: OK\n" "$label"
      return 0
    fi

    printf "%s: FAIL (response missing expected text: %s)\n" "$label" "$expected" >&2
  else
    printf "%s: FAIL (unreachable: %s)\n" "$label" "$url" >&2
  fi

  rm -f "$body_file"
  return 1
}

print_log_tail() {
  local label="$1"
  local file="$2"

  printf "\n--- last 50 lines: %s (%s) ---\n" "$label" "$file" >&2
  if [[ -f "$file" ]]; then
    tail -n 50 "$file" >&2 || true
  else
    printf "No log file found.\n" >&2
  fi
}

preflight() {
  local failed=0

  step "Preflight checks"

  check_command node || failed=1
  check_command npm || failed=1
  check_command curl || failed=1
  check_command systemctl || failed=1

  if [[ ! -d "$SERVER_DIR" ]]; then
    printf "[FAIL] Missing server directory: %s\n" "$SERVER_DIR" >&2
    failed=1
  fi

  if [[ ! -d "$WEB_DIR" ]]; then
    printf "[FAIL] Missing web directory: %s\n" "$WEB_DIR" >&2
    failed=1
  fi

  if [[ ! -f "$SERVER_DIR/.env" ]]; then
    printf "[FAIL] Missing backend .env: %s/.env\n" "$SERVER_DIR" >&2
    failed=1
  fi

  if [[ "$failed" -eq 0 ]]; then
    printf "Preflight: OK\n"
  fi

  return "$failed"
}

check_backend_local() {
  step "Backend local health"

  if ! check_port 3000; then
    printf "Backend local: FAIL (port 3000 is not listening)\n" >&2
    print_log_tail "backend stderr" "$LOG_DIR/backend.err.log"
    print_log_tail "backend stdout" "$LOG_DIR/backend.out.log"
    return 1
  fi

  if check_url "Backend local" "$BACKEND_LOCAL" '"ok":true'; then
    BACKEND_STATUS="OK"
    return 0
  fi

  print_log_tail "backend stderr" "$LOG_DIR/backend.err.log"
  print_log_tail "backend stdout" "$LOG_DIR/backend.out.log"
  return 1
}

check_frontend_local() {
  step "Frontend local reachability"

  if ! check_port 3201; then
    printf "Frontend local: FAIL (port 3201 is not listening)\n" >&2
    print_log_tail "frontend stderr" "$LOG_DIR/frontend.err.log"
    print_log_tail "frontend stdout" "$LOG_DIR/frontend.out.log"
    return 1
  fi

  if check_url "Frontend local" "$FRONTEND_LOCAL" "<html"; then
    FRONTEND_STATUS="OK"
    return 0
  fi

  print_log_tail "frontend stderr" "$LOG_DIR/frontend.err.log"
  print_log_tail "frontend stdout" "$LOG_DIR/frontend.out.log"
  return 1
}

check_router_local() {
  step "Origin router local reachability"

  if ! check_port 3001; then
    printf "Origin router local: FAIL (port 3001 is not listening)\n" >&2
    print_log_tail "router stderr" "$LOG_DIR/router.err.log"
    print_log_tail "router stdout" "$LOG_DIR/router.out.log"
    return 1
  fi

  if check_url "Origin router local" "$ROUTER_LOCAL" "<html"; then
    ROUTER_STATUS="OK"
    return 0
  fi

  print_log_tail "router stderr" "$LOG_DIR/router.err.log"
  print_log_tail "router stdout" "$LOG_DIR/router.out.log"
  return 1
}

check_cloudflared() {
  step "Cloudflared service status"

  if ! systemctl list-unit-files cloudflared.service --no-pager --no-legend 2>/dev/null \
    | awk '{print $1}' \
    | grep -qx 'cloudflared.service'; then
    printf "Cloudflared: FAIL (service not installed)\n" >&2
    systemctl status cloudflared --no-pager >&2 || true
    return 1
  fi

  if systemctl is-active --quiet cloudflared; then
    CLOUDFLARED_STATUS="OK"
    printf "Cloudflared: OK\n"
    return 0
  fi

  printf "Cloudflared: FAIL (service is not active)\n" >&2
  systemctl status cloudflared --no-pager >&2 || true
  journalctl -u cloudflared -n 50 --no-pager >&2 || true
  return 1
}

check_public_endpoints() {
  step "Public endpoint checks"

  if check_url "Backend public" "$BACKEND_PUBLIC" '"ok":true'; then
    BACKEND_PUBLIC_STATUS="OK"
  fi

  if check_url "Frontend public" "$FRONTEND_PUBLIC" "<html"; then
    FRONTEND_PUBLIC_STATUS="OK"
  fi
}

print_summary() {
  local overall="HEALTHY"
  local exit_code=0

  if [[ "$BACKEND_STATUS" != "OK" || "$FRONTEND_STATUS" != "OK" || "$ROUTER_STATUS" != "OK" || "$CLOUDFLARED_STATUS" != "OK" ]]; then
    overall="FAILED"
    exit_code=1
  elif [[ "$BACKEND_PUBLIC_STATUS" != "OK" || "$FRONTEND_PUBLIC_STATUS" != "OK" ]]; then
    overall="DEGRADED"
    exit_code=1
  fi

  printf "\n=== FINAL STATUS ===\n"
  printf "Backend local: %s\n" "$BACKEND_STATUS"
  printf "Frontend local: %s\n" "$FRONTEND_STATUS"
  printf "Origin router local: %s\n" "$ROUTER_STATUS"
  printf "Cloudflared: %s\n" "$CLOUDFLARED_STATUS"
  printf "Backend public: %s\n" "$BACKEND_PUBLIC_STATUS"
  printf "Frontend public: %s\n" "$FRONTEND_PUBLIC_STATUS"
  printf "Overall: %s\n" "$overall"

  exit "$exit_code"
}

main() {
  preflight || true
  check_backend_local || true
  check_frontend_local || true
  check_router_local || true
  check_cloudflared || true
  check_public_endpoints || true
  print_summary
}

main "$@"
