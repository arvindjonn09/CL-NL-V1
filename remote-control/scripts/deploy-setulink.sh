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
TIMEOUT="${TIMEOUT:-60}"
INSTALL_DEPS="${INSTALL_DEPS:-auto}"

PUBLIC_API_ORIGIN="${PUBLIC_API_ORIGIN:-https://netraapi.shivomsangha.com}"
PUBLIC_FRONTEND_ORIGIN="${PUBLIC_FRONTEND_ORIGIN:-https://netralink.shivomsangha.com}"

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
BUILD_STATUS="FAIL"
RESTART_STATUS="FAIL"
AGENT_BUILD_STATUS="SKIP"
AGENT_BUILD_NOTE="Windows installer/agent package is not built by this Linux server deploy."
OVERALL_DEPLOY_STATUS="FAIL"
LOCAL_HEALTH_STATUS="FAIL"
PUBLIC_REACHABILITY_STATUS="FAIL"
REMOTE_DESKTOP_READINESS_STATUS="WARN"
STUN_STATUS="MISSING"
TURN_URLS_STATUS="MISSING"
TURN_USERNAME_STATUS="MISSING"
TURN_CREDENTIAL_STATUS="MISSING"
TURN_STATUS="MISSING"

declare -a SUMMARY_ROWS=()
declare -a LOCAL_CHECKS=()
declare -a PUBLIC_CHECKS=()

mkdir -p "$LOG_DIR" "$RUN_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TRANSCRIPT="$LOG_DIR/deploy-setulink-$STAMP.log"
exec > >(tee -a "$TRANSCRIPT") 2>&1

usage() {
  cat <<USAGE
Usage: scripts/deploy-setulink.sh [options]

Builds current local code, restarts SetuLink, and verifies local/public routes.
This script intentionally does not use Git.

Options:
  --backend-port PORT      Backend port. Default: $BACKEND_PORT
  --frontend-port PORT     Frontend app port. Default: $FRONTEND_PORT
  --router-port PORT       Origin router port. Default: $ROUTER_PORT
  --timeout SECONDS        Readiness timeout. Default: $TIMEOUT
  --install-deps MODE      auto, always, or never. Default: $INSTALL_DEPS
  -h, --help               Show this help.

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
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --install-deps)
      INSTALL_DEPS="$2"
      shift 2
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

BACKEND_LOCAL_HEALTH="http://localhost:${BACKEND_PORT}/api/health"
FRONTEND_LOCAL_ORIGIN="http://localhost:${FRONTEND_PORT}"
ROUTER_LOCAL_ORIGIN="http://localhost:${ROUTER_PORT}"
BACKEND_PUBLIC_HEALTH="${PUBLIC_API_ORIGIN}/api/health"

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

package_has_script() {
  local package_file="$1"
  local script_name="$2"

  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.exit(pkg.scripts && pkg.scripts[process.argv[2]] ? 0 : 1);
  ' "$package_file" "$script_name"
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

fetch_url() {
  local url="$1"
  local body_file="$2"
  local status
  local error_file

  error_file="$(mktemp)"
  status="$(
    curl --silent --show-error --location \
      --max-time 10 \
      --output "$body_file" \
      --write-out "%{http_code}" \
      "$url" 2>"$error_file" || true
  )"

  if [[ "$status" =~ ^[23] ]]; then
    rm -f "$error_file"
    return 0
  fi

  if [[ -n "$status" && "$status" != "000" ]]; then
    echo "HTTP $status"
  elif [[ -s "$error_file" ]]; then
    cat "$error_file"
  else
    echo "unreachable"
  fi

  rm -f "$error_file"
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
      echo "$label: PASS ($url)"
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
      echo "$label: PASS ($url)"
      return 0
    fi

    if (( "$(date +%s)" - start >= TIMEOUT )); then
      return 1
    fi

    sleep 2
  done
}

