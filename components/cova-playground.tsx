'use client';
import { CustomerSignature, MerchantSignature } from './signed-authorizations';

import { useEffect, useState, type FormEvent } from 'react';
import { isAddress } from 'viem';
import { Camera, CheckCircle2, ChevronDown, CircleAlert, Clock3, ExternalLink, Info, LoaderCircle, RefreshCw, Zap } from 'lucide-react';
import { useCova } from '@/lib/use-cova';
import { formatAmount, shortAddress } from '@/lib/format';
import type { CovaController, Mode } from '@/lib/types';
import { HoldCard } from './hold-card';
import { parseUiAmount } from './amount';

const DEMO_MERCHANT = '0x2000000000000000000000000000000000000002';
const scenarios = [
  { id: 'court', title: 'Court booking', amount: '20', final: '14', icon: 'court' },
  { id: 'camera', title: 'Camera rental', amount: '100', final: '72', icon: 'camera' },
  { id: 'ev', title: 'EV charging', amount: '30', final: '17.42', icon: 'ev' },
] as const;

function AmountInput({ id, value, onChange, label, disabled = false }: { id: string; value: string; onChange: (value: string) => void; label: string; disabled?: boolean }) {
  return <div className="field"><label htmlFor={id}>{label}</label><div className="amount-input"><input id={id} name={id} inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} disabled={disabled} required autoComplete="off"/><span>USDG</span></div></div>;
}

function TransactionNotice({ cova }: { cova: CovaController }) {
  const tx = cova.transaction;
  const link = tx.hash && cova.explorerTx(tx.hash);
  const title = tx.status === 'awaiting-wallet' ? 'Confirm in your wallet' : tx.status === 'submitted' ? 'Submitted' : tx.status === 'pending' ? 'Confirming' : tx.status === 'confirmed' ? (cova.demo ? 'Demo action complete' : tx.kind === 'signature' ? 'Authorization signed' : 'Confirmed') : tx.status === 'failed' ? 'Failed' : '';
  return <div className="transaction-region" aria-live="polite" aria-atomic="true">{tx.status !== 'idle' && <div className={`transaction-notice ${tx.status}`}>
    {tx.status === 'confirmed' ? <CheckCircle2 size={18}/> : tx.status === 'failed' ? <CircleAlert size={18}/> : <LoaderCircle size={18} className="spinning"/>}
    <div><strong>{title}</strong>{(tx.error || tx.label) && <p>{tx.error || tx.label}</p>}{tx.hash && <span className="transaction-hash" title={tx.hash}>{shortAddress(tx.hash)}</span>}</div>
    {link && <a href={link} target="_blank" rel="noreferrer" className="receipt-link">View <ExternalLink size={13}/></a>}
  </div>}</div>;
}

