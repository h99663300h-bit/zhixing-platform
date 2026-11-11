#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -f private/admin.env ]; then
  set -a
  . ./private/admin.env
  set +a
fi
if command -v node >/dev/null 2>&1; then
  exec node server.js
fi
BUNDLED_NODE="/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ -x "$BUNDLED_NODE" ]; then
  exec "$BUNDLED_NODE" server.js
fi
printf '%s\n' 'Install Node.js 18 or newer, then run this script again.' >&2
exit 1
