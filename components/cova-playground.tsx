'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { isAddress } from 'viem';
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, Camera, Check, CheckCircle2, ChevronDown, CircleAlert, Clock3, ExternalLink, FlaskConical, Info, LoaderCircle, LockKeyhole, Plug, RefreshCw, ShieldCheck, Store, UserRound, Wallet, Zap } from 'lucide-react';
import { useCova } from '@/lib/use-cova';
import { formatAmount, shortAddress } from '@/lib/format';
import type { CovaController, Mode } from '@/lib/types';
import { HoldCard } from './hold-card';
import { parseUiAmount } from './amount';

const DEMO_MERCHANT = '0x2000000000000000000000000000000000000002';
const scenarios = [
  { id: 'court', title: 'Court booking', amount: '20', final: '14', description: 'Pay for the time you play.', icon: 'court' },
  { id: 'camera', title: 'Camera rental', amount: '100', final: '72', description: 'A deposit with a flexible final bill.', icon: 'camera' },
  { id: 'ev', title: 'EV charging', amount: '30', final: '17.42', description: 'Settle the energy actually used.', icon: 'ev' },
] as const;

function AmountInput({ id, value, onChange, label, disabled = false }: { id: string; value: string; onChange: (value: string) => void; label: string; disabled?: boolean }) {
  return <div className="field"><label htmlFor={id}>{label}</label><div className="amount-input"><input id={id} name={id} inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} disabled={disabled} required autoComplete="off"/><span>USDG</span></div></div>;
}

