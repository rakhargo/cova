'use client';

import { useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, CheckCircle2, ChevronDown, Clock3, ExternalLink, LockKeyhole, ShieldCheck, Store } from 'lucide-react';
import { formatAmount, releasedAmount, remainingAmount, shortAddress } from '@/lib/format';
import type { CovaController, Hold, Mode } from '@/lib/types';
import type { Hash } from 'viem';
import { parseUiAmount } from './amount';

function expiryText(expiresAt: number, now: number) {
  if (!now) return 'Checking expiry…';
  const seconds = expiresAt - now;
  if (seconds <= 0) return 'Expired';
  if (seconds < 60) return `${seconds}s remaining`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min remaining`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m remaining`;
  return `${Math.ceil(seconds / 86400)} days remaining`;
}

function suggestedAmount(hold: Hold, decimals: number) {
  const remaining = remainingAmount(hold);
  const description = hold.description.toLowerCase();
  const remainingInput = formatAmount(remaining, decimals).replaceAll(',', '');
  const suggested = description.includes('court') ? '14' : description.includes('camera') ? '72' : description.includes('charging') || description.includes('ev ') ? '17.42' : remainingInput;
  const parsed = parseUiAmount(suggested, decimals);
  return parsed !== undefined && parsed <= remaining ? suggested : remainingInput;
}

