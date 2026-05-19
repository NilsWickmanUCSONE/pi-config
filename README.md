# Pi Config

Private reusable Pi coding agent configuration for `nils.wickman@ucsmindbite.se`.

## Contents

- `settings.json` — global Pi settings
- `extensions/` — local Pi extensions
- `skills/` — local Pi skills
- `package-overlays/` — intentionally tracked local modifications to package-installed resources, applied after `npm install`

This repository intentionally excludes sessions, package caches, full `node_modules`, and secrets.

## Install on another computer

```bash
npm install -g @earendil-works/pi-coding-agent
git clone https://github.com/NilsWickmanUCSONE/pi-config.git ~/pi-config
~/pi-config/install.sh
```

`install.sh` symlinks this repo into `~/.pi/agent`, installs package-backed resources into `~/.pi/agent/npm`, including themes/extensions from `context-mode`, `pi-web-access`, and `pi-powerline-footer`, then reapplies tracked local package overlays.

Restart pi after running the installer.