function TransactionNotice({ cova }: { cova: CovaController }) {
  const tx = cova.transaction;
  const link = tx.hash && cova.explorerTx(tx.hash);
  const title = tx.status === 'awaiting-wallet' ? 'Confirm in your wallet' : tx.status === 'submitted' ? 'Transaction submitted' : tx.status === 'pending' ? 'Waiting for confirmation' : tx.status === 'confirmed' ? (cova.demo ? 'Demo action complete' : 'Transaction confirmed') : tx.status === 'failed' ? 'Action failed' : '';
  return <div className="transaction-region" aria-live="polite" aria-atomic="true">{tx.status !== 'idle' && <div className={`transaction-notice ${tx.status}`}>
    {tx.status === 'confirmed' ? <CheckCircle2 size={20}/> : tx.status === 'failed' ? <CircleAlert size={20}/> : <LoaderCircle size={20} className="spinning"/>}
    <div><strong>{title}</strong><p>{tx.error || tx.label}</p>{tx.hash && <span className="transaction-hash" title={tx.hash}>{shortAddress(tx.hash)}</span>}</div>
    {link && <a href={link} target="_blank" rel="noreferrer" className="receipt-link">View transaction <ExternalLink size={13}/></a>}
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
  const usd = (value: bigint) => balancesReady ? formatAmount(value, cova.decimals) : '—';
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
    try { await action(); } catch (error) { setUiError(error instanceof Error ? error.message : 'The action could not be completed. Please try again.'); }
  }

  function chooseScenario(next: (typeof scenarios)[number]) {
    setScenario(next); setAmount(next.amount); setReference(next.title); setUiError(undefined);
  }

  function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAct || !validHold || !validMerchant || !validExpiry || holdValue > cova.available) return;
    void execute(() => cova.createHold({ merchant: chosenMerchant, amount, expiryMinutes, description: reference.trim() || scenario.title }));
  }

  const actionHint = cova.demo ? 'Demo roles are simulated. No wallet signatures or blockchain transactions.' : !cova.connected ? 'Connect a wallet to fund your balance and authorize a hold.' : cova.wrongChain ? 'Switch networks to use Cova.' : !cova.ready ? 'Live actions become available after the vault and balance checks pass.' : 'Your connected wallet signs every action. Switching views never changes its permissions.';

  return <section className="playground-section" id="playground" aria-labelledby="playground-heading">
    <div className="shell">
      <div className="section-heading"><div><h2 id="playground-heading">Follow the money.</h2><p>Try the complete payment lifecycle, one hold at a time.</p></div><span className={`network-tag ${cova.demo ? 'demo-tag' : ''}`}><span/>{cova.demo ? 'Demo Mode' : cova.local ? 'Local Anvil' : 'Arbitrum Sepolia'}</span></div>
      <div className="playground-frame">
        <div className="playground-toolbar">
          <div className="view-switch" role="group" aria-label="Choose account view"><button type="button" onClick={() => setMode('customer')} className={mode === 'customer' ? 'selected' : ''} aria-pressed={mode === 'customer'}><UserRound size={16}/> Customer</button><button type="button" onClick={() => setMode('merchant')} className={mode === 'merchant' ? 'selected' : ''} aria-pressed={mode === 'merchant'}><Store size={16}/> Merchant</button></div>
          <div className="wallet-controls">
            <button type="button" className="icon-button" onClick={() => cova.refresh()} disabled={cova.busy || cova.loading} aria-label="Refresh balances and holds" title="Refresh balances and holds"><RefreshCw size={16} className={cova.loading ? 'spinning' : ''}/></button>
            {cova.demo ? <span className="wallet-chip"><FlaskConical size={15}/> Simulated wallet</span> : cova.connected ? <><span className="wallet-chip" title={cova.address}><Wallet size={15}/>{cova.address && shortAddress(cova.address)}</span><button className="text-button disconnect" type="button" onClick={cova.disconnect} disabled={cova.busy}>Disconnect</button></> : <button className="button button-primary button-small" type="button" onClick={() => void execute(cova.connect)} disabled={cova.busy}><Plug size={15}/> Connect wallet</button>}
          </div>
        </div>
        {cova.demo && <div className="demo-banner"><FlaskConical size={18}/><div><strong>Demo Mode</strong><span>Practice with simulated USDG. No blockchain transactions.</span></div><button type="button" className="text-button" onClick={() => { cova.resetDemo(); setUiError(undefined); }} disabled={cova.busy}><RefreshCw size={13}/> Reset demo</button></div>}
        {cova.local && !cova.demo && <div className="connection-banner"><Info size={18}/><div><strong>Local Anvil • MockUSDG test fixture</strong><p>These are local blockchain transactions; this token is not Paxos USDG.</p></div></div>}
        {!cova.demo && cova.wrongChain && <div className="connection-banner"><CircleAlert size={19}/><div><strong>Switch to {cova.chainName}</strong><p>Your wallet is connected to a different network.</p></div><button type="button" className="button button-small button-primary" onClick={() => void execute(cova.switchChain)} disabled={cova.busy}>Switch network</button></div>}
        {!cova.demo && cova.configError && <div className="connection-banner error-banner"><CircleAlert size={19}/><div><strong>Live configuration needs attention</strong><p>{cova.configError}</p></div></div>}
        {!cova.demo && cova.readError && <div className="connection-banner error-banner"><CircleAlert size={19}/><div><strong>Could not read the latest vault state</strong><p>{cova.readError}</p></div><button type="button" className="button button-small button-outline" onClick={cova.refresh} disabled={cova.loading}>Retry</button></div>}
        <TransactionNotice cova={cova}/>
        {uiError && <div className="inline-error top-error" role="alert"><CircleAlert size={16}/>{uiError}</div>}
        <div className="account-hint"><Info size={14}/><span>{actionHint}</span></div>

        {mode === 'customer' ? <>
          <div className="balance-summary"><div className="balance-metric"><span>Available</span><strong>{usd(cova.available)}<small>USDG</small></strong><p>Ready to spend or withdraw</p></div><div className="balance-metric reserved-metric"><span><span className="metric-dot"/>Reserved</span><strong>{usd(cova.reserved)}<small>USDG</small></strong><p>Committed to active holds</p></div><div className="balance-metric total-metric"><span>Total in Cova</span><strong>{usd(cova.available + cova.reserved)}<small>USDG</small></strong><p>Available + reserved</p></div></div>
          <div className="customer-grid">
            <aside className="funding-panel" aria-labelledby="funding-heading">
              <div className="panel-heading"><Wallet size={19}/><h3 id="funding-heading">Your funds</h3></div>
              <div className="funding-facts"><div><span>Wallet balance</span><strong>{usd(cova.walletBalance)} USDG</strong></div><div><span>Approved for deposit</span><strong>{usd(cova.allowance)} USDG</strong></div></div>
              {!cova.demo && !cova.local && <a className="test-token-link" href="https://docs.paxos.com/guides/developer/fund-sandbox-with-test-crypto" target="_blank" rel="noreferrer">Get test USDG <ExternalLink size={12}/></a>}
              <form onSubmit={event => { event.preventDefault(); if (canAct && validDeposit && !needsApproval && depositValue <= cova.walletBalance) void execute(() => cova.deposit(depositAmount)); }}>
                <AmountInput id="deposit-amount" label="Deposit into Cova" value={depositAmount} onChange={setDepositAmount} disabled={cova.busy}/>
                <div className="funding-actions"><button type="button" className="button button-outline button-full" onClick={() => void execute(() => cova.approve(depositAmount))} disabled={!canAct || !validDeposit || !needsApproval}>{needsApproval ? <ShieldCheck size={15}/> : <Check size={15}/>} {needsApproval ? `Approve ${depositAmount} USDG` : 'Amount approved'}</button><button type="submit" className="button button-primary button-full" disabled={!canAct || !validDeposit || !!needsApproval || depositValue > cova.walletBalance}><ArrowDownToLine size={15}/> Deposit USDG</button></div>
                <p className="field-help">Approve the exact amount first, then deposit it.</p>
                {depositAmount && !validDeposit && <p className="field-error">Enter an amount greater than zero with up to {cova.decimals} decimals.</p>}
                {balancesReady && validDeposit && depositValue > cova.walletBalance && <p className="field-error">Your wallet has insufficient USDG for this deposit.</p>}
              </form>
              <div className="funding-divider"/>
              <form onSubmit={event => { event.preventDefault(); if (canAct && validWithdraw && withdrawValue <= cova.available) void execute(() => cova.withdraw(withdrawAmount)); }}>
                <AmountInput id="withdraw-amount" label="Withdraw available funds" value={withdrawAmount} onChange={setWithdrawAmount} disabled={cova.busy}/>
                <button type="submit" className="button button-outline button-full" disabled={!canAct || !validWithdraw || withdrawValue > cova.available}><ArrowUpFromLine size={15}/> Withdraw USDG</button>
                <p className="field-help">Reserved funds stay in Cova until settlement.</p>
                {withdrawAmount && !validWithdraw && <p className="field-error">Enter a valid amount greater than zero.</p>}
                {balancesReady && validWithdraw && withdrawValue > cova.available && <p className="field-error">You can withdraw up to {formatAmount(cova.available, cova.decimals)} USDG.</p>}
              </form>
            </aside>
            <div className="authorization-panel" aria-labelledby="authorization-heading">
              <div className="panel-heading"><ShieldCheck size={20}/><h3 id="authorization-heading">Create an authorization</h3></div><p className="panel-description">Choose a service. Set a maximum. Keep the final bill flexible.</p>
              <div className="scenario-selector" role="group" aria-label="Example service"><div className="scenario-tiles">{scenarios.map(item => <button type="button" key={item.id} aria-pressed={scenario.id === item.id} className={`scenario-tile ${scenario.id === item.id ? 'selected' : ''}`} onClick={() => chooseScenario(item)} disabled={cova.busy}><span className="scenario-top">{item.icon === 'camera' ? <Camera size={19}/> : item.icon === 'ev' ? <Zap size={19}/> : <span className="court-icon" aria-hidden="true"/>}{scenario.id === item.id && <CheckCircle2 size={15}/>}</span><strong>{item.title}</strong><span>{item.amount} USDG maximum</span></button>)}</div></div>
              <div className="scenario-explanation"><span>{scenario.description}</span><span>Suggested final charge <strong>{scenario.final} USDG</strong></span></div>
              <form className="hold-form" onSubmit={authorize}>
                <div className="field"><label htmlFor="merchant-address">Authorized merchant <span className="label-note">{cova.demo ? 'Simulated' : 'Wallet address'}</span></label><input className="address-input" id="merchant-address" name="merchant-address" value={chosenMerchant} onChange={event => setMerchant(event.target.value)} readOnly={cova.demo} disabled={cova.busy} placeholder="0x…" autoComplete="off" required spellCheck={false}/>{!cova.demo && merchant && !validMerchant && <p className="field-error">Enter a valid, nonzero EVM wallet address.</p>}</div>
                <div className="form-row"><AmountInput id="authorization-amount" label="Maximum authorization" value={amount} onChange={setAmount} disabled={cova.busy}/><div className="field"><label htmlFor="expiry-minutes">Expires after</label><div className="select-wrapper"><Clock3 size={15}/><select id="expiry-minutes" name="expiry-minutes" value={expiry} onChange={event => setExpiry(event.target.value)} disabled={cova.busy}><option value="1">1 minute (try expiry)</option><option value="15">15 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option><option value="10080">7 days</option></select><ChevronDown size={15}/></div></div></div>
                <div className="field"><label htmlFor="hold-reference">Reference <span className="label-note">Optional</span></label><input id="hold-reference" name="hold-reference" value={reference} onChange={event => setReference(event.target.value)} maxLength={120} disabled={cova.busy} placeholder="Booking or service reference"/></div>
                {amount && !validHold && <p className="field-error">Enter an amount greater than zero with up to {cova.decimals} decimals.</p>}
                {balancesReady && validHold && holdValue > cova.available && <p className="field-error">Insufficient available USDG. Deposit funds or reduce the amount.</p>}
                <div className="authorization-review"><span>Review your authorization</span><p>Reserve up to <strong>{validHold ? amount : '—'} USDG</strong> for merchant <strong className="review-address" title={chosenMerchant}>{validMerchant ? shortAddress(chosenMerchant) : 'not yet selected'}</strong>. The hold expires in <strong>{expiryMinutes < 60 ? `${expiryMinutes} ${expiryMinutes === 1 ? 'minute' : 'minutes'}` : expiryMinutes < 1440 ? `${expiryMinutes / 60} ${expiryMinutes === 60 ? 'hour' : 'hours'}` : `${expiryMinutes / 1440} ${expiryMinutes === 1440 ? 'day' : 'days'}`}</strong>.</p></div>
                <div className="authorize-footer"><p><LockKeyhole size={14}/><span>The merchant can capture up to this maximum. You can reclaim any remainder after expiry.</span></p><button className="button button-primary authorize-button" type="submit" disabled={!canAct || !validHold || !validMerchant || !validExpiry || holdValue > cova.available}>Authorize hold <ArrowRight size={17}/></button></div>
              </form>
            </div>
          </div>
        </> : <>
          <div className="merchant-intro"><div><Store size={22}/><div><h3>Merchant settlement</h3><p>{cova.demo ? 'Simulate the authorized merchant to capture charges and release unused funds.' : 'Manage authorizations assigned to your connected wallet.'}</p></div></div>{cova.demo && <span className="role-simulation-label">Simulated merchant role</span>}</div>
          <div className="balance-summary merchant-balances"><div className="balance-metric"><span>Active authorizations</span><strong>{balancesReady ? activeHolds.length : '—'}<small>holds</small></strong><p>Awaiting settlement or release</p></div><div className="balance-metric reserved-metric"><span><span className="metric-dot"/>Remaining authorized</span><strong>{usd(merchantReserved)}<small>USDG</small></strong><p>Across your active holds</p></div><div className="balance-metric received-metric"><span>Captured to merchant</span><strong>{usd(merchantReceived)}<small>USDG</small></strong><p>Settled from listed authorizations</p></div></div>
          {!cova.demo && cova.connected && <div className="merchant-wallet-line"><Wallet size={15}/><span title={cova.address}>Connected merchant: {cova.address}</span><strong>Wallet {usd(cova.walletBalance)} USDG</strong></div>}
        </>}

        <div className="hold-list-section">
          <div className="hold-list-heading"><h3>{mode === 'customer' ? 'Your authorizations' : 'Assigned authorizations'}</h3><span>{holds.length} {holds.length === 1 ? 'hold' : 'holds'}</span></div>
          {holds.length === 0 ? <div className="empty-holds"><div className="empty-icon"><LockKeyhole size={24}/></div><div><h4>{mode === 'customer' ? 'Your first hold starts here.' : 'No authorizations assigned yet.'}</h4><p>{mode === 'customer' ? 'Authorize a service above to see funds move from available to reserved.' : cova.demo ? 'Create a hold in the Customer view, then return here to settle it.' : 'Ask a customer to authorize your connected wallet as the merchant.'}</p>{mode === 'merchant' && cova.demo && <button type="button" className="text-button" onClick={() => setMode('customer')}>Go to Customer view <ArrowRight size={14}/></button>}</div></div> : <>
            {activeHolds.map(hold => <HoldCard key={hold.id} hold={hold} cova={cova} mode={mode} now={cova.demo ? now : cova.chainTime ?? 0} canAct={canAct} execute={execute}/>)}
            {settledHolds.length > 0 && <div className="settled-list"><h4>Settlement history</h4>{settledHolds.map(hold => <HoldCard key={hold.id} hold={hold} cova={cova} mode={mode} now={cova.demo ? now : cova.chainTime ?? 0} canAct={canAct} execute={execute}/>)}</div>}
          </>}
        </div>
        <div className="playground-bottom"><ShieldCheck size={14}/><p>Each hold has a fixed maximum. Captured funds settle to the merchant; released funds return to the customer’s available balance.</p><span>{cova.demo ? 'Simulated USDG' : cova.chainName}</span></div>
      </div>
    </div>
  </section>;
}