export function HoldCard({ hold, cova, mode, now, canAct, execute }: { hold: Hold; cova: CovaController; mode: Mode; now: number; canAct: boolean; execute: (action: () => Promise<void>) => Promise<void> }) {
  const [captureAmount, setCaptureAmount] = useState(() => suggestedAmount(hold, cova.decimals));
  const remaining = remainingAmount(hold);
  const released = releasedAmount(hold);
  const active = hold.status === 1;
  const expired = !!now && now >= hold.expiresAt;
  const isCustomer = cova.demo || cova.address?.toLowerCase() === hold.customer.toLowerCase();
  const isMerchant = cova.demo || cova.address?.toLowerCase() === hold.merchant.toLowerCase();
  const parsedCapture = parseUiAmount(captureAmount, cova.decimals);
  const validCapture = parsedCapture !== undefined && parsedCapture > 0n && parsedCapture <= remaining;
  const money = (value: bigint) => formatAmount(value, cova.decimals);
  const progress = hold.authorizedAmount > 0n ? Number(hold.capturedAmount * 10000n / hold.authorizedAmount) / 100 : 0;
  const customerAvailable = hold.customerAvailable ?? (isCustomer && (cova.demo || cova.address?.toLowerCase() === hold.customer.toLowerCase()) ? cova.available : undefined);
  const receipts: { label: string; hash: Hash }[] = [
    ...(hold.createHash ? [{ label: 'Authorization', hash: hold.createHash }] : []),
    ...(hold.captureHashes || []).map((hash, index) => ({ label: `Capture${(hold.captureHashes?.length || 0) > 1 ? ` ${index + 1}` : ''}`, hash })),
    ...(hold.releaseHash ? [{ label: 'Release', hash: hold.releaseHash }] : []),
  ];
  const links = receipts.map(receipt => ({ ...receipt, url: cova.explorerTx(receipt.hash) })).filter(receipt => receipt.url);

  function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canAct && isMerchant && validCapture && !expired && active) void execute(() => cova.capture(hold.id, captureAmount));
  }

  return <article className={`hold-card ${active ? 'active-hold' : 'settled-hold'}`} aria-labelledby={`hold-${hold.id}`}>
    <div className="hold-card-heading"><div className="hold-title"><span className={`hold-title-icon ${!active ? 'settled' : ''}`}>{active ? <LockKeyhole size={18}/> : <CheckCircle2 size={18}/>}</span><div><h4 id={`hold-${hold.id}`}>{hold.description || 'Payment authorization'}</h4><span className="hold-id" title={hold.id}>Hold {shortAddress(hold.id)}</span></div></div><div className="hold-status-group">{active && <time dateTime={new Date(hold.expiresAt * 1000).toISOString()} title={new Date(hold.expiresAt * 1000).toLocaleString()} className={`hold-expiry ${expired ? 'expired' : ''}`}><Clock3 size={13}/>{expiryText(hold.expiresAt, now)}</time>}<span className={`status-badge ${active ? expired ? 'expired' : 'active' : 'settled'}`}>{active ? expired ? 'Expired' : 'Reserved' : hold.status === 2 ? 'Fully captured' : 'Settled'}</span></div></div>
    {active ? <>
      <div className="hold-amounts"><div><span>Authorized</span><strong>{money(hold.authorizedAmount)}<small>USDG</small></strong></div><div><span>Captured</span><strong>{money(hold.capturedAmount)}<small>USDG</small></strong></div><div className="remaining-amount"><span>Remaining reserved</span><strong>{money(remaining)}<small>USDG</small></strong></div></div>
      <div className="hold-progress" role="img" aria-label={`${money(hold.capturedAmount)} of ${money(hold.authorizedAmount)} USDG captured, ${money(remaining)} remaining`}><span style={{ width: `${progress}%` }}/></div>
      {mode === 'merchant' ? <div className="merchant-hold-controls">
        <div className="merchant-control-heading"><Store size={16}/><span>{cova.demo ? 'Simulated merchant controls' : 'Authorized merchant controls'}</span></div>
        {isMerchant ? <>
          <form onSubmit={capture}><div className="field"><label htmlFor={`capture-${hold.id}`}>Actual charge</label><div className="amount-input"><input id={`capture-${hold.id}`} name="capture-amount" value={captureAmount} onChange={event => setCaptureAmount(event.target.value)} inputMode="decimal" autoComplete="off" disabled={cova.busy || expired} required/><span>USDG</span></div></div><button type="submit" className="button button-primary" disabled={!canAct || !validCapture || expired}><ArrowUpRight size={16}/>Capture {captureAmount || '0'} USDG</button><button type="button" className="button button-outline release-button" onClick={() => void execute(() => expired ? cova.releaseExpired(hold.id) : cova.release(hold.id))} disabled={!canAct || remaining === 0n}><ArrowDownLeft size={16}/> Release remaining</button></form>
          {!expired && captureAmount && !validCapture && <p className="field-error">Enter a charge greater than zero and no more than {money(remaining)} USDG.</p>}
          <p className="field-help">{expired ? 'This hold has expired. Further captures are blocked; release the remainder to the customer.' : 'Capture can happen in parts. Release closes this hold and returns every unused USDG to the customer.'}</p>
        </> : <p className="permission-note">Connect the authorized merchant wallet to capture or release this hold.</p>}
      </div> : <div className={`customer-hold-note ${expired ? 'expiry-release-note' : ''}`}><ShieldCheck size={16}/><p>{expired ? 'The authorization has expired. Release the remaining funds back to your available balance.' : 'Your merchant can capture the final charge or release unused funds. Your maximum is fixed.'}</p>{expired && isCustomer && <button type="button" className="button button-outline button-small" onClick={() => void execute(() => cova.releaseExpired(hold.id))} disabled={!canAct}>Release expired hold</button>}</div>}
    </> : <>
      <div className="settlement-summary"><div><span>Authorized</span><strong>{money(hold.authorizedAmount)}<small>USDG</small></strong></div><div className="captured-result"><span><ArrowUpRight size={13}/>Captured</span><strong>{money(hold.capturedAmount)}<small>USDG</small></strong></div><div className="released-result"><span><ArrowDownLeft size={13}/>Released</span><strong>{money(released)}<small>USDG</small></strong></div></div>
      <div className="settlement-outcome"><Check size={16}/><p>{money(hold.capturedAmount)} USDG settled to the merchant. {money(released)} USDG returned to the customer.</p></div>
      <div className="settlement-balances"><div><span>Customer available now</span><strong>{customerAvailable !== undefined ? `${money(customerAvailable)} USDG` : 'Visible in customer wallet'}</strong></div><div><span>Merchant received from this hold</span><strong>{money(hold.capturedAmount)} USDG</strong></div></div>
    </>}
    <details className="hold-details"><summary>Authorization details <ChevronDown size={14}/></summary><dl><div><dt>Hold ID</dt><dd>{hold.id}</dd></div><div><dt>Customer</dt><dd>{hold.customer}</dd></div><div><dt>Merchant</dt><dd>{hold.merchant}</dd></div><div><dt>Expires</dt><dd>{new Date(hold.expiresAt * 1000).toLocaleString()}</dd></div><div><dt>Reference ID</dt><dd>{hold.referenceId}</dd></div></dl>{links.length > 0 && <div className="receipt-links">{links.map(receipt => <a key={receipt.hash} href={receipt.url} target="_blank" rel="noreferrer">{receipt.label} receipt <ExternalLink size={12}/></a>)}</div>}{cova.demo && <p className="demo-detail-note"><FlaskLabel/>Simulated hold. No onchain transaction receipts.</p>}</details>
  </article>;
}

function FlaskLabel() { return <span className="mini-demo-dot" aria-hidden="true"/>; }
