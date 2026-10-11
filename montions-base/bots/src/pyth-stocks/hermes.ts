import type { Hex } from 'viem';
import { parseHermesUpdate } from '../pyth.js';

export interface Metadata { id: string; attributes: { symbol: string; schedule: string }; market_hours: { is_open: boolean; next_open: number | null; next_close: number | null } }
export interface Update { binary: { encoding: string; data: string[] }; parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[] }
export class HermesError extends Error { constructor(readonly status: number) { super(`Hermes HTTP ${status}`); } }
/** Serialized limiter: reserve half the 10 requests / 10 seconds / IP ceiling for the sibling keeper. */
export class Hermes {
  private tail: Promise<unknown> = Promise.resolve();
  private last = 0;
  constructor(private key: string | undefined, private fetcher: typeof fetch = fetch,
    private sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))) {}
  async request(path: string): Promise<unknown> {
    if (!this.key?.trim()) throw new Error('Set PYTH_HERMES_API_KEY in bots/.env');
    const task = this.tail.then(async () => {
      await this.sleep(Math.max(0, this.last + 2200 - Date.now()));
      this.last = Date.now();
      let response: Response;
      try { response = await this.fetcher(`https://hermes.pyth.network${path}`, {
        headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(15_000), redirect: 'error',
      }); } catch { throw new Error('Hermes transport failed'); }
      // Never propagate headers, bodies or underlying transport errors containing credentials.
      if (!response.ok) throw new HermesError(response.status);
      return response.json();
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
  async metadata(): Promise<Metadata[]> { return await this.request('/v2/price_feeds?query=Equity.US') as Metadata[]; }
  async updates(ids: readonly Hex[], timestamp?: number): Promise<Update> {
    const params = new URLSearchParams({ encoding: 'hex', parsed: 'true' });
    for (const id of ids) params.append('ids[]', id);
    return await this.request(`/v2/updates/price/${timestamp ?? 'latest'}?${params}`) as Update;
  }
}
export function validateUpdate(update: Update, ids: readonly Hex[], min: number, max: number): Hex[] {
  if (update?.binary?.encoding !== 'hex' || !Array.isArray(update.parsed)) throw new Error('Invalid Hermes response');
  for (const id of ids) {
    const prices = update.parsed.filter(p => p.id.replace(/^0x/, '').toLowerCase() === id.slice(2).toLowerCase());
    if (prices.length !== 1) throw new Error('Missing or duplicate feed');
    const price = prices[0]!.price;
    if (!Number.isSafeInteger(price.publish_time) || price.publish_time < min || price.publish_time > max) throw new Error('Price outside publish-time window');
    if (!Number.isInteger(price.expo) || price.expo < -18 || price.expo > 0 || BigInt(price.price) <= 0n || BigInt(price.conf) < 0n || BigInt(price.conf) * 100n > BigInt(price.price) * 2n) throw new Error('Invalid price or confidence');
  }
  return parseHermesUpdate(update);
}
