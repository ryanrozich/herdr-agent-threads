#!/bin/sh
# Runs Harbor's own code on our ATIF exports and prints what it accepts and what it sees
# (test/harbor/report.py). Harbor is harbor-framework/harbor 0.26.0, pinned by commit and
# installed from its own lock file with uv and Python 3.12 into a temp folder this script
# removes. The exports come from the command line's own tests (ATIF_KEEP) and test/make-agents.js,
# made-up sessions only. Not part of bun test: .github/workflows/harbor.yml runs it.
# Needs bun, git, network and uv 0.13.5 or newer (Harbor's pyproject asks for it); with an older
# uv, set UV='uvx --from uv==0.13.9 uv'. Exits with report.py's code.
# Usage: sh test/harbor/run.sh
set -eu
cd "$(dirname "$0")/../.." || exit 2
root=$(pwd)
HARBOR_COMMIT=110c71b32c268e1d113c3856869202842f8e37a6
UV=${UV:-uv}
s=$(mktemp -d "${TMPDIR:-/tmp}/threads-harbor-XXXXXX")
trap 'rm -rf "$s"' EXIT
trap 'exit 130' INT TERM
mkdir "$s/harbor" "$s/out"

# Harbor at the pin, and its locked dependencies.
git -C "$s/harbor" init -q
git -C "$s/harbor" fetch -q --depth 1 https://github.com/harbor-framework/harbor.git "$HARBOR_COMMIT"
git -C "$s/harbor" -c advice.detachedHead=false checkout -q FETCH_HEAD
(cd "$s/harbor" && UV_PROJECT_ENVIRONMENT="$s/venv" $UV sync -q --frozen --no-dev --python 3.12)

# The exports: Claude with two helpers and Codex with a child and a grandchild, from the two
# tests in test/atif.test.js that write them to ATIF_KEEP, and a Codex session with none.
ATIF_KEEP="$s/out" bun test test/atif.test.js -t "the command line nests" > "$s/bun-test.txt" 2>&1 || { cat "$s/bun-test.txt"; exit 1; }
codex=$(bun test/make-agents.js "$s/agents" /Users/dev/acme-web 2026-11-01T09:00:00Z | head -n 1)
bun mods/agent-threads/core/atif.js "$codex" codex > "$s/out/codex.json"

# Harbor's code runs isolated (-I), from the temp folder, not from Harbor's source or the repo.
status=0
(cd "$s" && "$s/venv/bin/python" -I "$root/test/harbor/report.py" "$s/out") > "$s/report.md" || status=$?
cat "$s/report.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$s/report.md" >> "$GITHUB_STEP_SUMMARY"; fi
exit "$status"
