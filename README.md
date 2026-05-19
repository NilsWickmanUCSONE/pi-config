# Pi Config

Private reusable Pi coding agent configuration for `nils.wickman@ucsmindbite.se`.

## Contents

- `settings.json` — global Pi settings
- `extensions/` — local Pi extensions
- `skills/` — local Pi skills

This repository intentionally excludes sessions, package caches, `node_modules`, and secrets.

## Install on another computer

```bash
npm install -g @earendil-works/pi-coding-agent
git clone https://github.com/NilsWickmanUCSONE/pi-config.git ~/pi-config
~/pi-config/install.sh
```

`install.sh` symlinks this repo into `~/.pi/agent` and installs package-backed resources into `~/.pi/agent/npm`, including themes/extensions from `context-mode`, `pi-web-access`, and `pi-powerline-footer`.

Restart pi after running the installer.
