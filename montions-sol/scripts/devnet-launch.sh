#!/usr/bin/env bash
# Operator-only entry point. Never invoked by the local proof.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
rpc=https://api.devnet.solana.com
keypair=${MONTIONS_KEYPAIR:-$HOME/.config/solana/id.json}
while (($#)); do
  case "$1" in
    --rpc) rpc=$2; shift 2 ;;
    --keypair) keypair=$2; shift 2 ;;
    *) echo "Usage: $0 [--rpc DEVNET_URL] [--keypair PATH]" >&2; exit 2 ;;
  esac
done
cd "$root"
program=MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh
solana cluster-version --url "$rpc" >/dev/null
# Guard custom RPCs against accidental mainnet transactions.
genesis=$(solana genesis-hash --url "$rpc")
if [[ "$genesis" != EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG ]]; then
  echo "Refusing non-devnet genesis: $genesis" >&2; exit 1
fi
anchor build
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
if solana program show "$program" --url "$rpc" --output json >"$work/program.json" 2>"$work/show.err"; then
  solana program dump "$program" "$work/deployed.so" --url "$rpc"
  if python3 - "$root/target/deploy/montions.so" "$work/deployed.so" <<'PY'
import sys
from pathlib import Path
local, deployed = (Path(p).read_bytes() for p in sys.argv[1:])
sys.exit(0 if deployed[:len(local)] == local and not any(deployed[len(local):]) else 1)
PY
  then
    echo 'Deployed bytes match; skipping deploy.'
  else
    echo 'Program differs; deploying built bytes to devnet.'
    anchor deploy --provider.cluster "$rpc" --provider.wallet "$keypair"
  fi
else
  if ! rg -qi 'not found|does not exist|unable to find' "$work/show.err"; then
    cat "$work/show.err" >&2; exit 1
  fi
  echo 'Program missing; deploying to devnet.'
  anchor deploy --provider.cluster "$rpc" --provider.wallet "$keypair"
fi
"$root/sdk/node_modules/.bin/tsx" scripts/init-devnet.ts --cluster devnet --rpc "$rpc" --keypair "$keypair" --yes
"$root/sdk/node_modules/.bin/tsx" scripts/seed-markets.ts --cluster devnet --rpc "$rpc" --keypair "$keypair" --yes
printf '\nStart keeper from %s:\n' "$root"
printf 'pnpm -C sdk keeper --cluster devnet --rpc %q --keypair %q\n' "$rpc" "$keypair"
