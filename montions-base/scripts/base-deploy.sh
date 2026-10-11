#!/usr/bin/env bash
# Back-compat wrapper. Prefer: scripts/evm-deploy.sh 84532
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/scripts/evm-deploy.sh" 84532 "$@"
