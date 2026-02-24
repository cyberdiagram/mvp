#!/usr/bin/env bash
# =============================================================================
# retarget-cassette.sh — Replace target IP in cassette JSONL files.
#
# HTB/lab machines get a new IP on each restart. This script find-and-replaces
# the old target IP with the new one so recorded cassettes can be replayed
# against a fresh instance.
#
# Uses word-boundary-aware replacement ([^0-9] anchors) to prevent substring
# matches (e.g. 10.129.2.19 won't match inside 10.129.2.199). Creates a .bak
# backup before modifying each file.
#
# Usage:
#   ./scripts/retarget-cassette.sh --old-ip <OLD> --new-ip <NEW> <path>
#   ./scripts/retarget-cassette.sh --old-ip <OLD> --new-ip <NEW> --dry-run <path>
#
# Examples:
#   # Single file
#   ./scripts/retarget-cassette.sh \
#     --old-ip 10.129.2.199 --new-ip 10.129.5.42 \
#     logs/cassettes/recon-abc123.jsonl
#
#   # All cassettes in a directory
#   ./scripts/retarget-cassette.sh \
#     --old-ip 10.129.2.199 --new-ip 10.129.5.42 \
#     logs/cassettes/
#
#   # Preview changes without modifying
#   ./scripts/retarget-cassette.sh \
#     --old-ip 10.129.2.199 --new-ip 10.129.5.42 --dry-run \
#     logs/cassettes/
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
fail()   { echo -e "  ${RED}✗${NC}  $*"; }
info()   { echo -e "  ${CYAN}→${NC}  $*"; }
warn()   { echo -e "  ${YELLOW}!${NC}  $*"; }
header() { echo -e "\n${BOLD}${CYAN}── $* ──${NC}"; }

# ── Parse flags ───────────────────────────────────────────────────────────────

OLD_IP=""
NEW_IP=""
DRY_RUN=false
TARGET_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --old-ip)   OLD_IP="$2";   shift 2 ;;
    --new-ip)   NEW_IP="$2";   shift 2 ;;
    --dry-run)  DRY_RUN=true;  shift   ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \?//' | head -30
      exit 0
      ;;
    -*)
      echo "Unknown flag: $1  (try --help)" >&2
      exit 1
      ;;
    *)
      TARGET_PATH="$1"; shift ;;
  esac
done

# ── Validate inputs ──────────────────────────────────────────────────────────

if [[ -z "$OLD_IP" || -z "$NEW_IP" || -z "$TARGET_PATH" ]]; then
  echo -e "${RED}Error: --old-ip, --new-ip, and <path> are all required.${NC}" >&2
  echo "Usage: $0 --old-ip <OLD> --new-ip <NEW> [--dry-run] <path>" >&2
  exit 1
fi

# Simple IPv4 format check
ip_regex='^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
if [[ ! "$OLD_IP" =~ $ip_regex ]]; then
  echo -e "${RED}Error: --old-ip '${OLD_IP}' does not look like an IPv4 address.${NC}" >&2
  exit 1
fi
if [[ ! "$NEW_IP" =~ $ip_regex ]]; then
  echo -e "${RED}Error: --new-ip '${NEW_IP}' does not look like an IPv4 address.${NC}" >&2
  exit 1
fi

if [[ ! -e "$TARGET_PATH" ]]; then
  echo -e "${RED}Error: path '${TARGET_PATH}' does not exist.${NC}" >&2
  exit 1
fi

# ── Build file list ──────────────────────────────────────────────────────────

