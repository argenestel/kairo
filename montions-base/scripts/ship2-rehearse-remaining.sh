#!/usr/bin/env bash
# Rehearse all remaining steps without touching live manifests or broadcast receipts.
set -euo pipefail
cd "$(dirname "$0")/.."
CID="${1:?chain id}"; PORT="${2:-8571}"
if [[ "$CID" == 84532 ]]; then FORK_RPC=https://sepolia.base.org; else FORK_RPC=https://arbitrum-sepolia-rpc.publicnode.com; fi
OUTDIR="deployments/rehearsal/ship2-$CID"
mkdir -p "$OUTDIR"
anvil --fork-url "$FORK_RPC" --port "$PORT" --auto-impersonate > "$OUTDIR/anvil.log" 2>&1 &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT
export RPC_URL="http://127.0.0.1:$PORT" CHAIN_ID="$CID" FORK_REHEARSAL=1 FORK=1
export FOUNDRY_BROADCAST="$OUTDIR/broadcast"
export BOT_ADDRESS=0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39 SKIP_SPEND_GUARD=1
for i in $(seq 1 30); do
 if cast chain-id --rpc-url "$RPC_URL" > /dev/null 2>&1; then break; fi
 sleep 1
done
cast rpc --rpc-url "$RPC_URL" anvil_setBalance "$BOT_ADDRESS" 0x8AC7230489E80000 >/dev/null
export DEPLOYMENT="$PWD/$OUTDIR/$CID.json"
if [[ "$CID" == 421614 ]]; then
 CONTRACTS_OUT="$OUTDIR/$CID.contracts.json" forge script script/DeployEvm.s.sol:DeployEvm --rpc-url "$RPC_URL" --unlocked --sender "$BOT_ADDRESS" --broadcast --skip-simulation --legacy --with-gas-price 20000000 > "$OUTDIR/core.log" 2>&1
 CONTRACTS_IN="$OUTDIR/$CID.contracts.json" MANIFEST_RPC="$RPC_URL" node scripts/evm-manifest.mjs "$CID" "$DEPLOYMENT"
 eval "$(python3 - "$DEPLOYMENT" <<'PY'
import json,sys
c=json.load(open(sys.argv[1]))['contracts']
for k,v in {'ORACLE':'chainlinkOracle','BOOK':'book','RESOLVER':'chainlinkResolver','VAULT':'vault','QUOTER':'quoter'}.items(): print('export '+k+'='+c[v])
PY
)"
 OUT="$OUTDIR/stocks.json" CREATE_SERIES=0 forge script script/DeployStocks.s.sol:DeployStocks --rpc-url "$RPC_URL" --unlocked --sender "$BOT_ADDRESS" --broadcast --skip-simulation --legacy --with-gas-price 20000000 > "$OUTDIR/stocks.log" 2>&1
else
 cp "deployments/$CID.json" "$DEPLOYMENT"
fi
OUT="$OUTDIR/events.json" REHEARSE_E2E=0 forge script script/DeployEvents.s.sol:DeployEvents --rpc-url "$RPC_URL" --unlocked --sender "$BOT_ADDRESS" --broadcast --skip-simulation --legacy --with-gas-price 20000000 > "$OUTDIR/events.log" 2>&1
python3 - "$DEPLOYMENT" "$OUTDIR" <<'PY'
import json,sys,pathlib,subprocess
p=sys.argv[1];m=json.load(open(p));d=pathlib.Path(sys.argv[2]);m['rpc']='http://127.0.0.1:'+str(8571 if m['chainId']==84532 else 8572)
s=d/'stocks.json'
if s.exists():
 st=json.load(open(s));m['contracts']['keeperFeedHub']=st['hub'];cfg=json.load(open('config/chains.json'));chain=next(c for c in cfg['chains'] if c['chainId']==m['chainId'])
 for a in chain['assets']:
  if a['symbol'] in st['feeds']:
   m['assets'].append({'symbol':a['symbol'],'assetId':subprocess.check_output(['cast','keccak',a['symbol']],text=True).strip(),'feed':st['feeds'][a['symbol']],'decimals':8,'settleDelay':a['settleDelay'],'tier':a['tier'],'oracle':'chainlink','ladder':False})
m['contracts']['eventResolver']=json.load(open(d/'events.json'))['eventResolver'];json.dump(m,open(p,'w'),indent=2)
PY
pnpm --dir bots stock-seed > "$OUTDIR/stock-seed.log" 2>&1
EVM_KEEPER_CREATE=0 EVM_KEEPER_RESOLVE=0 EVM_REFRESH_LIMIT=200 pnpm --dir bots evm-keeper --once > "$OUTDIR/refresh.log" 2>&1
EVENT_MAKER_STATE="$PWD/$OUTDIR/event-maker-state.json" EVENT_MAKER_MAX_GLOBAL=4000 pnpm --dir bots event-maker --once > "$OUTDIR/event-maker.log" 2>&1
echo "Rehearsal completed $CID; anvil stopped on exit"
