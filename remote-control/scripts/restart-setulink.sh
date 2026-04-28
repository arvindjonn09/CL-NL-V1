#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
WEB_DIR="$PROJECT_ROOT/web"
LOG_DIR="$PROJECT_ROOT/.logs"
RUN_DIR="$PROJECT_ROOT/.run"

BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-3201}"
ROUTER_PORT="${ROUTER_PORT:-3001}"
BACKEND_PUBLIC_URL="${BACKEND_PUBLIC_URL:-https://netraapi.shivomsangha.com/api/health}"
FRONTEND_PUBLIC_URL="${FRONTEND_PUBLIC_URL:-https://netralink.shivomsangha.com}"
TIMEOUT="${TIMEOUT:-45}"
SKIP_PUBLIC="${SKIP_PUBLIC:-0}"

BACKEND_LOCAL_URL="http://localhost:${BACKEND_PORT}/api/health"
FRONTEND_LOCAL_URL="http://localhost:${FRONTEND_PORT}"
ROUTER_LOCAL_URL="http://localhost:${ROUTER_PORT}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TRANSCRIPT="$LOG_DIR/restart-setulink-$STAMP.log"

BACKEND_LOCAL_STATUS="FAIL"
FRONTEND_LOCAL_STATUS="FAIL"
ROUTER_LOCAL_STATUS="FAIL"
ADMIN_LOCAL_STATUS="FAIL"
REMOTEACCESS_LOCAL_STATUS="FAIL"
DOCS_INSTALL_LOCAL_STATUS="SKIP"
DOCS_TROUBLESHOOTING_LOCAL_STATUS="SKIP"
BACKEND_PUBLIC_STATUS="FAIL"
FRONTEND_PUBLIC_STATUS="FAIL"
ADMIN_PUBLIC_STATUS="FAIL"
REMOTEACCESS_PUBLIC_STATUS="FAIL"
DOCS_INSTALL_PUBLIC_STATUS="SKIP"
DOCS_TROUBLESHOOTING_PUBLIC_STATUS="SKIP"
STUN_STATUS="MISSING"
TURN_URLS_STATUS="MISSING"
TURN_USERNAME_STATUS="MISSING"
TURN_CREDENTIAL_STATUS="MISSING"
TURN_STATUS="MISSING"
OVERALL_RESTART_STATUS="FAIL"
LOCAL_HEALTH_STATUS="FAIL"
PUBLIC_REACHABILITY_STATUS="FAIL"
REMOTE_DESKTOP_READINESS_STATUS="WARN"

declare -a LOCAL_CHECKS=()
declare -a PUBLIC_CHECKS=()

mkdir -p "$LOG_DIR" "$RUN_DIR"
exec > >(tee -a "$TRANSCRIPT") 2>&1

usage() {
  cat <<USAGE
Usage: scripts/restart-setulink.sh [options]

Options:
  --backend-port PORT       Backend port. Default: $BACKEND_PORT
  --frontend-port PORT      Frontend app port. Default: $FRONTEND_PORT
  --router-port PORT        Origin router port. Default: $ROUTER_PORT
  --backend-public-url URL  Public backend health URL.
  --frontend-public-url URL Public frontend URL.
  --timeout SECONDS         Startup wait timeout. Default: $TIMEOUT
  --skip-public             Skip public/Cloudflare reachability checks.
  -h, --help                Show this help.

Environment variables with the same uppercase names are also supported.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-port)
      BACKEND_PORT="$2"
      shift 2
      ;;
    --frontend-port)
      FRONTEND_PORT="$2"
      shift 2
      ;;
    --router-port)
      ROUTER_PORT="$2"
      shift 2
      ;;
    --backend-public-url)
      BACKEND_PUBLIC_URL="$2"
      shift 2
      ;;
    --frontend-public-url)
      FRONTEND_PUBLIC_URL="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --skip-public)
      SKIP_PUBLIC=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

BACKEND_LOCAL_URL="http://localhost:${BACKEND_PORT}/api/health"
FRONTEND_LOCAL_URL="http://localhost:${FRONTEND_PORT}"
ROUTER_LOCAL_URL="http://localhost:${ROUTER_PORT}"

