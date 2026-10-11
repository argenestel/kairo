/** Program error decoding (Anchor custom errors 6000+, from the IDL). */
import { IDL } from './idl/index.js';

export interface MontionsErrorInfo {
  code: number;
  name: string;
  msg: string;
}

const ERRORS: MontionsErrorInfo[] = (
  IDL as unknown as { errors: { code: number; name: string; msg?: string }[] }
).errors.map((e) => ({ code: e.code, name: e.name, msg: e.msg ?? e.name }));

const BY_CODE = new Map(ERRORS.map((e) => [e.code, e]));
const BY_NAME = new Map(ERRORS.map((e) => [e.name, e]));

export function montionsErrorByCode(code: number): MontionsErrorInfo | undefined {
  return BY_CODE.get(code);
}

export function montionsErrorByName(name: string): MontionsErrorInfo | undefined {
  return BY_NAME.get(name);
}

function collectText(e: unknown, depth = 0): string {
  if (e == null || depth > 3) return '';
  if (typeof e === 'string') return e;
  if (typeof e !== 'object') return String(e);
  const o = e as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.message === 'string') parts.push(o.message);
  if (Array.isArray(o.logs)) parts.push((o.logs as unknown[]).join('\n'));
  if (Array.isArray(o.transactionLogs)) parts.push((o.transactionLogs as unknown[]).join('\n'));
  if (o.err !== undefined) parts.push(JSON.stringify(o.err));
  if (o.cause !== undefined) parts.push(collectText(o.cause, depth + 1));
  if (o.error !== undefined) parts.push(collectText(o.error, depth + 1));
  if (!parts.length) {
    try {
      parts.push(JSON.stringify(o));
    } catch {
      /* ignore */
    }
  }
  return parts.join('\n');
}

/** Extract a Montions program error from an exception / simulation result / log array, if present. */
export function parseMontionsError(e: unknown): MontionsErrorInfo | null {
  const text = Array.isArray(e) ? e.join('\n') : collectText(e);
  let m = /Error Number: (\d+)/.exec(text);
  if (m) return BY_CODE.get(Number(m[1])) ?? null;
  m = /"Custom":\s*(\d+)/.exec(text);
  if (m) return BY_CODE.get(Number(m[1])) ?? null;
  m = /custom program error: 0x([0-9a-fA-F]+)/.exec(text);
  if (m) return BY_CODE.get(parseInt(m[1]!, 16)) ?? null;
  m = /Error Code: (\w+)/.exec(text);
  if (m) return BY_NAME.get(m[1]!) ?? null;
  return null;
}

/** Human message for any error thrown while sending a Montions transaction. */
export function friendlyError(e: unknown): string {
  const info = parseMontionsError(e);
  if (info) return info.msg.charAt(0).toUpperCase() + info.msg.slice(1);
  const text = collectText(e);
  if (/Attempt to debit an account but found no record of a prior credit/i.test(text))
    return 'This wallet has no SOL for fees on this cluster';
  if (/insufficient lamports|insufficient funds for rent/i.test(text)) return 'Not enough SOL to pay rent / fees';
  if (/insufficient funds/i.test(text)) return 'Insufficient token balance';
  if (/Blockhash not found|block height exceeded/i.test(text)) return 'Transaction expired before it landed — please retry';
  if (/User rejected|rejected the request/i.test(text)) return 'Request rejected in the wallet';
  if (/Program .* is not deployed|program that does not exist|ProgramAccountNotFound/i.test(text))
    return 'The Montions program is not deployed on this cluster yet';
  if (/AccountNotInitialized|account does not exist|AccountNotFound/i.test(text))
    return 'A required account does not exist yet (protocol not initialised on this cluster?)';
  const first = text.split('\n').find((l) => l.trim().length > 0);
  return first ? first.slice(0, 240) : 'Transaction failed';
}
