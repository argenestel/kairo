import { useState } from 'react';
import { useChain } from '../state/chain';
import { useCopy } from '../copy';
import { Link } from '../state/route';
import '../styles/footer.css';

/** Shared viewport footer; the shell reserves --footer-height for it. */
export function Footer() {
  const chain = useChain(); const copy = useCopy(); const [expanded, setExpanded] = useState(false);
  const note = chain.adapter?.meta.settlementNote ?? 'Loading settlement information…';
  return <footer className="kairo-footer">
    <span className="kairo-footer__badge">Testnet · play money</span>
    <span className="kairo-footer__product">{copy.footer.product}</span>
    <button className="kairo-footer__note" title={note} aria-expanded={expanded} aria-controls="footer-settlement" onClick={()=>setExpanded(v=>!v)}><span>{note}</span><b aria-label="Settlement information">ⓘ</b></button>
    <nav aria-label="Footer links"><Link to="/paper">Paper</Link><Link to="/docs">Docs</Link><a href="https://github.com/argenestel/kairo" target="_blank" rel="noreferrer">GitHub ↗</a></nav>
    {expanded&&<div id="footer-settlement" className="kairo-footer__expanded"><strong>Settlement · {chain.entry.label}</strong><p>{note}</p><button onClick={()=>setExpanded(false)} aria-label="Close settlement information">×</button></div>}
  </footer>;
}