step() {
  printf "\n==> %s\n" "$1"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

require_command() {
  if ! has_command "$1"; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

start_detached() {
  local pid_file="$1"
  local stdout_log="$2"
  local stderr_log="$3"
  shift 3

  if has_command setsid; then
    setsid sh -c 'echo $$ > "$1"; shift; exec "$@"' sh "$pid_file" "$@" >> "$stdout_log" 2>> "$stderr_log" &
  else
    nohup sh -c 'echo $$ > "$1"; shift; exec "$@"' sh "$pid_file" "$@" >> "$stdout_log" 2>> "$stderr_log" &
  fi
}

listen_pids_for_port() {
  local port="$1"

  if has_command fuser; then
    fuser -n tcp "$port" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u
    return 0
  fi

  if has_command lsof; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
    return 0
  fi

  if has_command ss; then
    ss -H -ltnp "sport = :$port" 2>/dev/null \
      | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' \
      | sort -u
    return 0
  fi
}

stop_pid() {
  local pid="$1"
  local label="$2"

  if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  echo "Stopping $label pid $pid"
  kill "$pid" >/dev/null 2>&1 || true

  for _ in {1..15}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Force stopping $label pid $pid"
  kill -9 "$pid" >/dev/null 2>&1 || true
}

stop_pidfile_process() {
  local label="$1"
  local pid_file="$2"

  [[ -f "$pid_file" ]] || return 0

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  stop_pid "$pid" "$label"
  rm -f "$pid_file"
}

stop_port_processes() {
  local port="$1"
  local label="$2"
  local found=0

  step "Stopping $label on port $port"

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    found=1
    stop_pid "$pid" "$label"
  done < <(listen_pids_for_port "$port")

  if [[ "$found" -eq 0 ]]; then
    echo "$label is not listening on port $port"
  fi
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

start_backend() {
  step "Starting backend"

  (
    cd "$SERVER_DIR"
    if package_has_script package.json start; then
      start_detached "$RUN_DIR/backend.pid" "$LOG_DIR/backend.out.log" "$LOG_DIR/backend.err.log" npm start
    else
      start_detached "$RUN_DIR/backend.pid" "$LOG_DIR/backend.out.log" "$LOG_DIR/backend.err.log" node src/index.js
    fi
    sleep 0.2
    echo "Backend pid: $(cat "$RUN_DIR/backend.pid" 2>/dev/null || echo unknown)"
  )
}

start_frontend() {
  step "Starting frontend"

  (
    cd "$WEB_DIR"
    if [[ ! -d .next ]]; then
      echo "No .next build found; running npm run build"
      npm run build >> "$LOG_DIR/frontend.build.log" 2>&1
    fi

    start_detached "$RUN_DIR/frontend.pid" "$LOG_DIR/frontend.out.log" "$LOG_DIR/frontend.err.log" npm start -- -H 0.0.0.0 -p "$FRONTEND_PORT"
    sleep 0.2
    echo "Frontend pid: $(cat "$RUN_DIR/frontend.pid" 2>/dev/null || echo unknown)"
  )
}

start_router() {
  step "Starting origin router"

  (
    cd "$PROJECT_ROOT"
    start_detached "$RUN_DIR/router.pid" "$LOG_DIR/router.out.log" "$LOG_DIR/router.err.log" env ORIGIN_ROUTER_PORT="$ROUTER_PORT" node scripts/origin-router.js
    sleep 0.2
    echo "Origin router pid: $(cat "$RUN_DIR/router.pid" 2>/dev/null || echo unknown)"
  )
}

fetch_url() {
  local url="$1"
  local body_file="$2"
  local status

  status="$(
    curl --silent --show-error --location \
      --max-time 8 \
      --output "$body_file" \
      --write-out "%{http_code}" \
      "$url" 2>/tmp/setulink-curl-error.$$ || true
  )"

  if [[ "$status" =~ ^[23] ]]; then
    rm -f /tmp/setulink-curl-error.$$
    return 0
  fi

  local reason
  reason="$(cat /tmp/setulink-curl-error.$$ 2>/dev/null || true)"
  rm -f /tmp/setulink-curl-error.$$

  if [[ -n "$status" && "$status" != "000" ]]; then
    echo "HTTP $status"
  elif [[ -n "$reason" ]]; then
    echo "$reason"
  else
    echo "unreachable"
  fi

  return 1
}

check_url() {
  local label="$1"
  local url="$2"
  local expected="${3:-}"
  local body_file
  local reason

  body_file="$(mktemp)"

  if reason="$(fetch_url "$url" "$body_file")"; then
    if [[ -z "$expected" ]] || grep -q "$expected" "$body_file"; then
      rm -f "$body_file"
      echo "$label: OK ($url)"
      return 0
    fi

    rm -f "$body_file"
    echo "$label: FAIL ($url; missing expected text: $expected)"
    return 1
  fi

  rm -f "$body_file"
  echo "$label: FAIL ($url; $reason)"
  return 1
}

probe_url() {
  local url="$1"
  local expected="${2:-}"
  local body_file

  body_file="$(mktemp)"

  if fetch_url "$url" "$body_file" >/dev/null; then
    if [[ -z "$expected" ]] || grep -q "$expected" "$body_file"; then
      rm -f "$body_file"
      return 0
    fi
  fi

  rm -f "$body_file"
  return 1
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local expected="${3:-}"
  local start

  start="$(date +%s)"
  while true; do
    if probe_url "$url" "$expected"; then
      echo "$label: OK ($url)"
      return 0
    fi

    if (( "$(date +%s)" - start >= TIMEOUT )); then
      return 1
    fi

    sleep 2
  done
}

set_named_status() {
  local key="$1"
  local status="$2"

  case "$key" in
    BACKEND_LOCAL) BACKEND_LOCAL_STATUS="$status" ;;
    FRONTEND_LOCAL) FRONTEND_LOCAL_STATUS="$status" ;;
    ROUTER_LOCAL) ROUTER_LOCAL_STATUS="$status" ;;
    ADMIN_LOCAL) ADMIN_LOCAL_STATUS="$status" ;;
    REMOTEACCESS_LOCAL) REMOTEACCESS_LOCAL_STATUS="$status" ;;
    DOCS_INSTALL_LOCAL) DOCS_INSTALL_LOCAL_STATUS="$status" ;;
    DOCS_TROUBLESHOOTING_LOCAL) DOCS_TROUBLESHOOTING_LOCAL_STATUS="$status" ;;
    BACKEND_PUBLIC) BACKEND_PUBLIC_STATUS="$status" ;;
    FRONTEND_PUBLIC) FRONTEND_PUBLIC_STATUS="$status" ;;
    ADMIN_PUBLIC) ADMIN_PUBLIC_STATUS="$status" ;;
    REMOTEACCESS_PUBLIC) REMOTEACCESS_PUBLIC_STATUS="$status" ;;
    DOCS_INSTALL_PUBLIC) DOCS_INSTALL_PUBLIC_STATUS="$status" ;;
    DOCS_TROUBLESHOOTING_PUBLIC) DOCS_TROUBLESHOOTING_PUBLIC_STATUS="$status" ;;
  esac
}

