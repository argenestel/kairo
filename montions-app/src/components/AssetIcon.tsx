/** Small original glyphs for the listed assets (flat colours, no gradients — safe to render many times). */
export function AssetIcon({ symbol, size = 22 }: { symbol: string; size?: number }) {
  const s = symbol.toUpperCase();
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const, className: 'asset-icon' };
  switch (s) {
    case 'SOL':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#14121f" />
          <path d="M7.4 7.6h10.4l-1.6 1.7H5.8z" fill="#19fb9b" />
          <path d="M5.8 11.2h10.4l1.6 1.7H7.4z" fill="#8f6bff" />
          <path d="M7.4 14.8h10.4l-1.6 1.7H5.8z" fill="#b16cff" />
        </svg>
      );
    case 'BTC':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#f7931a" />
          <path d="M9.3 6.5v11M11.3 6v1.4M11.3 16.6V18M8.3 7.4h4.6a2.2 2.2 0 0 1 0 4.4H9.3M9.3 11.8h4.3a2.4 2.4 0 0 1 0 4.8H8.3" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'ETH':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#2a2f45" />
          <path d="M12 4.2 7.4 12 12 14.7 16.6 12z" fill="#c9d3ff" />
          <path d="M12 4.2V14.7L16.6 12z" fill="#8fa0ef" />
          <path d="M7.4 13 12 19.8 16.6 13 12 15.7z" fill="#c9d3ff" />
        </svg>
      );
    case 'BNB':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#1d1a0f" />
          <g fill="#f3ba2f">
            <path d="m12 5.4 2.2 2.2-2.2 2.2-2.2-2.2zM12 14.2l2.2 2.2-2.2 2.2-2.2-2.2zM7.6 9.8l2.2 2.2-2.2 2.2L5.4 12zM16.4 9.8l2.2 2.2-2.2 2.2-2.2-2.2z" />
            <path d="m12 10.2 1.8 1.8-1.8 1.8-1.8-1.8z" />
          </g>
        </svg>
      );
    case 'XRP':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#23292f" />
          <path d="M6.4 6.6 9.9 10a3 3 0 0 0 4.2 0l3.5-3.4M6.4 17.4 9.9 14a3 3 0 0 1 4.2 0l3.5 3.4" fill="none" stroke="#e8edf2" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'DOGE':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#c2a633" />
          <path d="M9.2 7h3a5 5 0 0 1 0 10h-3zM7.6 12h5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#2b3346" />
          <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill="#dfe6f3" fontFamily="Geist, system-ui">{s.slice(0, 1)}</text>
        </svg>
      );
  }
}
