#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${PI_CONFIG_REPO_DIR:-$HOME/pi-config}"
LOG_FILE="${PI_CONFIG_SYNC_LOG:-$HOME/.pi/agent/pi-config-auto-sync.log}"
LOCK_FILE="${PI_CONFIG_SYNC_LOCK:-$HOME/.pi/agent/pi-config-auto-sync.lock}"
REMOTE="${PI_CONFIG_SYNC_REMOTE:-origin}"
BRANCH="${PI_CONFIG_SYNC_BRANCH:-}"

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$LOCK_FILE")"
exec >>"$LOG_FILE" 2>&1
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date --iso-8601=seconds)] Previous Pi config auto-sync still running; skipping"
  exit 0
fi

echo "[$(date --iso-8601=seconds)] Starting Pi config auto-sync"
cd "$REPO_DIR"
BRANCH="${BRANCH:-$(git branch --show-current)}"

# Ensure GitHub credential helper from gh is available in non-interactive runs.
if command -v gh >/dev/null 2>&1; then
  gh auth setup-git >/dev/null 2>&1 || true
fi

if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
  git commit -m "Auto-sync Pi config $(date '+%Y-%m-%d %H:%M:%S')"
else
  echo "No local changes to commit"
fi

# Rebase before pushing so another machine can update the same private repo.
# During rebase conflicts, prefer the local machine's committed state.
# Note: for `git rebase`, `-X theirs` means the commit being replayed (our local commit).
if ! git pull --rebase --autostash -X theirs "$REMOTE" "$BRANCH"; then
  echo "Pull/rebase failed; leaving changes for manual resolution"
  exit 1
fi

git push "$REMOTE" "$BRANCH"
echo "[$(date --iso-8601=seconds)] Pi config auto-sync complete"