export function CovaPlayground() {
  const cova = useCova();
  const [mode, setMode] = useState<Mode>('customer');
  const [scenario, setScenario] = useState<(typeof scenarios)[number]>(scenarios[0]);
  const [amount, setAmount] = useState('20');
  const [merchant, setMerchant] = useState(process.env.NEXT_PUBLIC_DEMO_MERCHANT_ADDRESS || '');
  const [expiry, setExpiry] = useState('60');
  const [reference, setReference] = useState('Court booking');
  const [depositAmount, setDepositAmount] = useState('100');
  const [withdrawAmount, setWithdrawAmount] = useState('10');
  const [uiError, setUiError] = useState<string>();
  const [now, setNow] = useState(0);
  useEffect(() => { const update = () => setNow(Math.floor(Date.now() / 1000)); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, []);
  const canAct = cova.ready && !cova.busy && !cova.loading && !cova.wrongChain && !cova.readError && (cova.demo || cova.connected);
  const balancesReady = cova.demo || (cova.ready && cova.connected && !cova.wrongChain && !cova.readError);
  const usd = (value: bigint) => balancesReady ? formatAmount(value, cova.decimals) : '-';
  const depositValue = parseUiAmount(depositAmount, cova.decimals);
  const withdrawValue = parseUiAmount(withdrawAmount, cova.decimals);
  const holdValue = parseUiAmount(amount, cova.decimals);
  const chosenMerchant = cova.demo ? DEMO_MERCHANT : merchant;
  const validMerchant = isAddress(chosenMerchant) && !/^0x0{40}$/.test(chosenMerchant);
  const expiryMinutes = Number(expiry);
  const validExpiry = Number.isSafeInteger(expiryMinutes) && expiryMinutes > 0 && expiryMinutes <= 525600;
  const validDeposit = depositValue !== undefined && depositValue > 0n;
  const validWithdraw = withdrawValue !== undefined && withdrawValue > 0n;
  const validHold = holdValue !== undefined && holdValue > 0n;
  const needsApproval = validDeposit && cova.allowance < depositValue;
  const holds = mode === 'customer' ? cova.customerHolds : cova.merchantHolds;
  const activeHolds = holds.filter(hold => hold.status === 1);
  const settledHolds = holds.filter(hold => hold.status === 2 || hold.status === 3);
  const merchantReceived = cova.merchantHolds.reduce((sum, hold) => sum + hold.capturedAmount, 0n);
  const merchantReserved = cova.merchantHolds.filter(hold => hold.status === 1).reduce((sum, hold) => sum + hold.authorizedAmount - hold.capturedAmount, 0n);

  async function execute(action: () => Promise<void>) {
    setUiError(undefined);
    try { await action(); } catch (error) { setUiError(error instanceof Error ? error.message : 'Action failed. Try again.'); }
  }

  function chooseScenario(next: (typeof scenarios)[number]) {
    setScenario(next); setAmount(next.amount); setReference(next.title); setUiError(undefined);
  }

  function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAct || !validHold || !validMerchant || !validExpiry || holdValue > cova.available) return;
    void execute(() => cova.createHold({ merchant: chosenMerchant, amount, expiryMinutes, description: reference.trim() || scenario.title }));
  }

  const actionHint = cova.demo ? undefined : !cova.connected ? 'Connect a wallet to continue.' : cova.wrongChain ? `Switch to ${cova.chainName}.` : !cova.ready ? 'Waiting for vault checks.' : 'Views never change wallet permissions.';

  return <section className="playground-section" id="playground" aria-labelledby="playground-heading">
    <div className="shell">
      <div className="section-heading">
        <h2 id="playground-heading">Playground</h2>
        <p className="section-note">{cova.demo ? 'Simulated balances. No blockchain transactions.' : cova.local ? 'Local Anvil. Actions send transactions to your local chain.' : 'Arbitrum Sepolia. Actions send real testnet transactions from your wallet.'}</p>
      </div>
      <div className="playground-frame">
        <div className="playground-toolbar">
          <div className="view-switch" role="group" aria-label="Choose account view">
            <button type="button" onClick={() => setMode('customer')} className={mode === 'customer' ? 'selected' : ''} aria-pressed={mode === 'customer'}>Customer</button>
            <button type="button" onClick={() => setMode('merchant')} className={mode === 'merchant' ? 'selected' : ''} aria-pressed={mode === 'merchant'}>Merchant</button>
          </div>
          {!cova.demo && <div className="wallet-controls">
            <button type="button" className="icon-button" onClick={() => cova.refresh()} disabled={cova.busy || cova.loading} aria-label="Refresh balances and holds" title="Refresh"><RefreshCw size={16} className={cova.loading ? 'spinning' : ''}/></button>
            {cova.connected ? <><span className="wallet-chip" title={cova.address}>{cova.address && shortAddress(cova.address)}</span><button className="text-button disconnect" type="button" onClick={cova.disconnect} disabled={cova.busy}>Disconnect</button></> : <button className="button button-primary button-small" type="button" onClick={() => void execute(cova.connect)} disabled={cova.busy}>Connect wallet</button>}
          </div>}
          {cova.demo && <button type="button" className="text-button demo-reset" onClick={() => { cova.resetDemo(); setUiError(undefined); }} disabled={cova.busy}>Reset playground</button>}
        </div>
        {cova.local && !cova.demo && <div className="connection-banner"><Info size={18}/><div><strong>Local Anvil</strong><p>MockUSDG only. Not Paxos USDG.</p></div></div>}
        {!cova.demo && cova.wrongChain && <div className="connection-banner"><CircleAlert size={19}/><div><strong>Wrong network</strong><p>Switch to {cova.chainName}.</p></div><button type="button" className="button button-small button-primary" onClick={() => void execute(cova.switchChain)} disabled={cova.busy}>Switch network</button></div>}
        {!cova.demo && cova.configError && <div className="connection-banner error-banner"><CircleAlert size={19}/><div><strong>Config error</strong><p>{cova.configError}</p></div></div>}
        {!cova.demo && cova.readError && <div className="connection-banner error-banner"><CircleAlert size={19}/><div><strong>Read failed</strong><p>{cova.readError}</p></div><button type="button" className="button button-small button-outline" onClick={cova.refresh} disabled={cova.loading}>Retry</button></div>}
        <TransactionNotice cova={cova}/>
        {uiError && <div className="inline-error top-error" role="alert"><CircleAlert size={16}/>{uiError}</div>}
        {actionHint && <div className="account-hint"><Info size={14}/><span>{actionHint}</span></div>}

        {mode === 'customer' ? <>
          <div className="balance-summary">
            <div className="balance-metric"><span>Available</span><strong>{usd(cova.available)}<small>USDG</small></strong></div>
            <div className="balance-metric reserved-metric"><span><i className="swatch swatch-reserved" aria-hidden="true"/>Reserved</span><strong>{usd(cova.reserved)}<small>USDG</small></strong></div>
            <div className="balance-metric total-metric"><span>Total</span><strong>{usd(cova.available + cova.reserved)}<small>USDG</small></strong></div>
          </div>
          <div className="customer-grid">
            <aside className="funding-panel" aria-labelledby="funding-heading">
              <div className="panel-heading"><h3 id="funding-heading">Funds</h3></div>
              <div className="funding-facts">
                <div><span>Wallet</span><strong>{usd(cova.walletBalance)}</strong></div>
                <div><span>Allowance</span><strong>{usd(cova.allowance)}</strong></div>
              </div>
              {!cova.demo && !cova.local && <a className="test-token-link" href="https://docs.paxos.com/guides/developer/fund-sandbox-with-test-crypto" target="_blank" rel="noreferrer">Get test USDG <ExternalLink size={12}/></a>}
              <form onSubmit={event => { event.preventDefault(); if (canAct && validDeposit && !needsApproval && depositValue <= cova.walletBalance) void execute(() => cova.deposit(depositAmount)); }}>
                <AmountInput id="deposit-amount" label="Deposit" value={depositAmount} onChange={setDepositAmount} disabled={cova.busy}/>
                <div className="funding-actions">
                  <button type="button" className="button button-outline button-full" onClick={() => void execute(() => cova.approve(depositAmount))} disabled={!canAct || !validDeposit || !needsApproval}>{needsApproval ? `Approve ${depositAmount} USDG` : 'Approved'}</button>
                  <button type="submit" className="button button-primary button-full" disabled={!canAct || !validDeposit || !!needsApproval || depositValue > cova.walletBalance}>Deposit USDG</button>
                </div>
                {depositAmount && !validDeposit && <p className="field-error">Enter an amount greater than zero with up to {cova.decimals} decimals.</p>}
                {balancesReady && validDeposit && depositValue > cova.walletBalance && <p className="field-error">Insufficient wallet USDG.</p>}
              </form>
              <div className="funding-divider"/>
              <form onSubmit={event => { event.preventDefault(); if (canAct && validWithdraw && withdrawValue <= cova.available) void execute(() => cova.withdraw(withdrawAmount)); }}>
                <AmountInput id="withdraw-amount" label="Withdraw" value={withdrawAmount} onChange={setWithdrawAmount} disabled={cova.busy}/>
                <button type="submit" className="button button-outline button-full" disabled={!canAct || !validWithdraw || withdrawValue > cova.available}>Withdraw USDG</button>
                {withdrawAmount && !validWithdraw && <p className="field-error">Enter a valid amount greater than zero.</p>}
                {balancesReady && validWithdraw && withdrawValue > cova.available && <p className="field-error">Max withdraw {formatAmount(cova.available, cova.decimals)} USDG.</p>}
              </form>
            </aside>
            <div className="authorization-panel" aria-labelledby="authorization-heading">
              <div className="panel-heading"><h3 id="authorization-heading">Reserve for a service</h3></div>
              <div className="scenario-selector" role="group" aria-label="Example service">
                <div className="scenario-tiles">
                  {scenarios.map(item => <button type="button" key={item.id} aria-pressed={scenario.id === item.id} className={`scenario-tile ${scenario.id === item.id ? 'selected' : ''}`} onClick={() => chooseScenario(item)} disabled={cova.busy}>
                    <span className="scenario-top">{item.icon === 'camera' ? <Camera size={18}/> : item.icon === 'ev' ? <Zap size={18}/> : <span className="court-icon" aria-hidden="true"/>}{scenario.id === item.id && <CheckCircle2 size={14}/>}</span>
                    <strong>{item.title}</strong>
                    <span>{item.amount} max · {item.final} final</span>
                  </button>)}
                </div>
              </div>
              <form className="hold-form" onSubmit={authorize}>
                <div className="field">
                  <label htmlFor="merchant-address">Merchant <span className="label-note">{cova.demo ? 'Simulated' : 'Address'}</span></label>
                  <input className="address-input" id="merchant-address" name="merchant-address" value={chosenMerchant} onChange={event => setMerchant(event.target.value)} readOnly={cova.demo} disabled={cova.busy} placeholder="0x…" autoComplete="off" required spellCheck={false}/>
                  {!cova.demo && merchant && !validMerchant && <p className="field-error">Enter a valid nonzero address.</p>}
                </div>
                <div className="form-row">
                  <AmountInput id="authorization-amount" label="Maximum" value={amount} onChange={setAmount} disabled={cova.busy}/>
                  <div className="field">
                    <label htmlFor="expiry-minutes">Expires</label>
                    <div className="select-wrapper">
                      <Clock3 size={15}/>
                      <select id="expiry-minutes" name="expiry-minutes" value={expiry} onChange={event => setExpiry(event.target.value)} disabled={cova.busy}>
                        <option value="1">1 minute</option>
                        <option value="15">15 minutes</option>
                        <option value="60">1 hour</option>
                        <option value="1440">24 hours</option>
                        <option value="10080">7 days</option>
                      </select>
                      <ChevronDown size={15}/>
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="hold-reference">Reference <span className="label-note">Optional</span></label>
                  <input id="hold-reference" name="hold-reference" value={reference} onChange={event => setReference(event.target.value)} maxLength={120} disabled={cova.busy} placeholder="Service reference"/>
                </div>
                {amount && !validHold && <p className="field-error">Enter an amount greater than zero with up to {cova.decimals} decimals.</p>}
                {balancesReady && validHold && holdValue > cova.available && <p className="field-error">Not enough available USDG.</p>}
                <div className="authorization-review">
                  <p>Reserve <strong>{validHold ? amount : '-'}</strong> for <strong className="review-address" title={chosenMerchant}>{validMerchant ? shortAddress(chosenMerchant) : 'merchant'}</strong>, expires in <strong>{expiryMinutes < 60 ? `${expiryMinutes}m` : expiryMinutes < 1440 ? `${expiryMinutes / 60}h` : `${expiryMinutes / 1440}d`}</strong>.</p>
                </div>
                <div className="authorize-footer">
                  <button className="button button-primary authorize-button" type="submit" disabled={!canAct || !validHold || !validMerchant || !validExpiry || holdValue > cova.available}>Authorize hold</button>
                </div>
              </form>
              <CustomerSignature cova={cova} input={{merchant:chosenMerchant,amount,expiryMinutes,description:reference.trim() || scenario.title}} canAct={canAct} canSign={canAct && validHold && validMerchant && validExpiry && holdValue<=cova.available} execute={execute}/>
            </div>
          </div>
        </> : <>
          <div className="balance-summary merchant-balances">
            <div className="balance-metric"><span>Active holds</span><strong>{balancesReady ? activeHolds.length : '-'}</strong></div>
            <div className="balance-metric reserved-metric"><span><i className="swatch swatch-reserved" aria-hidden="true"/>Reserved for you</span><strong>{usd(merchantReserved)}<small>USDG</small></strong></div>
            <div className="balance-metric received-metric"><span><i className="swatch swatch-captured" aria-hidden="true"/>Captured</span><strong>{usd(merchantReceived)}<small>USDG</small></strong></div>
          </div>
          {!cova.demo && cova.connected && <div className="merchant-wallet-line"><span title={cova.address}>{shortAddress(cova.address ?? '')}</span><strong>{usd(cova.walletBalance)} USDG</strong></div>}
        </>}

        {mode==='merchant' && <MerchantSignature cova={cova} canAct={canAct} execute={execute}/>}
        <div className="hold-list-section">
          {!cova.demo && cova.receiptHistoryLoading && <p className="field-help" aria-live="polite">Syncing verified receipt history from the chain…</p>}
          {!cova.demo && cova.receiptHistoryError && <p className="field-error" role="status">{cova.receiptHistoryError} Refresh to retry.</p>}
          <div className="hold-list-heading">
            <h3>{mode === 'customer' ? 'Your holds' : 'Assigned holds'}</h3>
            <span>{holds.length}</span>
          </div>
          {holds.length === 0 ? <div className="empty-holds">
            <div>
              <h4>{mode === 'customer' ? 'No holds yet.' : 'Nothing assigned.'}</h4>
              <p>{mode === 'customer' ? 'Authorize a service above.' : cova.demo ? 'Create a hold as Customer, then return here.' : 'Have a customer authorize this wallet.'}</p>
              {mode === 'merchant' && cova.demo && <button type="button" className="text-button" onClick={() => setMode('customer')}>Go to Customer view</button>}
            </div>
          </div> : <>
            {activeHolds.map(hold => <HoldCard key={hold.id} hold={hold} cova={cova} mode={mode} now={cova.demo ? now : cova.chainTime ?? 0} canAct={canAct} execute={execute}/>)}
            {settledHolds.length > 0 && <div className="settled-list"><h4>Settled</h4>{settledHolds.map(hold => <HoldCard key={hold.id} hold={hold} cova={cova} mode={mode} now={cova.demo ? now : cova.chainTime ?? 0} canAct={canAct} execute={execute}/>)}</div>}
          </>}
        </div>
      </div>
    </div>
  </section>;
}
