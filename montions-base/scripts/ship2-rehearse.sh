#!/usr/bin/env bash
set -euo pipefail
# Fork rehearsal for Kairo ship2 (core + stocks). Writes only under deployments/rehearsal/.
# Usage: scripts/ship2-rehearse.sh <chainId> [port]
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CHAIN_ID="${1:-}"
[[ "$CHAIN_ID" =~ ^[0-9]+$ ]] || { echo "usage: scripts/ship2-rehearse.sh <chainId> [port]"; exit 1; }
PORT="${2:-}"
if [[ -z "$PORT" ]]; then
  if [[ "$CHAIN_ID" == 84532 ]]; then PORT=8561; else PORT=8562; fi
fi
FORK_RPC="$(python3 - "$CHAIN_ID" <<'PY'
import json,sys
cid=int(sys.argv[1])
cfg=json.load(open("config/chains.json"))
print(next(c["rpc"] for c in cfg["chains"] if int(c["chainId"])==cid))
PY
)"
OUTDIR="deployments/rehearsal"
mkdir -p "$OUTDIR"
RPC_URL="http://127.0.0.1:$PORT"
ANVIL_LOG="$OUTDIR/anvil-$CHAIN_ID.log"

if curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC_URL" >/dev/null 2>&1; then
  echo "Reusing Anvil at $RPC_URL"
  STARTED_ANVIL=0
else
  echo "Starting Anvil fork of $CHAIN_ID on :$PORT from $FORK_RPC"
  anvil --fork-url "$FORK_RPC" --port "$PORT" --host 127.0.0.1 --auto-impersonate >"$ANVIL_LOG" 2>&1 &
  ANVIL_PID=$!
  STARTED_ANVIL=1
  cleanup() { if [[ "${STARTED_ANVIL}" == 1 ]]; then kill "$ANVIL_PID" 2>/dev/null || true; fi; }
  trap cleanup EXIT
  for i in $(seq 1 90); do
    if curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC_URL" >/dev/null 2>&1; then
      break
    fi
    sleep 1
    if [[ "$i" == 90 ]]; then echo "Anvil failed; see $ANVIL_LOG"; exit 1; fi
  done
fi

FORK_DEPLOYER="$(cast rpc eth_accounts --rpc-url "$RPC_URL" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0])')"
cast rpc --rpc-url "$RPC_URL" anvil_setBalance "$FORK_DEPLOYER" 0x8AC7230489E80000 >/dev/null
export CHAIN_ID RPC_URL FORK_REHEARSAL=1 ALLOW_ANY_CHAIN=1
export CONTRACTS_OUT="$OUTDIR/$CHAIN_ID.contracts.json"
export MANIFEST_OUT="$OUTDIR/$CHAIN_ID.json"

echo "▶ DeployEvm as $FORK_DEPLOYER"
CHAIN_ID="$CHAIN_ID" ALLOW_ANY_CHAIN=1 \
  forge script script/DeployEvm.s.sol:DeployEvm --rpc-url "$RPC_URL" \
  --unlocked --sender "$FORK_DEPLOYER" --broadcast --slow \
  > "$OUTDIR/deploy-evm-$CHAIN_ID.log" 2>&1 || { tail -40 "$OUTDIR/deploy-evm-$CHAIN_ID.log"; exit 1; }

echo "▶ manifest"
RPC_URL="$RPC_URL" MANIFEST_RPC="$RPC_URL" MANIFEST_ALLOW_UNVERIFIED=1 \
  CONTRACTS_IN="$CONTRACTS_OUT" FORK_REHEARSAL=1 \
  node scripts/evm-manifest.mjs "$CHAIN_ID" "$MANIFEST_OUT"

echo "▶ DeployStocks"
FORK_REHEARSAL=1 CREATE_SERIES=1 \
  ORACLE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contracts"]["chainlinkOracle"])' "$MANIFEST_OUT")" \
  BOOK="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contracts"]["book"])' "$MANIFEST_OUT")" \
  RESOLVER="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contracts"]["chainlinkResolver"])' "$MANIFEST_OUT")" \
  QUOTER="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contracts"]["quoter"])' "$MANIFEST_OUT")" \
  VAULT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contracts"]["vault"])' "$MANIFEST_OUT")" \
  OUT="$OUTDIR/stocks-$CHAIN_ID.json" \
  forge script script/DeployStocks.s.sol:DeployStocks --rpc-url "$RPC_URL" \
  --unlocked --sender "$FORK_DEPLOYER" --broadcast --slow \
  > "$OUTDIR/deploy-stocks-$CHAIN_ID.log" 2>&1 || { tail -50 "$OUTDIR/deploy-stocks-$CHAIN_ID.log"; exit 1; }

python3 - "$MANIFEST_OUT" "$OUTDIR/stocks-$CHAIN_ID.json" <<'PY'
import json,sys
man=json.load(open(sys.argv[1]))
st=json.load(open(sys.argv[2]))
man["contracts"]["keeperFeedHub"]=st["hub"]
json.dump(man, open(sys.argv[1],"w"), indent=2)
print("merged hub", st["hub"], "into", sys.argv[1])
PY

echo "✔ ship2 rehearsal chain=$CHAIN_ID"
echo "  manifest $MANIFEST_OUT"
echo "  stocks   $OUTDIR/stocks-$CHAIN_ID.json"
echo "  anvil    $RPC_URL"
if [[ "$STARTED_ANVIL" == 1 && "${KEEP_ANVIL:-0}" == 1 ]]; then
  echo "  leaving Anvil running pid $ANVIL_PID"
  trap - EXIT
fi
