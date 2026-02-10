#!/usr/bin/env bash
# Accord Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
#
# Install a specific version:
#   ACCORD_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
#
# What it does:
#   1. Downloads Accord to ~/.accord/ (shallow clone)
#   2. Checks out the specified version (or latest tag)
#   3. Tells you how to initialize your project
#
# After install, run in your project directory:
#   ~/.accord/init.sh

set -euo pipefail

ACCORD_REPO="${ACCORD_REPO:-https://github.com/aiwatching/accord.git}"
ACCORD_HOME="${ACCORD_HOME:-$HOME/.accord}"
ACCORD_VERSION="${ACCORD_VERSION:-latest}"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

log() { echo -e "${CYAN}[accord]${NC} $*"; }
err() { echo -e "${RED}[accord] ERROR:${NC} $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || err "git is required but not installed"

# ── Resolve version ──────────────────────────────────────────────────────────

resolve_version() {
    if [[ "$ACCORD_VERSION" == "latest" ]]; then
        # Get latest tag from remote (without cloning)
        local latest_tag
        latest_tag="$(git ls-remote --tags --sort=-v:refname "$ACCORD_REPO" 'v*' 2>/dev/null \
            | head -1 | sed 's|.*refs/tags/||; s|\^{}||')"
        if [[ -n "$latest_tag" ]]; then
            ACCORD_VERSION="$latest_tag"
        else
            ACCORD_VERSION="main"
            log "No release tags found, using main branch"
        fi
    fi
}

# ── Download / Update ─────────────────────────────────────────────────────────

resolve_version

if [[ -d "$ACCORD_HOME/.git" ]]; then
    log "Updating Accord at $ACCORD_HOME ..."
    (
        cd "$ACCORD_HOME"
        git fetch --quiet --tags origin 2>/dev/null
        if [[ "$ACCORD_VERSION" != "main" ]]; then
            git checkout --quiet "$ACCORD_VERSION" 2>/dev/null
        else
            git pull --quiet origin main 2>/dev/null
        fi
    ) || log "Update failed (offline?), using cached version"
    log "Updated to $ACCORD_VERSION"
else
    if [[ -d "$ACCORD_HOME" ]]; then
        rm -rf "$ACCORD_HOME"
    fi
    log "Downloading Accord $ACCORD_VERSION to $ACCORD_HOME ..."
    if [[ "$ACCORD_VERSION" == "main" ]]; then
        git clone --depth 1 --branch main --quiet "$ACCORD_REPO" "$ACCORD_HOME" || \
            err "Failed to clone. Check your network and that $ACCORD_REPO is accessible."
    else
        git clone --branch "$ACCORD_VERSION" --quiet "$ACCORD_REPO" "$ACCORD_HOME" || \
            err "Failed to clone version $ACCORD_VERSION. Check that the tag exists."
    fi
    log "Downloaded successfully"
fi

chmod +x "$ACCORD_HOME/init.sh" "$ACCORD_HOME/uninstall.sh" "$ACCORD_HOME/upgrade.sh"

# ── Read installed version ────────────────────────────────────────────────────

INSTALLED_VERSION="unknown"
if [[ -f "$ACCORD_HOME/VERSION" ]]; then
    INSTALLED_VERSION="$(cat "$ACCORD_HOME/VERSION" | tr -d '[:space:]')"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Accord v${INSTALLED_VERSION} installed at ~/.accord/${NC}"
echo ""
echo "Commands:"
echo ""
echo -e "  ${BOLD}~/.accord/init.sh${NC}          Initialize Accord in your project"
echo -e "  ${BOLD}~/.accord/upgrade.sh${NC}       Upgrade project to latest Accord version"
echo -e "  ${BOLD}~/.accord/uninstall.sh${NC}     Remove Accord from your project"
echo ""
echo -e "  ${DIM}Installed version: ${INSTALLED_VERSION}${NC}"
echo -e "  ${DIM}Run any command with --help for options.${NC}"
echo ""
