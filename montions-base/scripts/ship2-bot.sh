#!/usr/bin/env bash
# Secret-safe bot launcher. The signer is inherited only by the bot process.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export CHAIN_ID="${1:?chain id}"; shift
BOT="${1:?bot name}"; shift
case "$CHAIN_ID" in
  84532) export RPC_URL=https://sepolia.base.org;;
  421614) export RPC_URL=https://arbitrum-sepolia-rpc.publicnode.com;;
  *) echo 'Only Base and Arbitrum Sepolia are enabled' >&2; exit 1;;
esac
case "$BOT" in evm-keeper|stock-feeder|stock-seed|evm-seed|event-maker|event-resolver|ship-initial-quotes|ship-copy-crypto) ;; *) echo 'Unknown bot' >&2; exit 1;; esac
export DEPLOYMENT="$ROOT/deployments/$CHAIN_ID.json"
export MIN_RESERVE_WEI="${MIN_RESERVE_WEI:-10000000000000000}"
export STOCK_FEEDER_GAS_STATE="$ROOT/deployments/logs/$CHAIN_ID/stock-feeder-gas.json"
export EVENT_MAKER_STATE="$ROOT/deployments/logs/$CHAIN_ID/event-maker-state.json"
export EVENT_MAKER_MAX_GLOBAL="${EVENT_MAKER_MAX_GLOBAL:-4000}"
export EVM_MAX_ETH_PER_DAY="${EVM_MAX_ETH_PER_DAY:-0.01}"
export BOT_PRIVATE_KEY="$(cast wallet private-key --keystore "$ROOT/../montions/.dev/keystore/montions-testnet" --password-file "$ROOT/../montions/.dev/testnet.pass")"
case "$BOT" in ship-*) exec pnpm --dir bots exec tsx "src/$BOT.ts" "$@";; *) exec pnpm --dir bots "$BOT" "$@";; esac
