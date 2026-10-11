#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=deployments/rehearsal/rotation
mkdir -p "$OUTDIR"
cast access-list 0xadd675E7Eb9bbC2E89dA795E2fe11F9cc9Ab7aFc 'totalAssets()(uint256)' --rpc-url https://sepolia.base.org --json > "$OUTDIR/access-list.json"
anvil --fork-url https://sepolia.base.org --port 8573 --accounts 0 --auto-impersonate > "$OUTDIR/anvil.log" 2>&1 &
REHEARSAL_PID=$!
trap 'kill "$REHEARSAL_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 30); do if cast chain-id --rpc-url http://127.0.0.1:8573 >/dev/null 2>&1; then break; fi; sleep 1; done
python3 scripts/fork-prewarm.py http://127.0.0.1:8573 https://sepolia.base.org "$OUTDIR/access-list.json"
cast rpc anvil_setBalance 0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39 0x8AC7230489E80000 --rpc-url http://127.0.0.1:8573 >/dev/null
cast balance 0x0000000000000000000000000000000000000000 --rpc-url http://127.0.0.1:8573 >/dev/null
FORK_REHEARSAL=1 DEPLOYMENT="$PWD/deployments/84532.json" OUT="$OUTDIR/vault.json" FOUNDRY_BROADCAST="$OUTDIR/broadcast" \
 forge script script/RotateVault.s.sol:RotateVault --rpc-url http://127.0.0.1:8573 --unlocked \
 --sender 0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39 --broadcast --skip-simulation --legacy \
 --with-gas-price 1000000000 --gas-estimate-multiplier 200 > "$OUTDIR/rotate.log" 2>&1
