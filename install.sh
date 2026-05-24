#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
BACKUP_DIR="$PI_AGENT_DIR/backup-before-pi-config-install-$(date +%Y%m%d-%H%M%S)"

if [ "${PI_CONFIG_INSTALL_FONTS:-1}" = "1" ] && [ -x "$REPO_DIR/install-fonts.sh" ]; then
  "$REPO_DIR/install-fonts.sh"
fi

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
link_item SYSTEM.md
link_item APPEND_SYSTEM.md
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

# Re-apply locally modified package files that are intentionally tracked in
# this repo. This keeps package customizations reproducible without committing
# node_modules wholesale.
if [ -d "$REPO_DIR/package-overlays" ]; then
  for package_overlay in "$REPO_DIR"/package-overlays/*; do
    [ -d "$package_overlay" ] || continue
    package_name="$(basename "$package_overlay")"
    package_target="$PI_AGENT_DIR/npm/node_modules/$package_name"
    if [ -d "$package_target" ]; then
      cp -R "$package_overlay"/. "$package_target"/
      echo "Applied local package overlay: $package_name"
    else
      echo "Package overlay target missing, skipped: $package_name" >&2
    fi
  done
fi

# Local core patch: rename Pi's built-in new-session slash command from
# /new to /clear. This keeps the change reproducible after reinstalling pi.
node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function resolvePiPackageRoot() {
  const candidates = [];
  try {
    const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    candidates.push(path.join(npmRoot, "@earendil-works", "pi-coding-agent"));
  } catch {}
  try {
    const piBin = execFileSync("sh", ["-lc", "command -v pi"], { encoding: "utf8" }).trim();
    const shim = fs.readFileSync(piBin, "utf8");
    const match = shim.match(/\"([^\"]+@earendil-works\/pi-coding-agent\/dist\/cli\.js)\"/);
    if (match) {
      const cliPath = match[1].replace("$basedir", path.dirname(piBin));
      candidates.push(path.resolve(cliPath, "..", ".."));
    }
  } catch {}
  try {
    candidates.push(path.dirname(require.resolve("@earendil-works/pi-coding-agent/package.json")));
  } catch {}

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "dist", "core", "slash-commands.js")));
}

function replaceOnce(file, before, after) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes(after)) {
    return false;
  }
  if (!text.includes(before)) {
    throw new Error(`Expected text not found in ${file}`);
  }
  fs.writeFileSync(file, text.replace(before, after));
  return true;
}

const packageRoot = resolvePiPackageRoot();
if (!packageRoot) {
  console.error("Could not locate @earendil-works/pi-coding-agent; skipped /clear core patch.");
  process.exitCode = 1;
} else {
  const slashCommands = path.join(packageRoot, "dist", "core", "slash-commands.js");
  const interactiveMode = path.join(packageRoot, "dist", "modes", "interactive", "interactive-mode.js");
  replaceOnce(
    slashCommands,
    '    { name: "new", description: "Start a new session" },',
    '    { name: "clear", description: "Start a new session" },',
  );
  replaceOnce(interactiveMode, 'text === "/new"', 'text === "/clear"');
  console.log("Applied local Pi core patch: /new -> /clear");
}
NODE

if [ -d "$BACKUP_DIR" ]; then
  echo "Backed up previous Pi config to: $BACKUP_DIR"
fi

echo "Pi config installed from: $REPO_DIR"
echo "Restart pi to load newly installed extensions, skills, and themes."
