#!/usr/bin/env bash
# =============================================================================
# test-reset.sh — Clear test data and verify environment before each test run.
#
# Part 1 — Clear data:
#   • Flush Redis (FLUSHDB)
#   • Truncate Supabase tables (RESTART IDENTITY CASCADE)
#
# Part 2 — Check environment:
#   • VPN connected (tun0 up)
#   • Redis is reachable
#   • Kali container is running
#   • ChromaDB HTTP API is up
#
# Usage:
#   ./scripts/test-reset.sh                             # full reset + environment check
#   ./scripts/test-reset.sh --check-only                # skip data reset, environment check only
#   ./scripts/test-reset.sh --reset-only                # clear data only, skip environment check
#   ./scripts/test-reset.sh --connect-vpn               # auto-connect VPN if not already up
#   ./scripts/test-reset.sh --connect-vpn -t 10.129.2.25  # connect VPN + ping target host
#
# Environment variables (all have sensible defaults):
#   REDIS_HOST        Redis host             (default: localhost)
#   REDIS_PORT        Redis port             (default: 6379)
#   PGPASSWORD        Postgres password      (default: postgres)
#   PG_HOST           Postgres host          (default: 127.0.0.1)
#   PG_PORT           Postgres port          (default: 54322)
#   PG_USER           Postgres user          (default: postgres)
#   PG_DB             Postgres database      (default: postgres)
#   KALI_CONTAINER    Kali container name    (default: pentest-kali)
#   CHROMA_PORT       ChromaDB HTTP port     (default: 8000)
#   VPNS_DIR          Directory with .ovpn files  (default: /home/leo/vpns)
#   DEFAULT_OVPN      .ovpn file to use           (default: machines_sg-2.ovpn)
#   VPN_SUDO_PASS     sudo password for openvpn   (default: flash123)
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Output helpers ────────────────────────────────────────────────────────────

ok()     { echo -e "  ${GREEN}✓${NC}  $*"; }
fail()   { echo -e "  ${RED}✗${NC}  $*"; FAILURES=$((FAILURES + 1)); }
info()   { echo -e "  ${CYAN}→${NC}  $*"; }
warn()   { echo -e "  ${YELLOW}!${NC}  $*"; }
header() { echo -e "\n${BOLD}${CYAN}── $* ──${NC}"; }
hint()   { echo -e "       ${YELLOW}hint: $*${NC}"; }

# ── Config (all overridable via env) ─────────────────────────────────────────

REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-54322}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-postgres}"

KALI_CONTAINER="${KALI_CONTAINER:-pentest-kali}"
CHROMA_PORT="${CHROMA_PORT:-8000}"

VPNS_DIR="${VPNS_DIR:-/home/leo/vpns}"
DEFAULT_OVPN="${DEFAULT_OVPN:-machines_sg-2.ovpn}"
VPN_SUDO_PASS="${VPN_SUDO_PASS:-flash123}"
VPN_TUN_IFACE="tun0"
VPN_CONNECT_TIMEOUT=20   # seconds to wait for tun0 after launching openvpn

# Tables cleared on every reset. Order matters: children before parents where
# FK constraints exist, but CASCADE handles it — list alphabetically for clarity.
TRUNCATE_TABLES="assets, discovered_services, scan_sessions, tactical_plans, \
target_profiles, task_logs, tasks, vulnerabilities"

# ── Parse flags ───────────────────────────────────────────────────────────────

DO_RESET=true
DO_CHECK=true
DO_VPN=false
TARGET_HOST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)  DO_RESET=false; shift ;;
    --reset-only)  DO_CHECK=false; shift ;;
    --connect-vpn) DO_VPN=true;    shift ;;
    --target|-t)   TARGET_HOST="$2"; shift 2 ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \?//' | head -35
      exit 0
      ;;
    *)
      echo "Unknown flag: $1  (try --help)" >&2
      exit 1
      ;;
  esac
done

# ── State ─────────────────────────────────────────────────────────────────────

FAILURES=0

# ── Helper: run a single psql statement ──────────────────────────────────────

psql_exec() {
  psql \
    -h "$PG_HOST" \
    -p "$PG_PORT" \
    -U "$PG_USER" \
    -d "$PG_DB" \
    -v ON_ERROR_STOP=1 \
    --no-psqlrc \
    -q \
    -c "$1" 2>&1
}

# ═════════════════════════════════════════════════════════════════════════════
# VPN — Connect if not already up
# ═════════════════════════════════════════════════════════════════════════════

# Returns the current IP on tun0, or empty string if the interface is absent.
vpn_ip() {
  ip -4 addr show "$VPN_TUN_IFACE" 2>/dev/null \
    | grep "inet " \
    | awk '{print $2}' \
    | cut -d/ -f1
}

