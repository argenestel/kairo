/**
 * User-facing copy, keyed by visual mode. Components call useCopy() and never branch on mode
 * themselves — adding uwu (or any third pack) is filling in `packs.uwu`, not touching JSX.
 */
import { useMode, type ModeId } from './state/mode';

export interface Copy {
  brand: string;
  tagline: string;
  steps: {
    asset: { title: string; sub: string };
    direction: { title: string; subPrice: (name: string, price: string) => string; subAsk: (name: string) => string };
    strike: { title: (name: string) => string; sub: (symbol: string, dir: string) => string };
    expiry: { title: string; sub: (name: string, dir: string, strike: string) => string };
    amount: { title: string; sub: string };
  };
  cta: { continue: string; print: string };
  footer: { testnet: string; product: string };
  chain: { live: string; coming: string; demo: string; network: string; soon: string };
  wallet: { connect: string; tickets: string };
  nav: { prices: string; predictions: string; markets: string };
  book: {
    view: string; hide: string; yes: string; noHint: string; mid: string; spread: string;
    last: string; maker: string; trades: string; empty: string; retry: string; buy: string; sell: string;
  };
  markets: {
    title: string; sub: string; compare: string; none: string; volume: string;
    bid: string; ask: string; key: string; best: string; closed: string;
  };
  predictions: {
    title: string; sub: string; search: string; all: string; coming: string; demo: string;
    rules: string; source: string; closes: string; yes: string; no: string; print: string;
    empty: string;
  };
  notfound: { title: string; sub: string; home: string };
  offline: string;
  rpcRetry: string;
}

export const serious: Copy = {
  brand: 'Kairo',
  tagline: 'say it, print it, place it',
  steps: {
    asset: { title: 'What do you want to trade?', sub: 'Pick an asset. Prices update live.' },
    direction: {
      title: 'What’s your prediction?',
      subPrice: (name, price) => `${name} is currently at ${price}`,
      subAsk: (name) => `Will ${name} go up or down?`,
    },
    strike: {
      title: (name) => `Where will ${name} be?`,
      sub: (symbol, dir) => `Pick the price level you think ${symbol} will ${dir === 'above' ? 'rise above' : 'stay below'}.`,
    },
    expiry: {
      title: 'How soon do you think this happens?',
      sub: (name, dir, strike) => `${name} ${dir} ${strike}`,
    },
    amount: {
      title: 'How much do you want to put in?',
      sub: 'You can never lose more than you put in.',
    },
  },
  cta: { continue: 'Continue', print: 'Print my ticket' },
  footer: { testnet: 'Testnet — play money', product: 'Kairo · outcome-first options & predictions' },
  chain: { live: 'Live', coming: 'Coming online', demo: 'Demo', network: 'Network', soon: 'Soon' },
  wallet: { connect: 'Connect', tickets: 'My tickets' },
  nav: { prices: 'Prices', predictions: 'Predictions', markets: 'Markets' },
  book: {
    view: 'View order book', hide: 'Hide order book', yes: 'YES book', noHint: 'NO price = 1 − YES',
    mid: 'Mid', spread: 'Spread', last: 'Last', maker: 'maker', trades: 'Recent trades',
    empty: 'No resting quotes yet.', retry: 'Retry', buy: 'buy', sell: 'sell',
  },
  markets: {
    title: 'Every market, every chain',
    sub: 'The same (asset, strike, expiry) is the same economic event. Compare venues and open the book.',
    compare: 'Same event, side by side',
    none: 'No live markets on this filter yet.',
    volume: 'Volume', bid: 'Bid', ask: 'Ask', key: 'Canonical key', best: 'Best venue', closed: 'Market closed',
  },
  predictions: {
    title: 'What happens next?',
    sub: 'Yes/no questions about the real world. Same $1 contracts, same book.',
    search: 'Search questions',
    all: 'All',
    coming: 'Predictions are coming online',
    demo: 'Demo',
    rules: 'Resolution rules',
    source: 'Resolution source',
    closes: 'Closes',
    yes: 'YES', no: 'NO', print: 'Print my ticket',
    empty: 'No questions match that search.',
  },
  notfound: {
    title: 'This page isn’t on the tape',
    sub: 'The URL doesn’t match a market, a prediction, or the ticket printer.',
    home: 'Back to Kairo',
  },
  offline: 'You’re offline. Quotes will resume when you’re back.',
  rpcRetry: 'Retry',
};