configure_checks() {
  local docs_expected=0

  LOCAL_CHECKS=(
    "BACKEND_LOCAL|Backend local|${BACKEND_LOCAL_URL}|\"ok\":true"
    "FRONTEND_LOCAL|Frontend local|${FRONTEND_LOCAL_URL}|<html"
    "ROUTER_LOCAL|Origin router local|${ROUTER_LOCAL_URL}|<html"
    "ADMIN_LOCAL|Admin login local|${FRONTEND_LOCAL_URL}/admin|Admin Login"
    "REMOTEACCESS_LOCAL|RemoteAccess local|${FRONTEND_LOCAL_URL}/remoteaccess|SetuLink Remote Access"
  )

  PUBLIC_CHECKS=(
    "BACKEND_PUBLIC|Backend public|${BACKEND_PUBLIC_URL}|\"ok\":true"
    "FRONTEND_PUBLIC|Frontend public|${FRONTEND_PUBLIC_URL}|<html"
    "ADMIN_PUBLIC|Admin login public|${FRONTEND_PUBLIC_URL}/admin|Admin Login"
    "REMOTEACCESS_PUBLIC|RemoteAccess public|${FRONTEND_PUBLIC_URL}/remoteaccess|SetuLink Remote Access"
  )

  if [[ -f "$WEB_DIR/app/docs/runbook/[slug]/route.ts" ]]; then
    docs_expected=1
  fi
  if [[ -f "$PROJECT_ROOT/docs/runbook/install.md" || -f "$PROJECT_ROOT/docs/runbook/troubleshooting.md" ]]; then
    docs_expected=1
  fi

  if [[ "$docs_expected" -eq 1 ]]; then
    LOCAL_CHECKS+=(
      "DOCS_INSTALL_LOCAL|Docs install local|${FRONTEND_LOCAL_URL}/docs/runbook/install|# Install Runbook"
      "DOCS_TROUBLESHOOTING_LOCAL|Docs troubleshooting local|${FRONTEND_LOCAL_URL}/docs/runbook/troubleshooting|# Troubleshooting Runbook"
    )
    PUBLIC_CHECKS+=(
      "DOCS_INSTALL_PUBLIC|Docs install public|${FRONTEND_PUBLIC_URL}/docs/runbook/install|# Install Runbook"
      "DOCS_TROUBLESHOOTING_PUBLIC|Docs troubleshooting public|${FRONTEND_PUBLIC_URL}/docs/runbook/troubleshooting|# Troubleshooting Runbook"
    )
  fi
}

