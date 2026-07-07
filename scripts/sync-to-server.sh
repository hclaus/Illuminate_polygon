#!/bin/bash
# Sync your current work to the LabPaaS-deployed server branch.
#
# Usage:
#   bash scripts/sync-to-server.sh              Normal run
#   bash scripts/sync-to-server.sh --continue    Resume after manually resolving a conflict
#
# What it does:
#   1. Fetches the latest publish-to-server branch from the illuminate-v2
#      GitHub repo (what LabPaaS actually builds from).
#   2. Merges it into a throwaway "sync-to-server" branch built from whatever
#      branch you currently have checked out.
#   3. If there's a merge conflict, stops immediately and tells you what to
#      do -- your original branch is left untouched, nothing is pushed.
#   4. If the merge is clean (or after you resolve conflicts and re-run with
#      --continue), runs the full backend + frontend test suites.
#   5. Only if everything passes, pushes the result to publish-to-server.
#   6. Switches you back to your original branch.
#
# Never force-pushes. Never touches publish-to-server unless tests pass.
set -e
cd "$(dirname "$0")/.."

SERVER_REMOTE="illuminate-v2-gh"
SERVER_REMOTE_URL="https://github.com/hclaus/illuminate-v2.git"
SERVER_BRANCH="publish-to-server"
SYNC_BRANCH="sync-to-server"

if [ "$1" = "--continue" ]; then
  if [ "$(git rev-parse --abbrev-ref HEAD)" != "$SYNC_BRANCH" ]; then
    echo "Error: --continue expects you to be on '$SYNC_BRANCH' (currently on $(git rev-parse --abbrev-ref HEAD))."
    exit 1
  fi
  if ! git diff --quiet || ! git diff --cached --quiet --exit-code 2>/dev/null; then
    : # allow staged resolution; fall through
  fi
  if [ -f .git/MERGE_HEAD ]; then
    echo "Error: merge still in progress -- 'git add' the resolved files and 'git commit' first, then re-run with --continue."
    exit 1
  fi
  SOURCE_BRANCH="$(cat .git/SYNC_TO_SERVER_SOURCE 2>/dev/null || echo main)"
else
  SOURCE_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

  git diff --quiet && git diff --cached --quiet \
    || { echo "Error: working tree has uncommitted changes. Commit or stash first."; exit 1; }

  if ! git remote get-url "$SERVER_REMOTE" &>/dev/null; then
    echo "=== Adding $SERVER_REMOTE remote ==="
    git remote add "$SERVER_REMOTE" "$SERVER_REMOTE_URL"
  fi

  echo "=== Fetching latest $SERVER_BRANCH ==="
  git fetch "$SERVER_REMOTE" "$SERVER_BRANCH"

  echo "=== Building sync branch from $SOURCE_BRANCH ==="
  git checkout -B "$SYNC_BRANCH" "$SOURCE_BRANCH"
  echo "$SOURCE_BRANCH" > .git/SYNC_TO_SERVER_SOURCE

  echo "=== Merging $SERVER_REMOTE/$SERVER_BRANCH ==="
  if ! git merge "$SERVER_REMOTE/$SERVER_BRANCH" --no-edit; then
    echo ""
    echo "=== MERGE CONFLICT ==="
    echo "Resolve the conflicts listed above, then run:"
    echo "  git add <resolved files>"
    echo "  git commit"
    echo "  bash scripts/sync-to-server.sh --continue"
    echo ""
    echo "(Your original branch '$SOURCE_BRANCH' is untouched; you're on '$SYNC_BRANCH' now.)"
    exit 1
  fi
fi

echo "=== Running backend tests ==="
(cd api && python -m uv run pytest tests/ -q)

echo "=== Running frontend tests ==="
(cd ui && npx vitest run && npx svelte-check --output human)

echo "=== Pushing $SYNC_BRANCH -> $SERVER_REMOTE/$SERVER_BRANCH ==="
git push "$SERVER_REMOTE" "$SYNC_BRANCH:$SERVER_BRANCH"

echo "=== Restoring $SOURCE_BRANCH ==="
git checkout "$SOURCE_BRANCH"
rm -f .git/SYNC_TO_SERVER_SOURCE

echo ""
echo "=== Done ==="
echo "Deployed $(git rev-parse --short "$SYNC_BRANCH") to $SERVER_BRANCH."
echo "If LabPaaS Auto-Rebuild is disabled, trigger a manual Rebuild now."
