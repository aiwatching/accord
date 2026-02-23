#!/usr/bin/env bash
# Accord Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
#
# Install a specific version:
#   ACCORD_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install.sh | bash
#
# Install from local dev directory (skips git clone, uses source in-place):
#   ./install.sh --local
#
# What it does:
#   1. Downloads Accord to ~/.accord/ (shallow clone) — or symlinks from local dir
#   2. Checks out the specified version (or latest tag)
#   3. Builds the TypeScript agent
#
# After install, run in your project directory:
#   ~/.accord/init.sh

set -euo pipefail

ACCORD_REPO="${ACCORD_REPO:-https://github.com/aiwatching/accord.git}"
ACCORD_HOME="${ACCORD_HOME:-$HOME/.accord}"
ACCORD_VERSION="${ACCORD_VERSION:-latest}"
ACCORD_LOCAL=false

# Parse args
for arg in "$@"; do
    case "$arg" in
        --local) ACCORD_LOCAL=true ;;
    esac
done

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

# ── Local dev mode ───────────────────────────────────────────────────────────

if [[ "$ACCORD_LOCAL" == "true" ]]; then
    # Resolve the directory where install.sh lives (= repo root)
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    if [[ ! -d "$SCRIPT_DIR/.git" ]]; then
        err "--local requires running from the Accord repo root (no .git found in $SCRIPT_DIR)"
    fi

    log "Local dev mode: using source at $SCRIPT_DIR"

    # Point ~/.accord to local source via symlink
    if [[ -L "$ACCORD_HOME" ]]; then
        rm "$ACCORD_HOME"
    elif [[ -d "$ACCORD_HOME" ]]; then
        log "Removing existing $ACCORD_HOME (was a full clone, replacing with symlink)"
        rm -rf "$ACCORD_HOME"
    fi

    ln -sf "$SCRIPT_DIR" "$ACCORD_HOME"
    log "Symlinked $ACCORD_HOME → $SCRIPT_DIR"

else
    # ── Remote mode: Download / Update ───────────────────────────────────────

    resolve_version

    if [[ -L "$ACCORD_HOME" ]]; then
        log "Removing dev symlink at $ACCORD_HOME (switching to remote mode)"
        rm "$ACCORD_HOME"
    fi

    if [[ -d "$ACCORD_HOME/.git" ]]; then
        log "Updating Accord at $ACCORD_HOME ..."
        (
            cd "$ACCORD_HOME"
            git fetch --quiet --tags origin 2>/dev/null
            git fetch --quiet origin "$ACCORD_VERSION" 2>/dev/null
            if git rev-parse --verify "origin/$ACCORD_VERSION" >/dev/null 2>&1; then
                # It's a remote branch — checkout and pull latest
                git checkout --quiet "$ACCORD_VERSION" 2>/dev/null || git checkout --quiet -b "$ACCORD_VERSION" "origin/$ACCORD_VERSION" 2>/dev/null
                git pull --quiet origin "$ACCORD_VERSION" 2>/dev/null
            elif git rev-parse --verify "$ACCORD_VERSION" >/dev/null 2>&1; then
                # It's a tag or existing local ref
                git checkout --quiet "$ACCORD_VERSION" 2>/dev/null
            else
                err "Version '$ACCORD_VERSION' not found as branch or tag"
            fi
        ) || log "Update failed (offline?), using cached version"
        log "Updated to $ACCORD_VERSION"
    else
        if [[ -d "$ACCORD_HOME" ]]; then
            rm -rf "$ACCORD_HOME"
        fi
        log "Downloading Accord $ACCORD_VERSION to $ACCORD_HOME ..."
        git clone --branch "$ACCORD_VERSION" --quiet "$ACCORD_REPO" "$ACCORD_HOME" || \
            err "Failed to clone '$ACCORD_VERSION'. Check that the branch/tag exists and $ACCORD_REPO is accessible."
        log "Downloaded successfully"
    fi

    chmod +x "$ACCORD_HOME/init.sh" "$ACCORD_HOME/setup.sh" "$ACCORD_HOME/uninstall.sh" "$ACCORD_HOME/upgrade.sh"
fi

# ── Build TypeScript agent (if Node.js available) ─────────────────────────────

build_ts_agent() {
    if ! command -v node >/dev/null 2>&1; then
        log "Node.js not found — skipping TypeScript agent build (legacy bash agent will be used)"
        return
    fi

    local node_ver
    node_ver="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
    if [[ -z "$node_ver" || "$node_ver" -lt 20 ]]; then
        log "Node.js >= 20 required for TypeScript agent (found v${node_ver:-unknown}) — using legacy bash agent"
        return
    fi

    if [[ ! -f "$ACCORD_HOME/agent/package.json" ]]; then
        log "No agent/package.json found — skipping TypeScript agent build"
        return
    fi

    log "Building TypeScript agent..."
    if (cd "$ACCORD_HOME/agent" && npm install --quiet 2>/dev/null && npm run build 2>/dev/null); then
        log "TypeScript agent built successfully"
    else
        log "TypeScript agent build failed — legacy bash agent will be used as fallback"
    fi
}

build_ts_agent

# ── Read installed version ────────────────────────────────────────────────────

INSTALLED_VERSION="unknown"
if [[ -f "$ACCORD_HOME/VERSION" ]]; then
    INSTALLED_VERSION="$(cat "$ACCORD_HOME/VERSION" | tr -d '[:space:]')"
fi

# ── Create symlink for accord-hub command ────────────────────────────────────

if [[ -f "$ACCORD_HOME/accord-hub.sh" ]]; then
    LINK_DIR="/usr/local/bin"
    if [[ -w "$LINK_DIR" ]]; then
        ln -sf "$ACCORD_HOME/accord-hub.sh" "$LINK_DIR/accord-hub"
        log "Created symlink: accord-hub → $ACCORD_HOME/accord-hub.sh"
    else
        # Try with sudo, or fall back to ~/.local/bin
        LOCAL_BIN="$HOME/.local/bin"
        mkdir -p "$LOCAL_BIN"
        ln -sf "$ACCORD_HOME/accord-hub.sh" "$LOCAL_BIN/accord-hub"
        if ! echo "$PATH" | grep -q "$LOCAL_BIN"; then
            echo -e "${DIM}Add to PATH: export PATH=\"$LOCAL_BIN:\$PATH\"${NC}"
        fi
    fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
if [[ "$ACCORD_LOCAL" == "true" ]]; then
    echo -e "${GREEN}${BOLD}Accord v${INSTALLED_VERSION} installed (local dev mode)${NC}"
    echo -e "${DIM}~/.accord → $(readlink "$ACCORD_HOME")${NC}"
else
    echo -e "${GREEN}${BOLD}Accord v${INSTALLED_VERSION} installed at ~/.accord/${NC}"
fi
echo ""
echo "Commands:"
echo ""
echo -e "  ${BOLD}accord-hub${NC}                 Start the Hub Service (API + Web UI)"
echo -e "  ${BOLD}accord-hub update${NC}          Pull latest code + rebuild"
echo -e "  ${BOLD}~/.accord/setup.sh${NC}         Set up a new project (interactive wizard)"
echo -e "  ${BOLD}~/.accord/init.sh${NC}          Initialize a single repo (hub or service)"
echo ""
echo -e "  ${DIM}Installed version: ${INSTALLED_VERSION}${NC}"
echo -e "  ${DIM}Run any command with --help for options.${NC}"
echo ""