run_checks() {
  local scope="$1"
  local failed=0
  local item
  local key
  local label
  local url
  local expected
  local checks=()

  if [[ "$scope" == "local" ]]; then
    checks=("${LOCAL_CHECKS[@]}")
  else
    checks=("${PUBLIC_CHECKS[@]}")
  fi

  for item in "${checks[@]}"; do
    IFS='|' read -r key label url expected <<< "$item"
    if check_url "$label" "$url" "$expected"; then
      set_named_status "$key" "OK"
    else
      set_named_status "$key" "FAIL"
      failed=1
    fi
  done

  return "$failed"
}

config_presence_status() {
  local name="$1"
  local value="${!name:-}"

  if [[ -n "$value" ]]; then
    echo "CONFIGURED"
    return 0
  fi

  if [[ -f "$SERVER_DIR/.env" ]] && grep -Eq "^[[:space:]]*${name}[[:space:]]*=[[:space:]]*[^[:space:]#]+" "$SERVER_DIR/.env"; then
    echo "CONFIGURED"
  else
    echo "MISSING"
  fi
}

detect_webrtc_env() {
  step "Remote-desktop WebRTC environment"
  echo "Checking exported environment and server/.env presence only; secret values are not printed."

  STUN_STATUS="$(config_presence_status WEBRTC_STUN_URLS)"
  TURN_URLS_STATUS="$(config_presence_status WEBRTC_TURN_URLS)"
  TURN_USERNAME_STATUS="$(config_presence_status WEBRTC_TURN_USERNAME)"
  TURN_CREDENTIAL_STATUS="$(config_presence_status WEBRTC_TURN_CREDENTIAL)"

  if [[ "$TURN_URLS_STATUS" == "CONFIGURED" && "$TURN_USERNAME_STATUS" == "CONFIGURED" && "$TURN_CREDENTIAL_STATUS" == "CONFIGURED" ]]; then
    TURN_STATUS="CONFIGURED"
  else
    TURN_STATUS="MISSING"
  fi

  echo "WEBRTC_STUN_URLS: $STUN_STATUS"
  echo "WEBRTC_TURN_URLS: $TURN_URLS_STATUS"
  echo "WEBRTC_TURN_USERNAME: $TURN_USERNAME_STATUS"
  echo "WEBRTC_TURN_CREDENTIAL: $TURN_CREDENTIAL_STATUS"

  if [[ "$TURN_STATUS" != "CONFIGURED" ]]; then
    echo "WARNING: TURN not configured: same-LAN or simple NAT tests may work, but reliable unattended WAN remote desktop will not be dependable."
  fi
}

print_remote_desktop_notes() {
  step "Remote-desktop readiness notes"
  echo "Remote desktop signaling foundation deployed when backend/web checks pass."
  echo "Real live desktop on Windows agents still depends on bundled ffmpeg or system ffmpeg fallback, interactive desktop/session capture, and TURN for reliable WAN/NAT traversal if needed."
}

print_log_tail() {
  local label="$1"
  local file="$2"

  printf "\n--- last 50 lines: %s (%s) ---\n" "$label" "$file"
  if [[ -f "$file" ]]; then
    tail -n 50 "$file" || true
  else
    echo "No log file found."
  fi
}