# Launches openvpn in daemon mode and waits up to VPN_CONNECT_TIMEOUT seconds
# for tun0 to come up.  Exits the script on failure.
connect_vpn() {
  header "VPN — Connecting"

  local ovpn_file="${VPNS_DIR}/${DEFAULT_OVPN}"

  if [[ ! -f "$ovpn_file" ]]; then
    fail "VPN config not found: ${ovpn_file}"
    exit 1
  fi

  local existing_ip
  existing_ip=$(vpn_ip)
  if [[ -n "$existing_ip" ]]; then
    ok "VPN already up  (${VPN_TUN_IFACE} → ${existing_ip})  — skipping connect"
    return
  fi

  info "Starting OpenVPN  (${DEFAULT_OVPN})"
  echo "$VPN_SUDO_PASS" | sudo -S openvpn \
    --config   "$ovpn_file" \
    --log      "/tmp/openvpn-htb.log" \
    --daemon \
    2>/dev/null

  # Poll until tun0 appears or timeout is reached
  local elapsed=0
  printf "  ${CYAN}→${NC}  Waiting for ${VPN_TUN_IFACE}"
  while [[ $elapsed -lt $VPN_CONNECT_TIMEOUT ]]; do
    if [[ -n "$(vpn_ip)" ]]; then
      echo ""   # newline after dots
      break
    fi
    printf "."
    sleep 1
    elapsed=$((elapsed + 1))
  done

  local final_ip
  final_ip=$(vpn_ip)
  if [[ -n "$final_ip" ]]; then
    ok "VPN connected  (${VPN_TUN_IFACE} → ${final_ip})"
  else
    echo ""
    fail "VPN did not come up within ${VPN_CONNECT_TIMEOUT}s"
    hint "Check logs: tail -20 /tmp/openvpn-htb.log"
    exit 1
  fi

  # Ping target host if one was provided
  ping_target
}

