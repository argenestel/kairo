#!/usr/bin/env bash
set -euo pipefail
# Secrets are read only inside child environments; never enable shell tracing here.
# Usage: scripts/evm-deploy.sh <chainId>
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CHAIN_ID="${1:-${CHAIN_ID:-}}"
[[ "$CHAIN_ID" =~ ^[0-9]+$ ]] || { echo "usage: scripts/evm-deploy.sh <chainId>"; exit 1; }
mapfile -t META < <(python3 - "$CHAIN_ID" <<'PY'
import json,sys
cid=int(sys.argv[1])
cfg=json.load(open("config/chains.json"))
chain=next((c for c in cfg["chains"] if int(c["chainId"])==cid), None)
if chain is None:
    raise SystemExit(f"chain {cid} not in config/chains.json")
if chain.get("oracle")!="chainlink":
    raise SystemExit(f"scripts/evm-deploy.sh refuses oracle={chain.get('oracle')} (HyperCore is a different job)")
print(chain["rpc"])
print(chain.get("budgetWei","40000000000000000"))
print(chain.get("explorer",""))
print(chain["name"])
print((chain.get("l2") or {}).get("gasOracle",""))
print((chain.get("l2") or {}).get("stack",""))
PY
)
RPC_URL="${RPC_URL:-${META[0]}}"
BUDGET_WEI="${EVM_BUDGET_WEI:-${BASE_BUDGET_WEI:-${META[1]}}}"
EXPLORER="${META[2]}"
CHAIN_NAME="${META[3]}"
GAS_ORACLE="${META[4]}"
L2_STACK="${META[5]}"
KEYSTORE="${KEYSTORE:-$ROOT/../montions/.dev/keystore/montions-testnet}"
PASSFILE="${PASSFILE:-$ROOT/../montions/.dev/testnet.pass}"
ADDR="$(cast wallet address --keystore "$KEYSTORE" --password-file "$PASSFILE")"
LIVE_ID="$(cast chain-id --rpc-url "$RPC_URL" --rpc-timeout 30)"
[[ "$LIVE_ID" == "$CHAIN_ID" ]] || { echo "RPC chain id $LIVE_ID != $CHAIN_ID"; exit 1; }
LOGDIR="deployments/logs/$CHAIN_ID"
mkdir -p "$LOGDIR"
export RPC_URL CHAIN_ID
BAL="$(cast balance "$ADDR" --rpc-url "$RPC_URL" --rpc-timeout 30)"
START_FILE="$LOGDIR/live-budget.json"
if [[ -f "$START_FILE" ]]; then
  START_WEI="$(python3 - "$ADDR" "$START_FILE" <<'PY'
import json,sys
r=json.load(open(sys.argv[2]))
assert r["deployer"].lower()==sys.argv[1].lower()
print(r["startBalanceWei"])
PY
)"
else
  START_WEI="$BAL"
fi
export EVM_START_BALANCE_WEI="${EVM_START_BALANCE_WEI:-${BASE_START_BALANCE_WEI:-$START_WEI}}"
export EVM_BUDGET_WEI="$BUDGET_WEI"
GAS_PRICE="$(cast gas-price --rpc-url "$RPC_URL" --rpc-timeout 30)"
L1_FEE=0
if [[ -n "$GAS_ORACLE" ]]; then
  L1_FEE="$(cast call "$GAS_ORACLE" 'getL1FeeUpperBound(uint256)(uint256)' 2000000 --rpc-url "$RPC_URL" --rpc-timeout 30 | awk '{print $1}')"
fi
python3 - "$GAS_PRICE" "$L1_FEE" "$BAL" "$EVM_START_BALANCE_WEI" "$BUDGET_WEI" "$CHAIN_ID" "$CHAIN_NAME" "$L2_STACK" <<'PY'
import sys
price,l1,balance,start,budget=map(int,sys.argv[1:6])
chain_id,name,stack=sys.argv[6],sys.argv[7],sys.argv[8]
max_fee=max(price*3, 20_000_000)
# Conservative ceilings: deploy (~8 txs of large bytecode) + 4 seed multicalls + ~63 vault refreshes.
deploy_gas=25_000_000
seed_gas=40_000_000
l2=(deploy_gas+seed_gas)*max_fee
if stack=="op":
    # ~12 write txs against the 2MB calldata upper bound, plus a floor.
    l1=max(l1*12, 50_000_000_000_000)
else:
    l1=max(l1, 20_000_000_000_000)
