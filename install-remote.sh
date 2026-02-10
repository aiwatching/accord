#!/usr/bin/env bash
# Accord Remote Installer
# Sets up Accord in any project without manually cloning the full repo.
#
# ── For PUBLIC repos ──────────────────────────────────────────────────────────
#   curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install-remote.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/aiwatching/accord/main/install-remote.sh | bash -s -- [flags]
#
# ── For PRIVATE repos (or any repo) ──────────────────────────────────────────
#   bash <(git archive --remote=https://github.com/aiwatching/accord.git HEAD install-remote.sh | tar -xO)
#
#   Or the simplest approach — just run this directly:
#     npx accord-init    (future)
#     git clone https://github.com/aiwatching/accord.git ~/.accord && ~/.accord/install-remote.sh
#
# ── Examples ──────────────────────────────────────────────────────────────────
#   # Interactive mode
#   ~/.accord/install-remote.sh
#
#   # Non-interactive with flags
#   ~/.accord/install-remote.sh \
#     --project-name my-app --teams "frontend,backend" --adapter claude-code --no-interactive
#
#   # With auto-scan
#   ~/.accord/install-remote.sh \
#     --project-name my-app --teams "a,b" --adapter claude-code --scan --no-interactive
#
# ── What it does ──────────────────────────────────────────────────────────────
#   1. Downloads Accord to ~/.accord/ (shallow clone, ~1MB) — or updates if cached
#   2. Runs init.sh in the current directory with your flags
#   3. Subsequent runs reuse the cached copy (git pull to update)

set -euo pipefail

ACCORD_REPO="${ACCORD_REPO:-https://github.com/aiwatching/accord.git}"
ACCORD_HOME="${ACCORD_HOME:-$HOME/.accord}"
ACCORD_BRANCH="${ACCORD_BRANCH:-main}"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}[accord]${NC} $*"; }
err() { echo -e "${RED}[accord] ERROR:${NC} $*" >&2; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || err "git is required but not installed"

# ── Download / Update ─────────────────────────────────────────────────────────
if [[ -d "$ACCORD_HOME/.git" ]]; then
    log "Updating Accord at $ACCORD_HOME ..."
    (cd "$ACCORD_HOME" && git pull --quiet origin "$ACCORD_BRANCH" 2>/dev/null) || \
        log "Update failed (offline?), using cached version"
elif [[ -d "$ACCORD_HOME" && -f "$ACCORD_HOME/init.sh" ]]; then
    # Script is being run from inside an existing accord clone (e.g., ~/.accord/install-remote.sh)
    log "Using Accord at $ACCORD_HOME"
else
    log "Downloading Accord to $ACCORD_HOME ..."
    rm -rf "$ACCORD_HOME"
    git clone --depth 1 --branch "$ACCORD_BRANCH" --quiet "$ACCORD_REPO" "$ACCORD_HOME" || \
        err "Failed to clone Accord. Check your network and that $ACCORD_REPO is accessible."
    log "Downloaded successfully"
fi

# ── Run init.sh ───────────────────────────────────────────────────────────────
INIT_SCRIPT="$ACCORD_HOME/init.sh"

if [[ ! -f "$INIT_SCRIPT" ]]; then
    err "init.sh not found at $INIT_SCRIPT — download may be corrupted. Remove $ACCORD_HOME and retry."
fi

chmod +x "$INIT_SCRIPT"

log "Running init.sh in $(pwd) ..."
echo ""

bash "$INIT_SCRIPT" --target-dir "." "$@"
