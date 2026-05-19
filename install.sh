#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
BACKUP_DIR="$PI_AGENT_DIR/backup-before-pi-config-install-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$PI_AGENT_DIR"

link_item() {
  local name="$1"
  local source="$REPO_DIR/$name"
  local target="$PI_AGENT_DIR/$name"

  if [ ! -e "$source" ]; then
    return 0
  fi

  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    mkdir -p "$BACKUP_DIR"
    mv "$target" "$BACKUP_DIR/$name"
  fi

  ln -s "$source" "$target"
}

link_item settings.json
link_item extensions
link_item skills
link_item prompts
link_item themes

# Package-backed resources, such as context-mode, pi-web-access and
# pi-powerline-footer themes/extensions, are installed into ~/.pi/agent/npm.
mkdir -p "$PI_AGENT_DIR/npm"
cat > "$PI_AGENT_DIR/npm/package.json" <<'JSON'
{
  "name": "pi-extensions",
  "private": true,
  "dependencies": {
    "context-mode": "^1.0.136",
    "pi-powerline-footer": "^0.5.4",
    "pi-web-access": "^0.10.7"
  }
}
JSON

(
  cd "$PI_AGENT_DIR/npm"
  npm install --omit=dev
)

if [ -d "$BACKUP_DIR" ]; then
  echo "Backed up previous Pi config to: $BACKUP_DIR"
fi

echo "Pi config installed from: $REPO_DIR"
echo "Restart pi to load newly installed extensions, skills, and themes."