/** UwU pack: every string has a kawaii variant. Numbers stay exact — only the voice changes. */
export const uwu: Copy = {
  brand: 'Kairo',
  tagline: 'say it, print it, place it~ ✿',
  steps: {
    asset: { title: 'What do you wanna trade? (｡•̀ᴗ-)✧', sub: 'Pick a coin-chan~ prices update live ✨' },
    direction: {
      title: 'What’s your prediction, senpai?',
      subPrice: (name, price) => `${name}-chan is at ${price} right now (・ω・)`,
      subAsk: (name) => `Will ${name}-chan go up or down? ✧`,
    },
    strike: {
      title: (name) => `Where will ${name}-chan be? (・・?)`,
      sub: (symbol, dir) => `Pick the level you think ${symbol} will ${dir === 'above' ? 'float above~ ☁️' : 'stay under~ 🌙'}`,
    },
    expiry: {
      title: 'How soon will it happen? ⏳',
      sub: (name, dir, strike) => `${name}-chan ${dir} ${strike} ♡`,
    },
    amount: {
      title: 'How much do you wanna put in? (๑˃ᴗ˂)ﻭ',
      sub: 'You can never lose more than you put in, promise~ 🤞',
    },
  },
  cta: { continue: 'Next~ ✨', print: 'Print my ticket! 🎀' },
  footer: { testnet: 'Testnet — play money only~', product: 'Kairo · tiny tickets, big feelings' },
  chain: { live: 'Live ✨', coming: 'Waking up… (´-ω-`)', demo: 'Pretend mode', network: 'Network', soon: 'Soon~' },
  wallet: { connect: 'Connect ♡', tickets: 'My tickets 🎟️' },
  nav: { prices: 'Prices', predictions: 'Predictions', markets: 'Markets' },
  book: {
    view: 'Peek at the book ♡', hide: 'Hide the book', yes: 'YES book', noHint: 'NO price = 1 − YES, promise',
    mid: 'Mid', spread: 'Spread', last: 'Last', maker: 'maker-chan', trades: 'Recent trades',
    empty: 'No quotes yet… (´・ω・`)', retry: 'Try again~', buy: 'buy', sell: 'sell',
  },
  markets: {
    title: 'Every market, every chain~',
    sub: 'Same event, many venues. Compare them and peek at the books!',
    compare: 'Same event, side by side ♡',
    none: 'Nothing on this filter yet…',
    volume: 'Volume', bid: 'Bid', ask: 'Ask', key: 'Canonical key', best: 'Best venue ✨', closed: 'Market closed',
  },
  predictions: {
    title: 'What happens next? (・・?)',
    sub: 'Yes/no questions about the real world. Tiny tickets, big feelings.',
    search: 'Search questions~',
    all: 'All',
    coming: 'Predictions are waking up…',
    demo: 'Demo',
    rules: 'Resolution rules',
    source: 'Resolution source',
    closes: 'Closes',
    yes: 'YES', no: 'NO', print: 'Print my ticket! 🎀',
    empty: 'No questions match that… maybe another word?',
  },
  notfound: {
    title: 'This page wandered off (；´д｀)',
    sub: 'That URL isn’t a market, a prediction, or a ticket.',
    home: 'Take me home~',
  },
  offline: 'You’re offline… quotes will come back when you do. (´-ω-`)',
  rpcRetry: 'Retry ♡',
};

export const packs: Record<ModeId, Copy> = { serious, uwu };

export function getCopy(mode: ModeId): Copy {
  return packs[mode] ?? serious;
}

export function useCopy(): Copy {
  const { mode } = useMode();
  return getCopy(mode);
}
