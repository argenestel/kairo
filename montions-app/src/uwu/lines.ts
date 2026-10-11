import type { MascotMood, MascotPose, MascotWho } from '../mascot';
import type { ChainKey } from '../chains';
import type { TicketPhase } from '../state/flow';

export const CHAIN_TAN: Record<ChainKey, MascotWho> = {
  base: 'base', arbitrum: 'arbi', hyperliquid: 'hyper', solana: 'sol', mock: 'mon',
};

export interface Beat { who: MascotWho; mood: MascotMood; pose: MascotPose; lines: string[] }

/** What the host says and how she looks, per step / ticket phase. Pure data — UwuLayer just renders it. */
export function beatFor(step: number, direction: 'above' | 'below', phase: TicketPhase, chain: ChainKey, tanName: string): Beat {
  const tan = CHAIN_TAN[chain] ?? 'mon';
  switch (step) {
    case 0: return { who: 'mon', mood: 'happy', pose: 'idle', lines: [
      'Hi hi~ I’m Kai-chan! Pick something you have feelings about ✨',
      'Scroll the wheel~ every price is live from the oracle (・ω・)',
      'Crypto, stocks… what are we betting on today? ♡',
    ] };
    case 1: return direction === 'above'
      ? { who: 'mon', mood: 'excited', pose: 'point', lines: ['Number go up?! I believe in you (ง •̀_•́)ง', 'YES pays $1 if it ends above your level~ ✧'] }
      : { who: 'mon', mood: 'wink', pose: 'point', lines: ['Ooh, a little bearish today? (^_−)☆', 'NO pays $1 if it ends below your level~'] };
    case 2: return { who: 'mon', mood: 'neutral', pose: 'point', lines: [
      'Further from the price = cheaper ticket, bigger payout… but less likely~',
      'The price per contract IS the chance the market gives it (・・?)',
    ] };
    case 3: return { who: 'mon', mood: 'neutral', pose: 'idle', lines: [
      'More time = more chances for it to happen~ ⏳',
      'Settles on the first oracle print at expiry — nobody picks the moment ✨',
    ] };
    case 4: return { who: 'mon', mood: 'excited', pose: 'cheer', lines: [
      'Max loss is exactly what you put in. No liquidations, ever ♡',
      'Drag the price on the chart to see what you’d get back~',
    ] };
    default:
      if (phase === 'signing') return { who: tan, mood: 'sleepy', pose: 'hold-ticket', lines: ['Waiting for your wallet… (´-ω-`)'] };
      if (phase === 'placed') return { who: tan, mood: 'excited', pose: 'cheer', lines: [`It’s on-chain!! ${tanName} has your ticket (๑˃ᴗ˂)ﻭ`, 'Good luck~ check My tickets anytime ♡'] };
      if (phase === 'error') return { who: tan, mood: 'worried', pose: 'idle', lines: ['Uh-oh… (；へ：) that didn’t go through — try again?'] };
      return { who: tan, mood: 'happy', pose: 'hold-ticket', lines: [`${tanName} will hold your ticket~ sign when you’re ready ✨`] };
  }
}
