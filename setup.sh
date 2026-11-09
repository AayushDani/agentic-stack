#!/bin/bash
# One-command macOS bootstrap. All paths are resolved relative to this file.
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.t3/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:/usr/local/opt/node@24/bin:$PATH"
STACK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Inspection modes never install prerequisites.
for STACK_ARG in "$@"; do
  case "$STACK_ARG" in
    --check|--dry-run|--help|-h)
      if ! command -v node >/dev/null 2>&1; then
        printf 'Node.js is missing. Run this command without inspection flags to install prerequisites.\n'
        exit 2
      fi
      exec node "$STACK_DIR/setup/bootstrap.mjs" "$@"
      ;;
  esac
done

if [ "$(uname -s)" != Darwin ]; then
  printf 'This bootstrapper is for macOS.\n' >&2
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  printf 'Installing Homebrew. macOS may request your password.\n'
  STACK_INSTALLER="$(mktemp -t agentic-homebrew)"
  trap 'rm -f "$STACK_INSTALLER"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 \
    https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$STACK_INSTALLER"
  /bin/bash "$STACK_INSTALLER"
  rm -f "$STACK_INSTALLER"
  trap - EXIT
fi

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  brew install node@24
  STACK_NODE_PREFIX="$(brew --prefix node@24)"
  export PATH="$STACK_NODE_PREFIX/bin:$PATH"
fi

# Homebrew's first install and keg-only Node must work in later Terminal sessions,
# not just inside this installer. Keep the user's existing profile intact.
STACK_PROFILE="$HOME/.zprofile"
case "${SHELL:-/bin/zsh}" in */bash) STACK_PROFILE="$HOME/.bash_profile" ;; esac
STACK_PATH_MARKER='# Agentic Stack tool paths'
if ! /usr/bin/grep -Fqx "$STACK_PATH_MARKER" "$STACK_PROFILE" 2>/dev/null; then
  cat >> "$STACK_PROFILE" <<'STACK_PATHS'

# Agentic Stack tool paths
for agentic_tool_dir in "$HOME/.local/bin" "$HOME/.t3/bin" /opt/homebrew/bin /opt/homebrew/sbin /opt/homebrew/opt/node@24/bin /usr/local/bin /usr/local/sbin /usr/local/opt/node@24/bin; do
  if [ -d "$agentic_tool_dir" ]; then
    case ":$PATH:" in *":$agentic_tool_dir:"*) ;; *) export PATH="$agentic_tool_dir:$PATH" ;; esac
  fi
done
unset agentic_tool_dir
STACK_PATHS
fi
exec node "$STACK_DIR/setup/bootstrap.mjs" "$@"
