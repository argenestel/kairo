#!/usr/bin/env bash
# Balance and cumulative launch-budget preflight for explicitly authorized Sepolia batches.
set -euo pipefail
cd "$(dirname "$0")/.."
CID="${1:?chain}"; CONTRACT="${2:?contract}"; GAS_CEILING="${3:?gas ceiling}"; shift 3
case "$CID" in 84532) RPC=https://sepolia.base.org; LIMIT=35000000000000000;; 421614) RPC=https://arbitrum-sepolia-rpc.publicnode.com; LIMIT=30000000000000000;; *) exit 1;; esac
ADDR=0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39
BAL=$(cast balance "$ADDR" --rpc-url "$RPC")
PRICE=$(cast gas-price --rpc-url "$RPC")
python3 - "$CID" "$BAL" "$PRICE" "$GAS_CEILING" "$LIMIT" <<'PY'
import json,sys
cid,bal,price,gas,limit=map(int,sys.argv[1:]);start=int(json.load(open('deployments/ship2-start-balances.json'))[str(cid)])
cost=gas*max(price*3,20000000)+1000000000000000
print(f'chain={cid} balance={bal/1e18:.12f} ETH batch ceiling={cost/1e18:.9f} ETH spent={(start-bal)/1e18:.9f} ETH budget={limit/1e18:.3f} ETH reserve=0.010 ETH')
assert bal-cost>=10000000000000000, 'batch would breach reserve'
assert start-bal+cost<=limit,'batch would exceed launch budget'
PY
export CHAIN_ID="$CID" LIVE_MIN_RESERVE_WEI=10000000000000000
forge script "script/$CONTRACT.s.sol:$CONTRACT" --rpc-url "$RPC" --sender "$ADDR" \
 --keystore ../montions/.dev/keystore/montions-testnet --password-file ../montions/.dev/testnet.pass \
 --broadcast --slow --skip-simulation --gas-estimate-multiplier 180 "$@"
