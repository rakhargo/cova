import { CovaLogo } from '@/components/cova-logo';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleDollarSign, LockKeyhole, ShieldCheck } from 'lucide-react';
import { CovaPlayground } from '@/components/cova-playground';

export default function Home() {
  return <>
    <a className="skip-link" href="#playground">Skip to playground</a>
    <header className="site-header shell">
      <CovaLogo />
      <nav aria-label="Main navigation"><a href="#how-it-works" className="nav-text">How it works</a><a href="#playground" className="button button-small button-outline">Open playground <ArrowUpRight size={15}/></a></nav>
    </header>
    <main>
      <section className="hero shell" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <div className="hero-intro"><span className="blue-dot"/> A payment guarantee. A flexible final charge.</div>
          <h1 id="hero-heading">Reserve now.<br/>Settle later.</h1>
          <p>Stablecoin payments shouldn’t always settle upfront. Reserve USDG, capture what’s owed, and return the rest.</p>
          <a className="button button-primary hero-cta" href="#playground">Try Cova <ArrowRight size={18}/></a>
          <div className="hero-footnote"><ShieldCheck size={15}/> Built for transparent, onchain settlement</div>
        </div>
        <div className="hero-visual" aria-label="Example: authorize 20 USDG, capture 14 USDG, and release 6 USDG">
          <div className="visual-heading"><span className="visual-kicker">One authorization. Two destinations.</span><span className="token-symbol">USDG</span></div>
          <div className="authorization-ticket">
            <div><span className="ticket-label">Customer authorizes</span><span className="ticket-amount">20<span> USDG</span></span></div>
            <div className="ticket-lock"><LockKeyhole size={22}/></div>
          </div>
          <div className="flow-connector"><span/><div><LockKeyhole size={12}/> Reserved until settlement</div><span/></div>
          <div className="settlement-branches">
            <div className="settlement-destination captured"><div className="destination-icon"><ArrowUpRight size={20}/></div><span className="destination-label">Merchant receives</span><strong>14<span> USDG</span></strong><span className="destination-state"><Check size={13}/> Captured</span></div>
            <div className="settlement-destination released"><div className="destination-icon"><ArrowDownLeft size={20}/></div><span className="destination-label">Customer gets back</span><strong>6<span> USDG</span></strong><span className="destination-state"><Check size={13}/> Released</span></div>
          </div>
          <div className="visual-caption"><span className="court-glyph" aria-hidden="true">▤</span><span>Court booking</span><span>Maximum 20. Final charge 14.</span></div>
        </div>
      </section>
      <section className="lifecycle shell" id="how-it-works" aria-label="How Cova works">
        <div className="lifecycle-step"><span className="step-symbol"><ShieldCheck size={20}/></span><div><h2>Authorize</h2><p>The customer sets the maximum.</p></div></div>
        <ChevronRight className="lifecycle-arrow" size={20}/>
        <div className="lifecycle-step"><span className="step-symbol amber"><LockKeyhole size={20}/></span><div><h2>Hold</h2><p>Funds stay reserved for the service.</p></div></div>
        <ChevronRight className="lifecycle-arrow" size={20}/>
        <div className="lifecycle-step"><span className="step-symbol green"><CircleDollarSign size={20}/></span><div><h2>Capture &amp; release</h2><p>Settle the bill. Return the remainder.</p></div></div>
      </section>
      <CovaPlayground />
      <section className="primitive-section shell" aria-labelledby="primitive-heading">
        <div><h2 id="primitive-heading">Different services.<br/>The same payment primitive.</h2><p>Bookings, rentals, and usage based services all need a maximum commitment with a flexible final amount.</p></div>
        <div className="primitive-code" aria-label="Cova lifecycle pseudocode"><span className="code-comment">{'// A maximum, then the actual bill.'}</span><code><span>createHold</span>(merchant, maximum, expiry);<br/><span>capture</span>(holdId, finalAmount);<br/><span>release</span>(holdId);</code><span className="code-footer"><LockKeyhole size={13}/> Captures never exceed the authorization.</span></div>
      </section>
    </main>
    <footer className="site-footer shell"><CovaLogo/><p>Stablecoin authorization holds.</p><span>Arbitrum Sepolia MVP</span></footer>
  </>;
}
