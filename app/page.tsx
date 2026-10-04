import { CovaLogo } from '@/components/cova-logo';
import { CovaPlayground } from '@/components/cova-playground';
import { SessionCheckout } from '@/components/session-checkout';

export default function Home() {
  return <>
    <a className="skip-link" href="#playground">Skip to playground</a>
    <header className="site-header">
      <div className="shell site-header-inner">
        <CovaLogo />
        <nav aria-label="Main navigation">
          <a href="#how-it-works" className="nav-text">How it works</a>
          <a href="#playground" className="button button-small button-outline">Open playground</a>
        </nav>
      </div>
    </header>
    <main>
      <section className="hero" aria-labelledby="hero-heading">
        <div className="shell hero-grid">
          <div className="hero-copy reveal">
            <h1 id="hero-heading">Reserve now.<br />Settle later.</h1>
            <p className="hero-lede">The customer sets aside a maximum in USDG. The merchant charges what the service actually cost, and the rest goes back to the customer.</p>
            <div className="hero-actions">
              <a className="button button-primary hero-cta" href="#playground">Try Cova</a>
              <a className="button button-ghost" href="#how-it-works">How it works</a>
            </div>
          </div>
          <div className="hero-visual reveal delay-1" aria-label="Example: reserve 20 USDG, capture 14 USDG, release 6 USDG">
            <div className="visual-heading">
              <span className="visual-kicker">Court booking</span>
              <span className="token-symbol">USDG</span>
            </div>
            <div className="authorization-ticket">
              <span className="ticket-label"><i className="swatch swatch-reserved" aria-hidden="true" />Reserved</span>
              <span className="ticket-amount">20<span> USDG</span></span>
            </div>
            <div className="flow-connector" aria-hidden="true">
              <span />
              <div>After the session</div>
              <span />
            </div>
            <div className="settlement-branches">
              <div className="settlement-destination captured">
                <span className="destination-label"><i className="swatch swatch-captured" aria-hidden="true" />Paid to merchant</span>
                <strong>14<span> USDG</span></strong>
              </div>
              <div className="settlement-destination released">
                <span className="destination-label"><i className="swatch swatch-released" aria-hidden="true" />Back to customer</span>
                <strong>6<span> USDG</span></strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rules" id="how-it-works" aria-labelledby="rules-heading">
        <div className="shell rules-inner">
          <h2 id="rules-heading">Who can move the money</h2>
          <dl className="rules-list">
            <div>
              <dt>Customer</dt>
              <dd>Deposits USDG and reserves a maximum for one merchant, with an expiry. Reserved funds can&apos;t be withdrawn until the hold settles.</dd>
            </div>
            <div>
              <dt>Merchant</dt>
              <dd>Captures up to the remaining maximum before expiry, in one charge or several. Releasing closes the hold and returns what&apos;s left.</dd>
            </div>
            <div>
              <dt>After expiry</dt>
              <dd>Captures stop. Anyone can release the remainder back to the customer, so funds never stay locked.</dd>
            </div>
          </dl>
        </div>
      </section>

      <SessionCheckout />
      <CovaPlayground />

      <section className="primitive-section" aria-labelledby="primitive-heading">
        <div className="shell primitive-grid">
          <div>
            <h2 id="primitive-heading">One vault for bookings, rentals, and metered usage.</h2>
            <p className="primitive-note">CovaVault on Arbitrum Sepolia. Four calls cover the whole lifecycle.</p>
          </div>
          <div className="primitive-code" aria-label="CovaVault functions">
            <code>
              <span>createHold</span>(merchant, amount, expiresAt, referenceId)<br />
              <span>capture</span>(holdId, amount)<br />
              <span>release</span>(holdId)<br />
              <span>releaseExpired</span>(holdId)
            </code>
          </div>
        </div>
      </section>
    </main>
    <footer className="site-footer">
      <div className="shell site-footer-inner">
        <CovaLogo />
        <span>Arbitrum Sepolia MVP</span>
      </div>
    </footer>
  </>;
}
