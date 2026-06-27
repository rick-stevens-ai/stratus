#!/usr/bin/env bash
#
# FALDA installer
# -----------------
# One-shot setup for the FALDA hierarchical agent-memory store.
# Verifies the toolchain, installs dependencies, builds, runs the offline
# smoke test, and (optionally) links the `falda` CLI onto your PATH.
#
# Usage:
#   ./install.sh                 # install + build + smoke test
#   ./install.sh --link          # also symlink bin/falda into a PATH dir
#   ./install.sh --prefix DIR    # link target dir (default: /usr/local/bin, else ~/.local/bin)
#   ./install.sh --no-smoke      # skip the smoke test
#   ./install.sh --help
#
set -euo pipefail

# ---- locate the repo (this script lives at the repo root) -------------------
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# ---- pretty output ---------------------------------------------------------
if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; Z=$'\033[0m'
else
  B=""; G=""; Y=""; R=""; C=""; Z=""
fi
say()  { printf "%s\n" "${C}==>${Z} ${B}$*${Z}"; }
ok()   { printf "%s\n" "    ${G}ok${Z} $*"; }
warn() { printf "%s\n" "    ${Y}!!${Z} $*"; }
die()  { printf "%s\n" "    ${R}xx${Z} $*" >&2; exit 1; }

# ---- args ------------------------------------------------------------------
DO_LINK=0
DO_SMOKE=1
PREFIX=""
while [ $# -gt 0 ]; do
  case "$1" in
    --link)     DO_LINK=1 ;;
    --no-smoke) DO_SMOKE=0 ;;
    --prefix)   shift; PREFIX="${1:-}"; [ -n "$PREFIX" ] || die "--prefix needs a directory" ;;
    --help|-h)
      sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown flag: $1 (try --help)" ;;
  esac
  shift
done

echo
say "FALDA installer"
echo "    repo: $HERE"
echo

# ---- 1. toolchain check ----------------------------------------------------
say "Checking toolchain"
command -v node >/dev/null 2>&1 || die "node not found. Install Node.js >= 20 (https://nodejs.org)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js >= 20 required; found $(node -v)."
fi
ok "node $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm not found (ships with Node.js)."
ok "npm $(npm -v)"

# better-sqlite3 builds a native addon; on Linux this needs build tools.
if [ "$(uname -s)" = "Linux" ]; then
  command -v make >/dev/null 2>&1 || warn "make not found — better-sqlite3 may need build-essential / python3."
fi

# ---- 2. install deps -------------------------------------------------------
say "Installing dependencies"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund 2>&1 | tail -3 || npm install --no-audit --no-fund 2>&1 | tail -3
else
  npm install --no-audit --no-fund 2>&1 | tail -3
fi
ok "dependencies installed"

# ---- 3. build --------------------------------------------------------------
say "Building (tsc)"
npm run build >/dev/null
[ -f dist/index.js ] || die "build did not emit dist/index.js"
[ -f dist/gateway.js ] || die "build did not emit dist/gateway.js"
ok "dist/ emitted"

# ---- 4. smoke test ---------------------------------------------------------
if [ "$DO_SMOKE" -eq 1 ]; then
  say "Running offline smoke test"
  if npm run smoke 2>&1 | tail -4; then
    ok "smoke test passed"
  else
    die "smoke test failed"
  fi
else
  warn "smoke test skipped (--no-smoke)"
fi

# ---- 5. optional: link the CLI onto PATH -----------------------------------
chmod +x bin/falda 2>/dev/null || true
if [ "$DO_LINK" -eq 1 ]; then
  say "Linking the falda CLI"
  if [ -z "$PREFIX" ]; then
    if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
      PREFIX=/usr/local/bin
    else
      PREFIX="$HOME/.local/bin"
      mkdir -p "$PREFIX"
    fi
  fi
  ln -sf "$HERE/bin/falda" "$PREFIX/falda"
  ok "linked -> $PREFIX/falda"
  case ":$PATH:" in
    *":$PREFIX:"*) : ;;
    *) warn "$PREFIX is not on your PATH — add it: export PATH=\"$PREFIX:\$PATH\"" ;;
  esac
else
  echo
  echo "    To put the CLI on your PATH:   ./install.sh --link"
  echo "    Or run it directly:            ./bin/falda help"
fi

echo
say "Done."
echo "    Start the gateway:   ./bin/falda serve"
echo "    Health check:        curl -s localhost:\${FALDA_PORT:-8077}/healthz"
echo