record_summary() {
  local key="$1"
  local status="$2"
  local detail="${3:-}"
  SUMMARY_ROWS+=("$key|$status|$detail")
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

run_check() {
  local key="$1"
  local label="$2"
  local url="$3"
  local expected="${4:-}"

  if check_url "$label" "$url" "$expected"; then
    set_named_status "$key" "PASS"
    record_summary "$key" "PASS" "$url"
    return 0
  fi

  set_named_status "$key" "FAIL"
  record_summary "$key" "FAIL" "$url"
  return 1
}

run_route_checks() {
  local failed=0
  local item
  local key
  local label
  local url
  local expected

  step "Checking local routes"
  for item in "${LOCAL_CHECKS[@]}"; do
    IFS='|' read -r key label url expected <<< "$item"
    run_check "$key" "$label" "$url" "$expected" || failed=1
  done

  step "Checking public routes"
  for item in "${PUBLIC_CHECKS[@]}"; do
    IFS='|' read -r key label url expected <<< "$item"
    run_check "$key" "$label" "$url" "$expected" || failed=1
  done

  return "$failed"
}

install_dependencies_if_needed() {
  local dir="$1"
  local label="$2"

  if [[ "$INSTALL_DEPS" == "never" ]]; then
    echo "$label dependencies: skipped by --install-deps never"
    return 0
  fi

  if [[ "$INSTALL_DEPS" == "always" || ! -d "$dir/node_modules" ]]; then
    step "Installing $label dependencies"
    (
      cd "$dir"
      npm ci
    ) || return 1
  else
    echo "$label dependencies: node_modules already present"
  fi
}

preflight() {
  step "Preflight"

  require_command bash
  require_command node
  require_command npm
  require_command curl
  require_command ss
  require_command fuser

  [[ -d "$SERVER_DIR" ]] || { echo "Missing server directory: $SERVER_DIR" >&2; exit 1; }
  [[ -d "$WEB_DIR" ]] || { echo "Missing web directory: $WEB_DIR" >&2; exit 1; }
  [[ -f "$SERVER_DIR/package.json" ]] || { echo "Missing server/package.json" >&2; exit 1; }
  [[ -f "$WEB_DIR/package.json" ]] || { echo "Missing web/package.json" >&2; exit 1; }
  [[ -f "$SERVER_DIR/.env" || -f "$SERVER_DIR/.env.example" ]] || { echo "Missing server runtime config or example env" >&2; exit 1; }
  [[ -f "$WEB_DIR/.env.production" || -f "$WEB_DIR/.env.example" ]] || { echo "Missing web runtime config or example env" >&2; exit 1; }

  echo "Project root: $PROJECT_ROOT"
  echo "Backend port: $BACKEND_PORT"
  echo "Frontend port: $FRONTEND_PORT"
  echo "Origin router port: $ROUTER_PORT"
  echo "Log: $TRANSCRIPT"
}

build_current_code() {
  step "Building from current local code"

  install_dependencies_if_needed "$SERVER_DIR" "backend" || return 1
  install_dependencies_if_needed "$WEB_DIR" "frontend" || return 1

  if package_has_script "$SERVER_DIR/package.json" build; then
    (
      cd "$SERVER_DIR"
      npm run build
    ) || return 1
  else
    echo "Backend build: no build script; checking server entrypoint syntax"
    node --check "$SERVER_DIR/src/index.js" || return 1
  fi

  (
    cd "$WEB_DIR"
    npm run build
  ) || return 1

  if [[ -f "$PROJECT_ROOT/installer/SetuLinkSetup/build.ps1" ]]; then
    AGENT_BUILD_STATUS="SKIP"
    AGENT_BUILD_NOTE="Detected installer/SetuLinkSetup/build.ps1, but this Linux deploy does not build Windows installer artifacts. Build those on a Windows host with PowerShell, Go, and Inno Setup."
    echo "Agent/installer build: SKIP"
    echo "$AGENT_BUILD_NOTE"
  else
    AGENT_BUILD_STATUS="SKIP"
    AGENT_BUILD_NOTE="No agent installer package step detected for this deploy path."
    echo "Agent/installer build: SKIP"
    echo "$AGENT_BUILD_NOTE"
  fi

  BUILD_STATUS="PASS"
  record_summary "BUILD" "PASS" "current local code"
  record_summary "AGENT_PACKAGE" "$AGENT_BUILD_STATUS" "$AGENT_BUILD_NOTE"
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

restart_services() {
  stop_pidfile_process backend "$RUN_DIR/backend.pid" || return 1
  stop_pidfile_process frontend "$RUN_DIR/frontend.pid" || return 1
  stop_pidfile_process router "$RUN_DIR/router.pid" || return 1
  stop_port_processes "$BACKEND_PORT" backend || return 1
  stop_port_processes "$FRONTEND_PORT" frontend || return 1
  stop_port_processes "$ROUTER_PORT" origin-router || return 1

  start_backend || return 1
  start_frontend || return 1
  start_router || return 1

  RESTART_STATUS="PASS"
  record_summary "RESTART" "PASS" "backend:${BACKEND_PORT} frontend:${FRONTEND_PORT} router:${ROUTER_PORT}"
}

wait_for_local_services() {
  local failed=0

  step "Waiting for local backend"
  wait_for_url "Backend local readiness" "$BACKEND_LOCAL_HEALTH" '"ok":true' || failed=1

  step "Waiting for local frontend"
  wait_for_url "Frontend local readiness" "$FRONTEND_LOCAL_ORIGIN" "<html" || failed=1

  step "Waiting for local origin router"
  wait_for_url "Origin router local readiness" "$ROUTER_LOCAL_ORIGIN" "<html" || failed=1

  return "$failed"
}

configure_checks() {
  local docs_expected=0

  LOCAL_CHECKS=(
    "BACKEND_LOCAL|Backend local|${BACKEND_LOCAL_HEALTH}|\"ok\":true"
    "FRONTEND_LOCAL|Frontend local|${FRONTEND_LOCAL_ORIGIN}|<html"
    "ROUTER_LOCAL|Origin router local|${ROUTER_LOCAL_ORIGIN}|<html"
    "ADMIN_LOCAL|Admin login local|${FRONTEND_LOCAL_ORIGIN}/admin|Admin Login"
    "REMOTEACCESS_LOCAL|RemoteAccess local|${FRONTEND_LOCAL_ORIGIN}/remoteaccess|NetraLink Remote Access"
  )

  PUBLIC_CHECKS=(
    "BACKEND_PUBLIC|Backend public|${BACKEND_PUBLIC_HEALTH}|\"ok\":true"
    "FRONTEND_PUBLIC|Frontend public|${PUBLIC_FRONTEND_ORIGIN}|SetuLink"
    "ADMIN_PUBLIC|Admin login public|${PUBLIC_FRONTEND_ORIGIN}/admin|Admin Login"
    "REMOTEACCESS_PUBLIC|RemoteAccess public|${PUBLIC_FRONTEND_ORIGIN}/remoteaccess|NetraLink Remote Access"
  )

  if [[ -f "$WEB_DIR/app/docs/runbook/[slug]/route.ts" ]]; then
    docs_expected=1
  fi
  if [[ -f "$PROJECT_ROOT/docs/runbook/install.md" || -f "$PROJECT_ROOT/docs/runbook/troubleshooting.md" ]]; then
    docs_expected=1
  fi

  if [[ "$docs_expected" -eq 1 ]]; then
    LOCAL_CHECKS+=(
      "DOCS_INSTALL_LOCAL|Docs install local|${FRONTEND_LOCAL_ORIGIN}/docs/runbook/install|<html"
      "DOCS_TROUBLESHOOTING_LOCAL|Docs troubleshooting local|${FRONTEND_LOCAL_ORIGIN}/docs/runbook/troubleshooting|<html"
    )
    PUBLIC_CHECKS+=(
      "DOCS_INSTALL_PUBLIC|Docs install public|${PUBLIC_FRONTEND_ORIGIN}/docs/runbook/install|<html"
      "DOCS_TROUBLESHOOTING_PUBLIC|Docs troubleshooting public|${PUBLIC_FRONTEND_ORIGIN}/docs/runbook/troubleshooting|<html"
    )
  else
    echo "Docs routes not detected on disk; skipping docs route checks"
  fi
}

route_alignment_checks() {
  step "Route alignment notes"
  echo "Public frontend: ${PUBLIC_FRONTEND_ORIGIN}"
  echo "Public API: ${PUBLIC_API_ORIGIN}"
  echo "LAN/local frontend: ${FRONTEND_LOCAL_ORIGIN}"
  echo "LAN/local origin router: ${ROUTER_LOCAL_ORIGIN}"
  echo "LAN/local backend: http://localhost:${BACKEND_PORT}"
  echo "Expected remoteaccess mapping:"
  echo "  LAN frontend -> local backend port ${BACKEND_PORT}"
  echo "  public frontend -> ${PUBLIC_API_ORIGIN}"
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
  step "Remote-desktop relay environment"
  echo "Remote desktop now uses the authenticated WebSocket relay path; TURN/STUN settings are legacy and not required for screen relay."

  STUN_STATUS="$(config_presence_status WEBRTC_STUN_URLS)"
  TURN_URLS_STATUS="$(config_presence_status WEBRTC_TURN_URLS)"
  TURN_USERNAME_STATUS="$(config_presence_status WEBRTC_TURN_USERNAME)"
  TURN_CREDENTIAL_STATUS="$(config_presence_status WEBRTC_TURN_CREDENTIAL)"

  if [[ "$TURN_URLS_STATUS" == "CONFIGURED" && "$TURN_USERNAME_STATUS" == "CONFIGURED" && "$TURN_CREDENTIAL_STATUS" == "CONFIGURED" ]]; then
    TURN_STATUS="CONFIGURED"
  else
    TURN_STATUS="MISSING"
  fi

  echo "WEBSOCKET_RELAY: ENABLED"
  echo "WEBRTC_STUN_URLS: $STUN_STATUS (legacy)"
  echo "WEBRTC_TURN_URLS: $TURN_URLS_STATUS (legacy)"
  echo "WEBRTC_TURN_USERNAME: $TURN_USERNAME_STATUS (legacy)"
  echo "WEBRTC_TURN_CREDENTIAL: $TURN_CREDENTIAL_STATUS (legacy)"

  record_summary "WEBRTC_STUN_URLS" "$STUN_STATUS" "presence only"
  record_summary "WEBRTC_TURN_URLS" "$TURN_URLS_STATUS" "presence only"
  record_summary "WEBRTC_TURN_USERNAME" "$TURN_USERNAME_STATUS" "presence only"
  record_summary "WEBRTC_TURN_CREDENTIAL" "$TURN_CREDENTIAL_STATUS" "presence only"
}

print_remote_desktop_notes() {
  step "Remote-desktop readiness notes"
  echo "Remote desktop relay is deployed when backend/web checks pass."
  echo "Real live desktop on Windows agents still depends on:"
  echo "  - updated agent binary with helper mode installed"
  echo "  - helper launch into the active Windows user session"
  echo "  - interactive desktop/session capture being available"
  echo "TURN/STUN and ffmpeg are legacy WebRTC capture checks and are not required for the WebSocket JPEG relay."
  echo "This deploy verifies server/web routes only; it does not prove unattended live Windows desktop capture is fully ready."
}

print_summary() {
  local deploy_failed=0
  local local_failed=0
  local public_failed=0
  local row
  local key
  local status
  local detail

  [[ "$BUILD_STATUS" == "PASS" ]] || deploy_failed=1
  [[ "$RESTART_STATUS" == "PASS" ]] || deploy_failed=1
  [[ "$BACKEND_LOCAL_STATUS" == "PASS" ]] || local_failed=1
  [[ "$FRONTEND_LOCAL_STATUS" == "PASS" ]] || local_failed=1
  [[ "$ROUTER_LOCAL_STATUS" == "PASS" ]] || local_failed=1
  [[ "$ADMIN_LOCAL_STATUS" == "PASS" ]] || local_failed=1
  [[ "$REMOTEACCESS_LOCAL_STATUS" == "PASS" ]] || local_failed=1
  [[ "$DOCS_INSTALL_LOCAL_STATUS" != "FAIL" ]] || local_failed=1
  [[ "$DOCS_TROUBLESHOOTING_LOCAL_STATUS" != "FAIL" ]] || local_failed=1

  [[ "$BACKEND_PUBLIC_STATUS" == "PASS" ]] || public_failed=1
  [[ "$FRONTEND_PUBLIC_STATUS" == "PASS" ]] || public_failed=1
  [[ "$ADMIN_PUBLIC_STATUS" == "PASS" ]] || public_failed=1
  [[ "$REMOTEACCESS_PUBLIC_STATUS" == "PASS" ]] || public_failed=1
  [[ "$DOCS_INSTALL_PUBLIC_STATUS" != "FAIL" ]] || public_failed=1
  [[ "$DOCS_TROUBLESHOOTING_PUBLIC_STATUS" != "FAIL" ]] || public_failed=1

  if [[ "$local_failed" -eq 0 ]]; then
    LOCAL_HEALTH_STATUS="PASS"
  else
    LOCAL_HEALTH_STATUS="FAIL"
  fi

  if [[ "$public_failed" -eq 0 ]]; then
    PUBLIC_REACHABILITY_STATUS="PASS"
  else
    PUBLIC_REACHABILITY_STATUS="FAIL"
  fi

  if [[ "$TURN_STATUS" == "CONFIGURED" ]]; then
    REMOTE_DESKTOP_READINESS_STATUS="PASS"
  else
    REMOTE_DESKTOP_READINESS_STATUS="WARN"
  fi

  if [[ "$deploy_failed" -eq 0 && "$local_failed" -eq 0 && "$public_failed" -eq 0 ]]; then
    OVERALL_DEPLOY_STATUS="PASS"
  else
    OVERALL_DEPLOY_STATUS="FAIL"
  fi

  printf "\n=== DEPLOY SUMMARY ===\n"
  printf "OVERALL DEPLOY: %s\n" "$OVERALL_DEPLOY_STATUS"
  printf "LOCAL HEALTH: %s\n" "$LOCAL_HEALTH_STATUS"
  printf "PUBLIC REACHABILITY: %s\n" "$PUBLIC_REACHABILITY_STATUS"
  printf "REMOTE DESKTOP READINESS: %s\n" "$REMOTE_DESKTOP_READINESS_STATUS"
  printf "\n--- Deploy ---\n"
  printf "BUILD: %s\n" "$BUILD_STATUS"
  printf "RESTART: %s\n" "$RESTART_STATUS"
  printf "AGENT PACKAGE: %s\n" "$AGENT_BUILD_STATUS"
  printf "\n--- Local Health ---\n"
  printf "BACKEND LOCAL: %s\n" "$BACKEND_LOCAL_STATUS"
  printf "FRONTEND LOCAL: %s\n" "$FRONTEND_LOCAL_STATUS"
  printf "ROUTER LOCAL: %s\n" "$ROUTER_LOCAL_STATUS"
  printf "ADMIN LOCAL: %s\n" "$ADMIN_LOCAL_STATUS"
  printf "REMOTEACCESS LOCAL: %s\n" "$REMOTEACCESS_LOCAL_STATUS"
  printf "DOCS INSTALL LOCAL: %s\n" "$DOCS_INSTALL_LOCAL_STATUS"
  printf "DOCS TROUBLESHOOTING LOCAL: %s\n" "$DOCS_TROUBLESHOOTING_LOCAL_STATUS"
  printf "\n--- Public Reachability ---\n"
  printf "BACKEND PUBLIC: %s\n" "$BACKEND_PUBLIC_STATUS"
  printf "FRONTEND PUBLIC: %s\n" "$FRONTEND_PUBLIC_STATUS"
  printf "ADMIN PUBLIC: %s\n" "$ADMIN_PUBLIC_STATUS"
  printf "REMOTEACCESS PUBLIC: %s\n" "$REMOTEACCESS_PUBLIC_STATUS"
  printf "DOCS INSTALL PUBLIC: %s\n" "$DOCS_INSTALL_PUBLIC_STATUS"
  printf "DOCS TROUBLESHOOTING PUBLIC: %s\n" "$DOCS_TROUBLESHOOTING_PUBLIC_STATUS"
  printf "\n--- Remote Desktop Readiness ---\n"
  printf "STUN: %s\n" "$STUN_STATUS"
  printf "TURN: %s\n" "$TURN_STATUS"
  printf "REMOTE DESKTOP: WebSocket JPEG relay deployed; Windows live desktop runtime readiness depends on the updated agent helper running in the active user session.\n"

  if [[ "$local_failed" -eq 0 && "$public_failed" -ne 0 ]]; then
    printf "\nLocal deployment succeeded, but public/Cloudflare reachability failed.\n"
  fi


  printf "\n--- Details ---\n"
  for row in "${SUMMARY_ROWS[@]}"; do
    IFS='|' read -r key status detail <<< "$row"
    printf "%-24s %-5s %s\n" "$key" "$status" "$detail"
  done

  printf "\nBackend local URL: %s\n" "$BACKEND_LOCAL_HEALTH"
  printf "Frontend local URL: %s\n" "$FRONTEND_LOCAL_ORIGIN"
  printf "Origin router local URL: %s\n" "$ROUTER_LOCAL_ORIGIN"
  printf "Backend public URL: %s\n" "$BACKEND_PUBLIC_HEALTH"
  printf "Frontend public URL: %s\n" "$PUBLIC_FRONTEND_ORIGIN"
  printf "Log: %s\n" "$TRANSCRIPT"
}

main() {
  local failed=0

  preflight
  if ! build_current_code; then
    failed=1
    BUILD_STATUS="FAIL"
    record_summary "BUILD" "FAIL" "current local code"
  fi

  if [[ "$BUILD_STATUS" == "PASS" ]]; then
    if ! restart_services; then
      failed=1
      RESTART_STATUS="FAIL"
      record_summary "RESTART" "FAIL" "backend:${BACKEND_PORT} frontend:${FRONTEND_PORT} router:${ROUTER_PORT}"
    fi

    if [[ "$RESTART_STATUS" == "PASS" ]]; then
      wait_for_local_services || failed=1
      configure_checks
      route_alignment_checks
      run_route_checks || failed=1
    fi
  fi

  detect_webrtc_env
  print_remote_desktop_notes
  print_summary

  if [[ "$OVERALL_DEPLOY_STATUS" != "PASS" || "$failed" -ne 0 ]]; then
    exit 1
  fi
}

main "$@"