cost=l2+l1
print(f"=== EVM deploy estimate chain={chain_id} {name} ===")
print(f"Deployer balance: {balance/1e18:.12f} ETH")
print(f"Budget:           {budget/1e18:.12f} ETH")
print(f"Gas price:        {price} wei; max fee {max_fee} wei/gas")
print(f"L2 ceiling:       {l2/1e18:.9f} ETH ({deploy_gas+seed_gas} gas)")
print(f"L1/data ceiling:  {l1/1e18:.9f} ETH")
print(f"Total estimate:   {cost/1e18:.9f} ETH")
print(f"Remaining budget: {(budget-(int(start)-balance))/1e18:.9f} ETH")
if cost > balance:
    raise SystemExit(f"Refusing: estimate {cost/1e18:.6f} ETH exceeds balance {balance/1e18:.6f} ETH")
if int(start)-balance+cost > budget:
    raise SystemExit(f"Refusing: estimate would exceed budget {budget/1e18:.6f} ETH")
PY
MAX_FEE="$(python3 - "$GAS_PRICE" <<'PY'
import sys
print(max(int(sys.argv[1])*3, 20_000_000))
PY
)"
if [[ "${ESTIMATE_ONLY:-0}" == 1 ]]; then exit 0; fi

IS_LOCAL=0
if [[ "$RPC_URL" == http://127.0.0.1:* || "$RPC_URL" == http://localhost:* ]]; then IS_LOCAL=1; fi
if [[ "$IS_LOCAL" != 1 ]]; then
  [[ -f "$LOGDIR/fork-rehearsal.json" ]] || { echo "Run fork rehearsal first (docs/EVM.md): scripts/evm-fork-rehearse.sh $CHAIN_ID"; exit 1; }
  python3 - "$LOGDIR/fork-rehearsal.json" "$CHAIN_ID" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r.get("success") is True, "Fork rehearsal must succeed"
assert int(r.get("chainId",-1))==int(sys.argv[2]), "Fork rehearsal chainId mismatch"
PY
fi

python3 - "$ADDR" "$EVM_START_BALANCE_WEI" "$CHAIN_ID" "$START_FILE" <<'PY'
import json,sys
json.dump({"chainId":int(sys.argv[3]),"deployer":sys.argv[1],"startBalanceWei":sys.argv[2]}, open(sys.argv[4],"w"), indent=2)
print()
PY

EXISTING_BOOK="$(python3 - "$CHAIN_ID" <<'PY'
import json, pathlib, sys
p=pathlib.Path(f"deployments/{sys.argv[1]}.contracts.json")
print(json.loads(p.read_text())["contracts"]["book"] if p.exists() else "0x0000000000000000000000000000000000000000")
PY
)"
if [[ "$(cast code "$EXISTING_BOOK" --rpc-url "$RPC_URL" --rpc-timeout 30)" != 0x ]]; then
  echo "Resuming existing deployment $EXISTING_BOOK"
else
  CHAIN_ID="$CHAIN_ID" forge script script/DeployEvm.s.sol:DeployEvm --rpc-url "$RPC_URL" --sender "$ADDR" \
    --keystore "$KEYSTORE" --password-file "$PASSFILE" --with-gas-price "$MAX_FEE" --broadcast --slow \
    > "$LOGDIR/live-deploy.log" 2>&1
fi
MANIFEST_RPC="$RPC_URL" node scripts/evm-manifest.mjs "$CHAIN_ID"
(
  export BOT_PRIVATE_KEY="$(cast wallet private-key --keystore "$KEYSTORE" --password-file "$PASSFILE")"
  export DEPLOYMENT="$ROOT/deployments/$CHAIN_ID.json"
  export CHAIN_ID
  export EVM_START_BALANCE_WEI
  export EVM_BUDGET_WEI
  export BASE_START_BALANCE_WEI="$EVM_START_BALANCE_WEI"
  export BASE_BUDGET_WEI="$EVM_BUDGET_WEI"
  pnpm --dir bots exec tsx src/evm-seed.ts
  EVM_KEEPER_CREATE=0 EVM_KEEPER_RESOLVE=0 EVM_REFRESH_LIMIT=200 pnpm --dir bots exec tsx src/evm-keeper.ts --once
)
CHAIN_ID="$CHAIN_ID" DEPLOYMENT="$ROOT/deployments/$CHAIN_ID.json" node scripts/evm-verify.mjs "$CHAIN_ID"
END="$(cast balance "$ADDR" --rpc-url "$RPC_URL" --rpc-timeout 30)"
python3 - "$EVM_START_BALANCE_WEI" "$END" "$BUDGET_WEI" "$CHAIN_ID" "$EXPLORER" "$ADDR" <<'PY'
import sys
start,end,budget=map(int,sys.argv[1:4])
spent=start-end
print(f"ETH spent: {spent/1e18:.12f}")
assert spent<=budget, "Budget exceeded"
print(f"Manifest: deployments/{sys.argv[4]}.json")
print(f"Explorer: {sys.argv[5]}")
print(f"Deployer: {sys.argv[6]}")
print(f"Keeper command: see docs/EVM.md (not started)")
PY
