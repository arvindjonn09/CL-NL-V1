#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/setulink}"
STATE_DIR="${STATE_DIR:-/var/lib/setulink}"
RUNTIME_DIR="${STATE_DIR}/setulink"
CONFIG_DIR="${RUNTIME_DIR}/config"
CONFIG_PATH="${CONFIG_DIR}/agent.json"
LOG_DIR="${RUNTIME_DIR}/logs"
DATA_DIR="${RUNTIME_DIR}/data"
TEMP_DIR="${RUNTIME_DIR}/temp"
SERVICE_NAME="${SERVICE_NAME:-setulink-agent}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
BUNDLED_FFMPEG_SOURCE="${BUNDLED_FFMPEG_SOURCE:-./assets/ffmpeg/ffmpeg}"
BUNDLED_FFMPEG_DEST="${INSTALL_DIR}/ffmpeg/ffmpeg"
SERVICE_EXEC_START="${INSTALL_DIR}/setulink-agent -config ${CONFIG_PATH}"
BACKEND_URL="${BACKEND_URL:-https://netraapi.shivomsangha.com}"
AGENT_TOKEN="${AGENT_TOKEN:-setulink-dev-agent-secret}"
ENVIRONMENT_LABEL="${ENVIRONMENT_LABEL:-unknown}"
VERSION="${VERSION:-0.1.0}"
FFMPEG_MODE="${FFMPEG_MODE:-auto}"

log() {
  printf '[setulink-install] %s\n' "$*"
}

fail() {
  printf '[setulink-install] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "run as root, for example: sudo $0"
  fi
}

resolve_agent_binary() {
  local explicit="${1:-}"
  local candidates=()
  local candidate=""

  if [[ -n "$explicit" ]]; then
    candidates+=("$explicit")
  fi
  candidates+=(
    "${SCRIPT_DIR}/setulink-agent"
    "${SCRIPT_DIR}/../setulink-agent"
    "${SCRIPT_DIR}/../agent/setulink-agent"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      AGENT_SOURCE="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
      log "using agent binary: $AGENT_SOURCE"
      return
    fi
  done

  printf '[setulink-install] ERROR: agent binary not found. Tried:\n' >&2
  for candidate in "${candidates[@]}"; do
    printf '[setulink-install]   %s\n' "$candidate" >&2
  done
  exit 1
}

install_agent_binary() {
  install -d -m 0755 "$INSTALL_DIR"
  install -m 0755 "$AGENT_SOURCE" "${INSTALL_DIR}/setulink-agent"
  log "installed agent binary: ${INSTALL_DIR}/setulink-agent"
}

install_bundled_ffmpeg() {
  [[ -f "$BUNDLED_FFMPEG_SOURCE" ]] || fail "bundled ffmpeg not found: $BUNDLED_FFMPEG_SOURCE"

  install -d -m 0755 "${INSTALL_DIR}/ffmpeg"
  install -m 0755 "$BUNDLED_FFMPEG_SOURCE" "$BUNDLED_FFMPEG_DEST"
  chmod +x "$BUNDLED_FFMPEG_DEST"
  log "installed bundled ffmpeg: $BUNDLED_FFMPEG_DEST"
}

install_system_ffmpeg() {
  command -v apt-get >/dev/null 2>&1 || return 1

  log "installing ffmpeg with apt-get"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg
}

ensure_ffmpeg() {
  case "$FFMPEG_MODE" in
    bundled)
      install_bundled_ffmpeg
      return
      ;;
    apt|system)
      if ! command -v ffmpeg >/dev/null 2>&1; then
        install_system_ffmpeg || fail "apt-get ffmpeg install failed"
      fi
      log "system ffmpeg available: $(command -v ffmpeg)"
      return
      ;;
    auto)
      ;;
    *)
      fail "FFMPEG_MODE must be auto, apt, system, or bundled"
      ;;
  esac

  if command -v ffmpeg >/dev/null 2>&1; then
    log "ffmpeg already available: $(command -v ffmpeg)"
    return
  fi

  if install_system_ffmpeg; then
    log "system ffmpeg available: $(command -v ffmpeg)"
    return
  fi

  if [[ -f "$BUNDLED_FFMPEG_SOURCE" ]]; then
    install_bundled_ffmpeg
    return
  fi

  fail "ffmpeg is not available; install apt package ffmpeg or provide bundled binary at $BUNDLED_FFMPEG_SOURCE"
}

