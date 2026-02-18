#!/usr/bin/env bash
# Accord Lite — Remote Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
#
# Install a specific version:
#   ACCORD_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
#
# What it does:
#   1. Downloads Accord Lite to ~/.accord/ (shallow clone)
#   2. Tells you how to initialize your project

set -euo pipefail

ACCORD_REPO="${ACCORD_REPO:-https://github.com/aiwatching/accord.git}"
ACCORD_HOME="${ACCORD_HOME:-$HOME/.accord}"
ACCORD_VERSION="${ACCORD_VERSION:-latest}"
ACCORD_BRANCH="${ACCORD_BRANCH:-accord-lite}"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log() { echo -e "${CYAN}[accord]${NC} $*"; }
err() { echo -e "${RED}[accord] ERROR:${NC} $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || err "git is required but not installed"

# ── Resolve version ──────────────────────────────────────────────────────────

resolve_version() {
    if [[ "$ACCORD_VERSION" == "latest" ]]; then
        local latest_tag
        latest_tag="$(git ls-remote --tags --sort=-v:refname "$ACCORD_REPO" 'v*' 2>/dev/null \
            | head -1 | sed 's|.*refs/tags/||; s|\^{}||')"
        if [[ -n "$latest_tag" ]]; then
            ACCORD_VERSION="$latest_tag"
        else
            ACCORD_VERSION="$ACCORD_BRANCH"
            log "No release tags found, using $ACCORD_BRANCH branch"
        fi
    fi
}

# ── Download / Update ─────────────────────────────────────────────────────────

resolve_version

if [[ -d "$ACCORD_HOME/.git" ]]; then
    log "Updating Accord Lite at $ACCORD_HOME ..."
    (
        cd "$ACCORD_HOME"
        git fetch --quiet --tags origin 2>/dev/null
        if [[ "$ACCORD_VERSION" == "$ACCORD_BRANCH" ]]; then
            git checkout --quiet "$ACCORD_BRANCH" 2>/dev/null
            git pull --quiet origin "$ACCORD_BRANCH" 2>/dev/null
        else
            git checkout --quiet "$ACCORD_VERSION" 2>/dev/null
        fi
    ) || log "Update failed (offline?), using cached version"
    log "Updated to $ACCORD_VERSION"
else
    if [[ -d "$ACCORD_HOME" ]]; then
        rm -rf "$ACCORD_HOME"
    fi
    log "Downloading Accord Lite to $ACCORD_HOME ..."
    if [[ "$ACCORD_VERSION" == "$ACCORD_BRANCH" ]]; then
        git clone --depth 1 --branch "$ACCORD_BRANCH" --quiet "$ACCORD_REPO" "$ACCORD_HOME" || \
            err "Failed to clone. Check your network and that $ACCORD_REPO is accessible."
    else
        git clone --branch "$ACCORD_VERSION" --quiet "$ACCORD_REPO" "$ACCORD_HOME" || \
            err "Failed to clone version $ACCORD_VERSION. Check that the tag exists."
    fi
    log "Downloaded successfully"
fi

chmod +x "$ACCORD_HOME/init.sh"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}Accord Lite installed at ~/.accord/${NC}"
echo ""
echo "To set up your project:"
echo ""
echo -e "  ${BOLD}cd your-project${NC}"
echo -e "  ${BOLD}~/.accord/init.sh${NC}"
echo ""
echo "This will create .accord/, install skills + commands, and update CLAUDE.md."
echo ""
echo -e "Then in Claude Code, run ${CYAN}/accord-scan full${NC} to build your knowledge base."
echo ""