# Pings TARGET_HOST once VPN is confirmed up.
# Skipped silently when --target was not passed.
ping_target() {
  [[ -z "$TARGET_HOST" ]] && return

  info "Pinging target host  (${TARGET_HOST})"
  if ping -c 3 -W 2 "$TARGET_HOST" &>/dev/null; then
    ok "Host is UP  (${TARGET_HOST})"
  else
    fail "Host is UNREACHABLE  (${TARGET_HOST})"
    hint "Is the machine started on HTB? Check VPN routes: ip route | grep tun0"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# Part 1 — Clear data
# ═════════════════════════════════════════════════════════════════════════════

clear_data() {
  header "Part 1 — Clear test data"

  # ── 1a. Redis ──────────────────────────────────────────────────────────────
  info "Flushing Redis  (${REDIS_HOST}:${REDIS_PORT})"

  if ! redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" PING &>/dev/null; then
    fail "Redis is not reachable — skipping FLUSHDB"
    hint "Start Redis: docker compose -f /home/leo/cyber-bridge/docker-compose.yml up redis -d"
  else
    if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" FLUSHDB &>/dev/null; then
      ok "Redis flushed  (FLUSHDB)"
    else
      fail "Redis FLUSHDB returned an error"
    fi
  fi

  # ── 1b. Supabase / Postgres ────────────────────────────────────────────────
  info "Truncating Supabase tables  (${PG_HOST}:${PG_PORT}/${PG_DB})"

  # Verify psql is available
  if ! command -v psql &>/dev/null; then
    fail "psql not found — install postgresql-client to truncate tables"
    return
  fi

  # Verify the DB is reachable before attempting the truncate
  if ! psql_exec "SELECT 1" &>/dev/null; then
    fail "Cannot connect to Postgres at ${PG_HOST}:${PG_PORT} — skipping truncate"
    hint "Is Supabase running?  supabase start"
    return
  fi

  TRUNCATE_SQL="TRUNCATE TABLE ${TRUNCATE_TABLES} RESTART IDENTITY CASCADE;"

  if truncate_out=$(psql_exec "$TRUNCATE_SQL" 2>&1); then
    ok "Supabase tables truncated  (RESTART IDENTITY CASCADE)"
    echo "       tables: ${TRUNCATE_TABLES}"
  else
    # Distinguish «table does not exist» from a real error
    if echo "$truncate_out" | grep -qi "does not exist"; then
      warn "One or more tables are missing — schema may not be migrated yet"
      echo "       $truncate_out"
      # Not a hard failure during initial setup
    else
      fail "Supabase truncate failed"
      echo "       $truncate_out"
    fi
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# Part 2 — Check environment
# ═════════════════════════════════════════════════════════════════════════════

check_environment() {
  header "Part 2 — Check test environment"

  # ── 2a. VPN ────────────────────────────────────────────────────────────────
  info "VPN  (${VPN_TUN_IFACE})"

  local current_vpn_ip
  current_vpn_ip=$(vpn_ip)
  if [[ -n "$current_vpn_ip" ]]; then
    ok "VPN is connected  (${VPN_TUN_IFACE} → ${current_vpn_ip})"
    ping_target
  else
    fail "VPN is NOT connected  (no ${VPN_TUN_IFACE} interface)"
    hint "bash ${VPNS_DIR}/${DEFAULT_OVPN}  or run with --connect-vpn"
  fi

  # ── 2b. Redis ──────────────────────────────────────────────────────────────
  info "Redis  (${REDIS_HOST}:${REDIS_PORT})"

  if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" PING 2>/dev/null | grep -q "PONG"; then
    ok "Redis is running"
  else
    fail "Redis is NOT running"
    hint "docker compose -f /home/leo/cyber-bridge/docker-compose.yml up redis -d"
  fi

  # ── 2c. Kali container ─────────────────────────────────────────────────────
  info "Kali container  (${KALI_CONTAINER})"

  kali_status=$(docker ps \
    --filter "name=^/${KALI_CONTAINER}$" \
    --format "{{.Status}}" 2>/dev/null || true)

  if [[ -n "$kali_status" && "$kali_status" == Up* ]]; then
    ok "Kali container is running  (${kali_status})"
  else
    fail "Kali container '${KALI_CONTAINER}' is NOT running"
    hint "docker compose -f /home/leo/mvp/docker/docker-compose.yml up kali -d"
  fi

  # ── 2d. ChromaDB ───────────────────────────────────────────────────────────
  # ChromaDB runs as a native Python process started by start-chromadb.sh
  # (not Docker). Check: PID file liveness + HTTP heartbeat.
  info "ChromaDB  (port ${CHROMA_PORT})"

  CHROMA_DIR="/home/leo/pentest-rag-memory"
  CHROMA_PID_FILE="${CHROMA_DIR}/chromadb.pid"
  CHROMA_START_SCRIPT="${CHROMA_DIR}/start-chromadb.sh"

  chroma_pid_up=false
  chroma_http_up=false

  # PID file check — verify the recorded PID is still a live process
  if [[ -f "$CHROMA_PID_FILE" ]]; then
    chroma_pid=$(cat "$CHROMA_PID_FILE")
    if kill -0 "$chroma_pid" 2>/dev/null; then
      chroma_pid_up=true
    fi
  fi

  # HTTP heartbeat — authoritative liveness check
  if curl -sf --max-time 3 "http://localhost:${CHROMA_PORT}/api/v2/heartbeat" &>/dev/null; then
    chroma_http_up=true
  fi

  if $chroma_pid_up && $chroma_http_up; then
    ok "ChromaDB is running  (PID $(cat "$CHROMA_PID_FILE"), HTTP heartbeat OK)"
  elif ! $chroma_pid_up && $chroma_http_up; then
    ok "ChromaDB HTTP API responding on port ${CHROMA_PORT}"
    warn "PID file missing or stale — ChromaDB may have been started manually"
  elif $chroma_pid_up && ! $chroma_http_up; then
    fail "ChromaDB process is alive (PID $(cat "$CHROMA_PID_FILE")) but HTTP API not responding"
    hint "Check logs: tail -f ${CHROMA_DIR}/chromadb.log"
  else
    fail "ChromaDB is NOT running"
    hint "bash ${CHROMA_START_SCRIPT}"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════════

echo -e "\n${BOLD}══════════════════════════════════════════${NC}"
echo -e "${BOLD}  Test Environment Reset${NC}"
echo -e "${BOLD}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BOLD}══════════════════════════════════════════${NC}"

$DO_VPN && warn "--connect-vpn: will auto-connect VPN if not up"
! $DO_RESET && warn "--check-only: skipping data reset"
! $DO_CHECK && warn "--reset-only: skipping environment check"
[[ -n "$TARGET_HOST" ]] && warn "target host: ${TARGET_HOST}"

$DO_VPN   && connect_vpn
$DO_RESET && clear_data
$DO_CHECK && check_environment

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}──────────────────────────────────────────${NC}"
if [[ $FAILURES -eq 0 ]]; then
  echo -e "${BOLD}${GREEN}  ✓  All checks passed — environment is ready.${NC}"
else
  echo -e "${BOLD}${RED}  ✗  ${FAILURES} check(s) failed — fix the issues above before testing.${NC}"
fi
echo -e "${BOLD}──────────────────────────────────────────${NC}\n"

exit $FAILURES
