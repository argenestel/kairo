import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QR({ text, size = 104, label }: { text: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { errorCorrectionLevel: 'H', margin: 0, width: size * 3, color: { dark: '#0b0e14', light: '#ffffff' } })
      .then((u) => { if (live) setSrc(u); })
      .catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [text, size]);
  return (
    <div className="qr" style={{ width: size + 16, height: size + 16 }} role="img" aria-label={label}>
      {src ? <img src={src} width={size} height={size} alt="" key={src} className="qr__img" /> : <div className="qr__ph" style={{ width: size, height: size }} />}
      <span className="qr__logo" aria-hidden>
        <svg viewBox="0 0 512 512" width="20" height="20">
          <path d="M108 322 184 205 256 279 328 158 402 224" fill="none" stroke="#0b0e14" strokeWidth="56" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}
