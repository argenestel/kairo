import { useId, type SVGProps } from 'react';
import type { ChainKey } from '../chains';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
});

export const ArrowUp = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
export const ArrowDown = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 5v14M19 12l-7 7-7-7" /></svg>;
export const ArrowLeft = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
export const ArrowRight = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M5 12h14M12 5l7 7-7 7" /></svg>;
export const Enter = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M20 5v6a3 3 0 0 1-3 3H6" /><path d="M10 10l-4 4 4 4" /></svg>;
export const Close = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const Check = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M20 6 9 17l-5-5" /></svg>;
export const Copy = ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
export const External = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
export const Share = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>;
export const Edit = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>;
export const Plus = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const Wallet = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z" /><circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" /></svg>;
export const Ticket = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z" /><path d="M10 6v12" strokeDasharray="2 2.5" /></svg>;
export const Drop = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" /></svg>;
export const Info = ({ size, ...p }: P) => <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
export const Spinner = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="spin" aria-hidden>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
export const XLogo = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />
  </svg>
);
export const Calendar = ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
export const ChevronDown = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M6 9l6 6 6-6" /></svg>;
export const Search = ({ size, ...p }: P) => <svg {...base(size)} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
export const BookOpen = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 1 2 2z" /></svg>;

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo">
      <img src="/kairo-mark.svg" width="28" height="28" alt="" className="logo__mark" />
      {!compact && <span className="logo__word">Kairo</span>}
    </span>
  );
}

export function ChainGlyph({ chain, size = 16 }: { chain: ChainKey; size?: number }) {
  const gid = `sol-${useId().replace(/:/g, '')}`;
  if (chain === 'solana') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#9945ff" />
            <stop offset="1" stopColor="#19fb9b" />
          </linearGradient>
        </defs>
        <g fill={`url(#${gid})`}>
          <path d="M6 6.2h14l-2 2.2H4z" />
          <path d="M4 10.9h14l2 2.2H6z" />
          <path d="M6 15.6h14l-2 2.2H4z" />
        </g>
      </svg>
    );
  }
  if (chain === 'base') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="#2f6bff" />
        <path d="M11.9 18.2a6.2 6.2 0 1 0-6.1-7.1h8.3v1.8H5.8a6.2 6.2 0 0 0 6.1 5.3Z" fill="#fff" />
      </svg>
    );
  }
  if (chain === 'arbitrum') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="#213147" />
        <path d="M12 5.2 17.6 18h-2.3l-1.1-2.6H9.8L8.7 18H6.4L12 5.2Zm0 4.2-1.7 4h3.4L12 9.4Z" fill="#28a0f0" />
      </svg>
    );
  }
  if (chain === 'hyperliquid') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="#07241f" />
        <path d="M12 4.8c2.6 3.2 5.4 6.4 5.4 9.2a5.4 5.4 0 1 1-10.8 0c0-2.8 2.8-6 5.4-9.2Z" fill="#50eed0" />
        <circle cx="12" cy="14.2" r="2.1" fill="#07241f" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="#ffd23f" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}
