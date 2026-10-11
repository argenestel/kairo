#!/usr/bin/env bash
set -euo pipefail
# Local Anvil fork rehearsal: deploy + seed + buy YES/NO + record a real Chainlink round + redeem.
# Never spends live ETH. Usage: scripts/evm-fork-rehearse.sh <chainId> [port]
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CHAIN_ID="${1:-}"
[[ "$CHAIN_ID" =~ ^[0-9]+$ ]] || { echo "usage: scripts/evm-fork-rehearse.sh <chainId> [port]"; exit 1; }
PORT="${2:-}"
python3 - "$CHAIN_ID" <<'PY'
import json,sys
cid=int(sys.argv[1])
cfg=json.load(open("config/chains.json"))
chain=next((c for c in cfg["chains"] if int(c["chainId"])==cid), None)
if chain is None:
    raise SystemExit(f"chain {cid} not in config/chains.json")
if chain.get("oracle")!="chainlink":
    raise SystemExit(f"fork rehearsal is for Chainlink venues; {cid} is {chain.get('oracle')}")
PY
FORK_RPC="$(python3 - "$CHAIN_ID" <<'PY'
import json,sys
cid=int(sys.argv[1])
cfg=json.load(open("config/chains.json"))
print(next(c["rpc"] for c in cfg["chains"] if int(c["chainId"])==cid))
PY
)"
if [[ -z "$PORT" ]]; then
  if [[ "$CHAIN_ID" == 84532 ]]; then PORT=8547; else PORT=8548; fi
fi
LOGDIR="deployments/logs/$CHAIN_ID"
mkdir -p "$LOGDIR"
ANVIL_LOG="$LOGDIR/anvil.log"
RPC_URL="http://127.0.0.1:$PORT"

if curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC_URL" >/dev/null 2>&1; then
  echo "Reusing existing Anvil at $RPC_URL"
  STARTED_ANVIL=0
else
  echo "Starting Anvil fork of chain $CHAIN_ID on port $PORT"
  anvil --fork-url "$FORK_RPC" --port "$PORT" --host 127.0.0.1 >"$ANVIL_LOG" 2>&1 &
  ANVIL_PID=$!
  STARTED_ANVIL=1
  cleanup() {
    if [[ "${STARTED_ANVIL}" == 1 ]]; then kill "$ANVIL_PID" 2>/dev/null || true; fi
  }
  trap cleanup EXIT
  for i in $(seq 1 90); do
    if curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC_URL" >/dev/null 2>&1; then
      break
    fi
    sleep 1
    if [[ "$i" == 90 ]]; then echo "Anvil failed to start; see $ANVIL_LOG"; exit 1; fi
  done
fi

FORK_DEPLOYER="$(cast rpc eth_accounts --rpc-url "$RPC_URL" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0])')"
export CHAIN_ID RPC_URL
export FORK_REHEARSAL=1
export CONTRACTS_OUT="$LOGDIR/fork.contracts.json"
export MANIFEST_OUT="$LOGDIR/fork-manifest.json"
# Never clobber the live SDK/keeper manifest. Opt in with ALLOW_LIVE_MANIFEST_OVERWRITE=1.
python3 - "$ROOT" "$CHAIN_ID" "$CONTRACTS_OUT" "$MANIFEST_OUT" <<'PY'
import os, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
cid = sys.argv[2]
live_manifest = (root / "deployments" / f"{cid}.json").resolve()
live_contracts = (root / "deployments" / f"{cid}.contracts.json").resolve()
outs = [Path(sys.argv[3]).resolve(), Path(sys.argv[4]).resolve()]
if os.environ.get("ALLOW_LIVE_MANIFEST_OVERWRITE") == "1":
    raise SystemExit(0)
for path in outs:
    if path in (live_manifest, live_contracts):
        raise SystemExit(f"evm-fork-rehearse: refusing to overwrite live {path}")
print("fork outputs", *(str(p) for p in outs))
PY
echo "▶ deploy on fork as $FORK_DEPLOYER"
CHAIN_ID="$CHAIN_ID" ALLOW_ANY_CHAIN=1 \
  forge script script/DeployEvm.s.sol:DeployEvm --rpc-url "$RPC_URL" \
  --unlocked --sender "$FORK_DEPLOYER" --broadcast --slow \
  > "$LOGDIR/fork-deploy.log" 2>&1 || { tail -40 "$LOGDIR/fork-deploy.log"; exit 1; }

echo "▶ manifest"
RPC_URL="$RPC_URL" MANIFEST_RPC="$RPC_URL" MANIFEST_ALLOW_UNVERIFIED=1 \
  CONTRACTS_IN="$CONTRACTS_OUT" FORK_REHEARSAL=1 \
  node scripts/evm-manifest.mjs "$CHAIN_ID" "$MANIFEST_OUT"

echo "▶ seed + vault refresh"
(
  export DEPLOYMENT="$ROOT/$MANIFEST_OUT"
  export RPC_URL CHAIN_ID
  export BOT_ADDRESS="$FORK_DEPLOYER"
  export SKIP_SPEND_GUARD=1
  pnpm --dir bots exec tsx src/evm-seed.ts
  EVM_KEEPER_CREATE=0 EVM_KEEPER_RESOLVE=0 EVM_REFRESH_LIMIT=200 \
    pnpm --dir bots exec tsx src/evm-keeper.ts --once
) > "$LOGDIR/fork-seed.log" 2>&1 || { tail -50 "$LOGDIR/fork-seed.log"; exit 1; }

echo "▶ settlement rehearsal (real Chainlink rounds)"
(
  export DEPLOYMENT="$ROOT/$MANIFEST_OUT"
  export RPC_URL CHAIN_ID
  export BOT_ADDRESS="$FORK_DEPLOYER"
  export REHEARSAL_REPORT="$ROOT/$LOGDIR/fork-rehearsal.json"
  pnpm --dir bots exec tsx ../scripts/evm-rehearsal.ts
)

echo "✔ fork rehearsal passed for chain $CHAIN_ID"
echo "  report $LOGDIR/fork-rehearsal.json"
echo "  anvil  $RPC_URL"
if [[ "$STARTED_ANVIL" == 1 && "${KEEP_ANVIL:-0}" == 1 ]]; then
  echo "  leaving Anvil running (pid $ANVIL_PID); KEEP_ANVIL=1"
  trap - EXIT
elif [[ "$STARTED_ANVIL" == 1 ]]; then
  echo "  stopping Anvil pid $ANVIL_PID"
fi
