#!/usr/bin/env bash
# Accord Remote Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install-remote.sh | bash
#
# That's it. No flags needed.
#
# What it does:
#   1. Downloads Accord to ~/.accord/ (shallow clone)
#   2. Tells you how to initialize your project
#
# After install, run in your project directory:
#   ~/.accord/init.sh

set -euo pipefail

ACCORD_REPO="${ACCORD_REPO:-https://github.com/aiwatching/accord.git}"
ACCORD_HOME="${ACCORD_HOME:-$HOME/.accord}"
ACCORD_BRANCH="${ACCORD_BRANCH:-main}"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

log() { echo -e "${CYAN}[accord]${NC} $*"; }
err() { echo -e "${RED}[accord] ERROR:${NC} $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || err "git is required but not installed"

# ── Download / Update ─────────────────────────────────────────────────────────
if [[ -d "$ACCORD_HOME/.git" ]]; then
    log "Updating Accord at $ACCORD_HOME ..."
    (cd "$ACCORD_HOME" && git pull --quiet origin "$ACCORD_BRANCH" 2>/dev/null) || \
        log "Update failed (offline?), using cached version"
    log "Updated successfully"
else
    if [[ -d "$ACCORD_HOME" ]]; then
        rm -rf "$ACCORD_HOME"
    fi
    log "Downloading Accord to $ACCORD_HOME ..."
    git clone --depth 1 --branch "$ACCORD_BRANCH" --quiet "$ACCORD_REPO" "$ACCORD_HOME" || \
        err "Failed to clone. Check your network and that $ACCORD_REPO is accessible."
    log "Downloaded successfully"
fi

chmod +x "$ACCORD_HOME/init.sh"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Accord installed at ~/.accord/${NC}"
echo ""
echo "Next: cd into your project and run:"
echo ""
echo -e "  ${BOLD}~/.accord/init.sh${NC}                          # interactive"
echo -e "  ${BOLD}~/.accord/init.sh --adapter claude-code${NC}    # with Claude Code adapter"
echo ""
echo "Run ~/.accord/init.sh --help for all options."