write_config() {
  install -d -m 0755 "$STATE_DIR" "$RUNTIME_DIR" "$CONFIG_DIR" "$LOG_DIR" "$DATA_DIR" "$TEMP_DIR"

  cat >"${CONFIG_PATH}" <<EOF_CONFIG
{
  "backendUrl": "${BACKEND_URL}",
  "serverUrl": "${BACKEND_URL}",
  "agentToken": "${AGENT_TOKEN}",
  "environmentLabel": "${ENVIRONMENT_LABEL}",
  "logPath": "${LOG_DIR}/agent.log",
  "dataPath": "${DATA_DIR}",
  "tempPath": "${TEMP_DIR}",
  "version": "${VERSION}",
  "os": "linux"
}
EOF_CONFIG

  log "chosen config path: ${CONFIG_PATH}"
  log "wrote config: ${CONFIG_PATH}"
  if [[ -f /etc/setulink/agent.json ]]; then
    log "legacy config present but not used by this service: /etc/setulink/agent.json"
  fi
}

write_systemd_service() {
  cat >"${SERVICE_FILE}" <<EOF_SERVICE
[Unit]
Description=SetuLink Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HOME=${STATE_DIR}
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${INSTALL_DIR}/ffmpeg
ExecStart=${SERVICE_EXEC_START}
WorkingDirectory=${INSTALL_DIR}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF_SERVICE

  log "service file path: ${SERVICE_FILE}"
  log "service HOME: ${STATE_DIR}"
  log "service ExecStart: ${SERVICE_EXEC_START}"
  log "config exists before service start: $(test -f "$CONFIG_PATH" && printf true || printf false)"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
}

start_service_or_fail() {
  log "service start requested: ${SERVICE_NAME}"
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    systemctl stop "$SERVICE_NAME" || true
  fi
  if ! systemctl start "$SERVICE_NAME"; then
    printf '[setulink-install] ERROR: service start failed: %s\n' "$SERVICE_NAME" >&2
    systemctl --no-pager --full status "$SERVICE_NAME" >&2 || true
    journalctl -u "$SERVICE_NAME" -n 80 --no-pager >&2 || true
    exit 1
  fi

  sleep 2
  if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    printf '[setulink-install] ERROR: service did not reach active (running): %s\n' "$SERVICE_NAME" >&2
    systemctl --no-pager --full status "$SERVICE_NAME" >&2 || true
    journalctl -u "$SERVICE_NAME" -n 80 --no-pager >&2 || true
    exit 1
  fi

  log "service start result: active (running)"
}

validate_install() {
  [[ -f "$CONFIG_PATH" ]] || fail "config file missing: $CONFIG_PATH"
  grep -Fq "Environment=HOME=${STATE_DIR}" "$SERVICE_FILE" || fail "service file missing expected HOME: $SERVICE_FILE"
  grep -Fq "ExecStart=${SERVICE_EXEC_START}" "$SERVICE_FILE" || fail "service file missing expected ExecStart: $SERVICE_FILE"

  log "validation: config file exists => ${CONFIG_PATH}"
  log "validation: service HOME configured => ${STATE_DIR}"
  log "validation: service ExecStart configured => ${SERVICE_EXEC_START}"
  log "validation: which ffmpeg => $(which ffmpeg || true)"
  if [[ -x "$BUNDLED_FFMPEG_DEST" ]]; then
    log "validation: bundled ffmpeg exists => $BUNDLED_FFMPEG_DEST"
  else
    log "validation: bundled ffmpeg not installed at $BUNDLED_FFMPEG_DEST"
  fi

  systemctl --no-pager --full status "$SERVICE_NAME" || true
  sleep 2
  if [[ -f "${LOG_DIR}/agent.log" ]]; then
    grep -Ei 'ffmpeg|remote-desktop|capability|desktop' "${LOG_DIR}/agent.log" | tail -n 20 || true
  else
    log "agent log not found yet: ${LOG_DIR}/agent.log"
  fi
}

main() {
  require_root
  resolve_agent_binary "${1:-}"
  install_agent_binary
  ensure_ffmpeg
  write_config
  write_systemd_service
  start_service_or_fail
  validate_install
}

main "$@"