FILES=()
if [[ -d "$TARGET_PATH" ]]; then
  while IFS= read -r -d '' f; do
    FILES+=("$f")
  done < <(find "$TARGET_PATH" -maxdepth 1 -name '*.jsonl' -type f -print0 | sort -z)
  if [[ ${#FILES[@]} -eq 0 ]]; then
    echo -e "${RED}Error: no .jsonl files found in '${TARGET_PATH}'.${NC}" >&2
    exit 1
  fi
elif [[ -f "$TARGET_PATH" ]]; then
  FILES=("$TARGET_PATH")
else
  echo -e "${RED}Error: '${TARGET_PATH}' is not a file or directory.${NC}" >&2
  exit 1
fi

# ── Escape dots in IP for sed regex ──────────────────────────────────────────

escape_ip() { echo "$1" | sed 's/\./\\./g'; }
OLD_IP_RE=$(escape_ip "$OLD_IP")
NEW_IP_ESC="$NEW_IP"  # replacement side doesn't need escaping for dots

# ── Banner ───────────────────────────────────────────────────────────────────

echo -e "\n${BOLD}══════════════════════════════════════════${NC}"
echo -e "${BOLD}  Retarget Cassette${NC}"
echo -e "${BOLD}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BOLD}══════════════════════════════════════════${NC}"

info "Old IP:  ${OLD_IP}"
info "New IP:  ${NEW_IP}"
info "Path:    ${TARGET_PATH}"
info "Files:   ${#FILES[@]}"
$DRY_RUN && warn "DRY RUN — no files will be modified"

# ── Process files ────────────────────────────────────────────────────────────

header "Replacing IPs"

TOTAL_REPLACEMENTS=0
FILES_MODIFIED=0
FILES_SKIPPED=0

for file in "${FILES[@]}"; do
  basename=$(basename "$file")

  # Count occurrences (word-boundary-aware via grep -oP)
  count=$(grep -oP '(?<![0-9])'"${OLD_IP_RE}"'(?![0-9])' "$file" | wc -l || true)

  if [[ "$count" -eq 0 ]]; then
    warn "${basename}  — 0 matches (skipped)"
    FILES_SKIPPED=$((FILES_SKIPPED + 1))
    continue
  fi

  if $DRY_RUN; then
    ok "${basename}  — ${count} match(es) would be replaced"
  else
    # Create backup
    cp "$file" "${file}.bak"

    # Double-pass sed for word-boundary-aware replacement.
    # Pass 1: replace occurrences preceded by a non-digit (or start of line).
    # Pass 2: catch any remaining occurrences at start-of-line boundaries.
    sed -i \
      -e "s/\([^0-9]\)${OLD_IP_RE}\([^0-9]\)/\1${NEW_IP_ESC}\2/g" \
      -e "s/\([^0-9]\)${OLD_IP_RE}\([^0-9]\)/\1${NEW_IP_ESC}\2/g" \
      -e "s/^${OLD_IP_RE}\([^0-9]\)/${NEW_IP_ESC}\1/g" \
      -e "s/\([^0-9]\)${OLD_IP_RE}$/\1${NEW_IP_ESC}/g" \
      -e "s/^${OLD_IP_RE}$/${NEW_IP_ESC}/g" \
      "$file"

    # Verify replacement count
    remaining=$(grep -oP '(?<![0-9])'"${OLD_IP_RE}"'(?![0-9])' "$file" | wc -l || true)
    actual=$((count - remaining))

    if [[ "$remaining" -gt 0 ]]; then
      warn "${basename}  — ${actual}/${count} replaced, ${remaining} remaining"
    else
      ok "${basename}  — ${count} replacement(s), backup → ${basename}.bak"
    fi

    FILES_MODIFIED=$((FILES_MODIFIED + 1))
  fi

  TOTAL_REPLACEMENTS=$((TOTAL_REPLACEMENTS + count))
done

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}──────────────────────────────────────────${NC}"
if $DRY_RUN; then
  echo -e "${BOLD}${CYAN}  →  Dry run: ${TOTAL_REPLACEMENTS} replacement(s) across ${#FILES[@]} file(s)${NC}"
elif [[ $FILES_MODIFIED -gt 0 ]]; then
  echo -e "${BOLD}${GREEN}  ✓  ${TOTAL_REPLACEMENTS} replacement(s) in ${FILES_MODIFIED} file(s)${NC}"
  [[ $FILES_SKIPPED -gt 0 ]] && echo -e "${BOLD}${YELLOW}  !  ${FILES_SKIPPED} file(s) had no matches${NC}"
else
  echo -e "${BOLD}${YELLOW}  !  No replacements made — old IP not found in any file${NC}"
fi
echo -e "${BOLD}──────────────────────────────────────────${NC}\n"