print_summary() {
  local local_failed=0
  local public_failed=0

  [[ "$BACKEND_LOCAL_STATUS" == "OK" ]] || local_failed=1
  [[ "$FRONTEND_LOCAL_STATUS" == "OK" ]] || local_failed=1
  [[ "$ROUTER_LOCAL_STATUS" == "OK" ]] || local_failed=1
  [[ "$ADMIN_LOCAL_STATUS" == "OK" ]] || local_failed=1
  [[ "$REMOTEACCESS_LOCAL_STATUS" == "OK" ]] || local_failed=1
  [[ "$DOCS_INSTALL_LOCAL_STATUS" != "FAIL" ]] || local_failed=1
  [[ "$DOCS_TROUBLESHOOTING_LOCAL_STATUS" != "FAIL" ]] || local_failed=1

  if [[ "$SKIP_PUBLIC" -eq 1 ]]; then
    PUBLIC_REACHABILITY_STATUS="SKIP"
  else
    [[ "$BACKEND_PUBLIC_STATUS" == "OK" ]] || public_failed=1
    [[ "$FRONTEND_PUBLIC_STATUS" == "OK" ]] || public_failed=1
    [[ "$ADMIN_PUBLIC_STATUS" == "OK" ]] || public_failed=1
    [[ "$REMOTEACCESS_PUBLIC_STATUS" == "OK" ]] || public_failed=1
    [[ "$DOCS_INSTALL_PUBLIC_STATUS" != "FAIL" ]] || public_failed=1
    [[ "$DOCS_TROUBLESHOOTING_PUBLIC_STATUS" != "FAIL" ]] || public_failed=1

    if [[ "$public_failed" -eq 0 ]]; then
      PUBLIC_REACHABILITY_STATUS="PASS"
    else
      PUBLIC_REACHABILITY_STATUS="FAIL"
    fi
  fi

  if [[ "$local_failed" -eq 0 ]]; then
    LOCAL_HEALTH_STATUS="PASS"
  else
    LOCAL_HEALTH_STATUS="FAIL"
  fi

  if [[ "$TURN_STATUS" == "CONFIGURED" ]]; then
    REMOTE_DESKTOP_READINESS_STATUS="PASS"
  else
    REMOTE_DESKTOP_READINESS_STATUS="WARN"
  fi

  if [[ "$local_failed" -eq 0 && ( "$SKIP_PUBLIC" -eq 1 || "$public_failed" -eq 0 ) ]]; then
    OVERALL_RESTART_STATUS="PASS"
  else
    OVERALL_RESTART_STATUS="FAIL"
  fi

  printf "\n=== FINAL STATUS ===\n"
  printf "OVERALL RESTART: %s\n" "$OVERALL_RESTART_STATUS"
  printf "LOCAL HEALTH: %s\n" "$LOCAL_HEALTH_STATUS"
  printf "PUBLIC REACHABILITY: %s\n" "$PUBLIC_REACHABILITY_STATUS"
  printf "REMOTE DESKTOP READINESS: %s\n" "$REMOTE_DESKTOP_READINESS_STATUS"
  printf "\n--- Local Health ---\n"
  printf "Backend local: %s\n" "$BACKEND_LOCAL_STATUS"
  printf "Frontend local: %s\n" "$FRONTEND_LOCAL_STATUS"
  printf "Origin router local: %s\n" "$ROUTER_LOCAL_STATUS"
  printf "Admin local: %s\n" "$ADMIN_LOCAL_STATUS"
  printf "RemoteAccess local: %s\n" "$REMOTEACCESS_LOCAL_STATUS"
  printf "Docs install local: %s\n" "$DOCS_INSTALL_LOCAL_STATUS"
  printf "Docs troubleshooting local: %s\n" "$DOCS_TROUBLESHOOTING_LOCAL_STATUS"
  printf "\n--- Public Reachability ---\n"
  if [[ "$SKIP_PUBLIC" -eq 1 ]]; then
    printf "Backend public: SKIP\n"
    printf "Frontend public: SKIP\n"
    printf "Admin public: SKIP\n"
    printf "RemoteAccess public: SKIP\n"
    printf "Docs install public: SKIP\n"
    printf "Docs troubleshooting public: SKIP\n"
  else
    printf "Backend public: %s\n" "$BACKEND_PUBLIC_STATUS"
    printf "Frontend public: %s\n" "$FRONTEND_PUBLIC_STATUS"
    printf "Admin public: %s\n" "$ADMIN_PUBLIC_STATUS"
    printf "RemoteAccess public: %s\n" "$REMOTEACCESS_PUBLIC_STATUS"
    printf "Docs install public: %s\n" "$DOCS_INSTALL_PUBLIC_STATUS"
    printf "Docs troubleshooting public: %s\n" "$DOCS_TROUBLESHOOTING_PUBLIC_STATUS"
  fi
  printf "\n--- Remote Desktop Readiness ---\n"
  printf "STUN: %s\n" "$STUN_STATUS"
  printf "TURN: %s\n" "$TURN_STATUS"
  printf "Remote desktop: signaling foundation restarted; Windows live desktop runtime readiness still depends on bundled/system ffmpeg, interactive capture, and TURN when WAN/NAT requires it.\n"
  if [[ "$TURN_STATUS" != "CONFIGURED" ]]; then
    printf "\nTURN not configured: same-LAN or simple NAT tests may work, but reliable unattended WAN remote desktop will not be dependable.\n"
  fi
  printf "Backend local URL: %s\n" "$BACKEND_LOCAL_URL"
  printf "Frontend local URL: %s\n" "$FRONTEND_LOCAL_URL"
  printf "Origin router local URL: %s\n" "$ROUTER_LOCAL_URL"
  printf "Backend public URL: %s\n" "$BACKEND_PUBLIC_URL"
  printf "Frontend public URL: %s\n" "$FRONTEND_PUBLIC_URL"
  printf "Log: %s\n" "$TRANSCRIPT"
}

