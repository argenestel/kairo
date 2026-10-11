/** Turn wallet/RPC/contract errors into one short human sentence. */
export function humanError(e: unknown): string {
  const anyE = e as { shortMessage?: string; message?: string; code?: number | string; name?: string } | null;
  const raw = (anyE?.shortMessage || anyE?.message || (typeof e === 'string' ? e : '') || 'Something went wrong').toString();
  const msg = raw.replace(/\s+/g, ' ').trim();
  if (anyE?.code === 4001 || /user rejected|rejected the request|user denied|denied transaction|request rejected|cancell?ed|declined/i.test(msg))
    return 'You cancelled the request in your wallet.';
  if (/no (compatible )?wallet|wallet not found|not installed|no provider/i.test(msg)) return 'No compatible wallet was found in this browser.';
  if (/not connected|connect a wallet|wallet is not connected/i.test(msg)) return 'Connect a wallet first.';
  if (/chain mismatch|wrong network|switch.*(network|chain)|unsupported chain|unrecognized chain|incorrect chain|not on the (expected|correct)/i.test(msg))
    return 'Your wallet is on the wrong network. Switch to this venue and retry.';
  if (/insufficient lamports|insufficient funds for (gas|fee|rent)|exceeds the balance|gas required exceeds/i.test(msg))
    return 'Not enough gas in your wallet. Use “Get test funds” and try again.';
  if (/insufficient/i.test(msg)) return msg.length > 140 ? 'Not enough balance for this trade. Use “Get test funds” and try again.' : msg;
  if (/blockhash|block height exceeded|timed? ?out|timeout|took too long/i.test(msg)) return 'The network took too long to confirm. Please try again.';
  if (/failed to fetch|networkerror|network request failed|econn|429|too many requests/i.test(msg)) return 'Could not reach the network right now. Check your connection and retry.';
  if (/slippage|price moved|limit|minfillnotmet|min fill/i.test(msg)) return 'The price moved past your limit. Refresh the quote and try again.';
  if (/expired|market ?not ?open|closed/i.test(msg)) return 'This market is closed for trading.';
  return msg.length > 180 ? `${msg.slice(0, 177)}…` : msg;
}
