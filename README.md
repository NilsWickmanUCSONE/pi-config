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
mkdir -p ~/.pi/agent
rsync -av settings.json extensions skills ~/.pi/agent/
```

If package-backed resources are listed in `settings.json`, Pi can install/load them on the target machine via its normal package handling.