main() {
  require_command node
  require_command npm
  require_command curl

  [[ -d "$SERVER_DIR" ]] || { echo "Missing server directory: $SERVER_DIR" >&2; exit 1; }
  [[ -d "$WEB_DIR" ]] || { echo "Missing web directory: $WEB_DIR" >&2; exit 1; }

  stop_pidfile_process backend "$RUN_DIR/backend.pid"
  stop_pidfile_process frontend "$RUN_DIR/frontend.pid"
  stop_pidfile_process router "$RUN_DIR/router.pid"
  stop_port_processes "$BACKEND_PORT" backend
  stop_port_processes "$FRONTEND_PORT" frontend
  stop_port_processes "$ROUTER_PORT" origin-router

  start_backend
  start_frontend
  start_router
  configure_checks

  step "Verifying local backend"
  if wait_for_url "Backend local" "$BACKEND_LOCAL_URL" '"ok":true'; then
    BACKEND_LOCAL_STATUS="OK"
  else
    print_log_tail "backend stderr" "$LOG_DIR/backend.err.log"
    print_log_tail "backend stdout" "$LOG_DIR/backend.out.log"
  fi

  step "Verifying local frontend"
  if wait_for_url "Frontend local" "$FRONTEND_LOCAL_URL" "<html"; then
    FRONTEND_LOCAL_STATUS="OK"
  else
    print_log_tail "frontend stderr" "$LOG_DIR/frontend.err.log"
    print_log_tail "frontend stdout" "$LOG_DIR/frontend.out.log"
  fi

  step "Verifying local origin router"
  if wait_for_url "Origin router local" "$ROUTER_LOCAL_URL" "<html"; then
    ROUTER_LOCAL_STATUS="OK"
  else
    print_log_tail "router stderr" "$LOG_DIR/router.err.log"
    print_log_tail "router stdout" "$LOG_DIR/router.out.log"
  fi

  step "Checking local routes"
  run_checks local || true

  if [[ "$SKIP_PUBLIC" -eq 1 ]]; then
    BACKEND_PUBLIC_STATUS="SKIP"
    FRONTEND_PUBLIC_STATUS="SKIP"
    ADMIN_PUBLIC_STATUS="SKIP"
    REMOTEACCESS_PUBLIC_STATUS="SKIP"
    DOCS_INSTALL_PUBLIC_STATUS="SKIP"
    DOCS_TROUBLESHOOTING_PUBLIC_STATUS="SKIP"
  else
    step "Checking public/Cloudflare reachability"
    run_checks public || true
  fi

  detect_webrtc_env
  print_remote_desktop_notes
  print_summary

  if [[ "$OVERALL_RESTART_STATUS" != "PASS" ]]; then
    exit 1
  fi
}

main "$@"
