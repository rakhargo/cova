'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { getWalletClient } from '@wagmi/core';
import { Clock3, ExternalLink, Info, LoaderCircle, ShieldCheck } from 'lucide-react';
import { createCovaSessionClient, type SessionQuote, type SessionRecord } from '@/sdk/dist/index.js';
import { covaConfig } from '@/lib/config';
import { walletConfig } from '@/lib/wagmi';
import { useCova } from '@/lib/use-cova';
import { formatAmount, shortAddress } from '@/lib/format';
import { parseUiAmount } from '@/components/amount';

type QuoteResponse={quote:Record<string,unknown>;providerSignature:`0x${string}`;serviceLabel:string;billingUnit:'minute';token:'USDG';decimals:6;network:string;testnet:boolean};
type ActiveSession={id:`0x${string}`;quote?:SessionQuote;providerSignature?:`0x${string}`;startHash?:`0x${string}`;stopHash?:`0x${string}`};
const explorer=(hash:string)=>covaConfig.local?undefined:`https://sepolia.arbiscan.io/tx/${hash}`;
function messageFor(error:unknown){return error instanceof Error?error.message:'Session action failed. Check the network and try again.';}
function jsonBigInts(value:unknown){return JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item));}

export function SessionCheckout(){
  const account=useAccount();
  return <SessionCheckoutView key={account.address??'disconnected'}/>;
}

function SessionCheckoutView(){
  const cova=useCova();const account=useAccount();const publicClient=usePublicClient({chainId:covaConfig.chainId});
  const [maximum,setMaximum]=useState('20');const [quote,setQuote]=useState<QuoteResponse>();const [session,setSession]=useState<ActiveSession>();
  const [record,setRecord]=useState<SessionRecord>();const [networkTime,setNetworkTime]=useState<bigint>(0n);const [working,setWorking]=useState(false);const [error,setError]=useState('');const [status,setStatus]=useState('');
  const amount=parseUiAmount(maximum,6);const sessionEnabled=!!covaConfig.sessionRouter&&!!covaConfig.vault&&!!publicClient&&!cova.demo;
  const sdk=useMemo(()=>sessionEnabled?createCovaSessionClient({publicClient:publicClient!,router:covaConfig.sessionRouter!,vault:covaConfig.vault!,token:covaConfig.token,chainId:covaConfig.chainId}):undefined,[sessionEnabled,publicClient]);
  const available=cova.available;const canAuthorize=!!account.address&&cova.connected&&cova.ready&&!cova.wrongChain&&!!quote&&!!amount&&available>=amount&&!!sdk;
  const elapsed=record&&record.startedAt>0n?Math.min(Number((record.stoppedAt||networkTime)-record.startedAt),record.maxDurationSeconds):0;
  const charge=record?record.chargedAmount:0n;
  const quotedDuration=quote?Number(quote.quote.maxDurationSeconds):2400;
  const displayedRate=quote?formatAmount(BigInt(String(quote.quote.ratePerMinute)),6):'Quoted rate';
  const ariaError=error||(!cova.connected?'Connect your wallet to request a session quote.':cova.wrongChain?`Switch to ${cova.chainName} before continuing.`:undefined);

  const refreshSession=useCallback(async(current:ActiveSession)=>{
    if(!sdk||!publicClient)return;
    const [next,block]=await Promise.all([sdk.session(current.id),publicClient.getBlock()]);setRecord(next);setNetworkTime(block.timestamp);
    if(next.status===1)setStatus('Session active, confirmed from Router state. The provider may run its service.');
    else if(next.status===2)setStatus('Settlement confirmed. Review the charge and returned balance below.');
    else if(next.status===3)setStatus('Expired reservation recovery is confirmed onchain.');
  },[sdk,publicClient]);
  useEffect(()=>{if(!session||!sdk||!publicClient)return;let stopped=false;const poll=async()=>{try{await refreshSession(session);}catch{/* A read error stays recoverable through Refresh. */}};void poll();const timer=setInterval(()=>{if(!stopped)void poll();},5000);return()=>{stopped=true;clearInterval(timer);};},[session,sdk,publicClient,refreshSession]);
  useEffect(()=>{
    if(!sessionEnabled||!sdk||!account.address||covaConfig.deploymentBlock===undefined)return;
    let cancelled=false;
    void sdk.history(account.address,'customer',{fromBlock:covaConfig.deploymentBlock,chunkSize:2000n,maxRequests:40}).then(result=>{
      if(cancelled)return;
      const active=result.sessions.find(item=>item.record.status===1&&item.record.customer.toLowerCase()===account.address!.toLowerCase());
      if(active){setSession(previous=>previous??{id:active.sessionId,startHash:active.startHash,stopHash:active.settlementHash});setRecord(active.record);setStatus('Active session recovered from Router state. You can stop it below.');}
      if(result.error)setError('Session history scan is incomplete. Refresh to retry the onchain read.');
    }).catch(()=>{if(!cancelled)setError('Could not read active session from the Router. Check the network and retry.');});
    return()=>{cancelled=true;};
  },[sessionEnabled,sdk,account.address]);

  async function requestQuote(event:FormEvent<HTMLFormElement>){event.preventDefault();setError('');setStatus('Checking balance and requesting provider quote…');setWorking(true);setQuote(undefined);
    try{if(!sessionEnabled)throw new Error('Timed sessions are not configured for this deployment yet.');if(!account.address)throw new Error('Connect a customer wallet first.');if(!amount||amount<=0n)throw new Error('Enter a positive session budget.');if(available<amount)throw new Error('Deposit enough USDG into Cova before requesting this session.');
      const response=await fetch('/api/sessions/quote',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',body:JSON.stringify({customer:account.address,serviceId:'compute-session',maxAmount:amount.toString(),maxDurationSeconds:2400})});const result=await response.json() as QuoteResponse&{error?:string};if(!response.ok)throw new Error(result.error||'Could not request a quote.');
      const raw=result.quote;const parsed={...raw,ratePerMinute:BigInt(String(raw.ratePerMinute)),maxAmount:BigInt(String(raw.maxAmount)),startBy:BigInt(String(raw.startBy)),holdExpiresAt:BigInt(String(raw.holdExpiresAt))} as unknown as SessionQuote;
      setQuote({...result,quote:parsed as unknown as Record<string,unknown>});setStatus('Quote ready. Review the provider, rate, limit and expiry before authorizing.');
    }catch(cause){setError(messageFor(cause));setStatus('');}finally{setWorking(false);}}

  async function authorizeAndStart(){if(!quote||!sdk||!publicClient||!account.address)return;setError('');setWorking(true);setStatus('Waiting for your wallet signature…');
    try{const q=quote.quote as unknown as SessionQuote;if(q.customer.toLowerCase()!==account.address.toLowerCase())throw new Error('The connected wallet changed. Request a fresh quote.');
      const wallet=await getWalletClient(walletConfig,{account:account.address,chainId:covaConfig.chainId});const customerSdk=createCovaSessionClient({publicClient,walletClient:wallet,router:covaConfig.sessionRouter!,vault:covaConfig.vault!,token:covaConfig.token,chainId:covaConfig.chainId});
      const signed=await customerSdk.signStart(q,quote.providerSignature);setStatus('Submitting the signed authorization. The session starts only after chain confirmation…');
      const response=await fetch('/api/sessions/start',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',body:JSON.stringify({quote:jsonBigInts(q),providerSignature:quote.providerSignature,covaAuthorization:jsonBigInts(signed.authorization),covaSignature:signed.signature})});const result=await response.json() as {sessionId:`0x${string}`;transactionHash?:`0x${string}`;status:string;error?:string};if(!response.ok)throw new Error(result.error||'Session did not start.');
      const next={id:result.sessionId,quote:q,providerSignature:quote.providerSignature,startHash:result.transactionHash};setSession(next);setQuote(undefined);
      if(result.status==='confirmed'){await refreshSession(next);cova.refresh();setStatus('Session start confirmed onchain. The service may now begin.');}
      else setStatus('Session start was submitted. The provider stays stopped until Router state confirms it.');
    }catch(cause){setError(messageFor(cause));setStatus('');}finally{setWorking(false);}}

  async function stopSession(){if(!session||!sdk||!account.address)return;setError('');setWorking(true);setStatus('Sign once to stop and settle this session…');
    try{const wallet=await getWalletClient(walletConfig,{account:account.address,chainId:covaConfig.chainId});const customerSdk=createCovaSessionClient({publicClient:publicClient!,walletClient:wallet,router:covaConfig.sessionRouter!,vault:covaConfig.vault!,token:covaConfig.token,chainId:covaConfig.chainId});const validUntil=BigInt(Math.floor(Date.now()/1000)+300);const signature=await customerSdk.signStop(session.id,validUntil);setStatus('Submitting settlement. Waiting for the chain…');
      const response=await fetch(`/api/sessions/${session.id}/stop`,{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',body:JSON.stringify({validUntil:validUntil.toString(),customerSignature:signature})});const result=await response.json() as {transactionHash?:`0x${string}`;error?:string};if(!response.ok)throw new Error(result.error||'Could not settle the session.');setSession({...session,stopHash:result.transactionHash});await refreshSession(session);cova.refresh();setStatus('Settlement confirmed. Review the charge and returned balance below.');
    }catch(cause){setError(messageFor(cause));setStatus('');}finally{setWorking(false);}}

  return <section className="session-section" id="metered-session" aria-labelledby="session-heading">
    <div className="shell">
      <div className="session-intro"><div><p className="session-overline">ONE REFERENCE SERVICE</p><h2 id="session-heading">A timed session with a clear rate.</h2><p>Approve the provider and billing terms first. Cova reserves your selected budget, then settles from the confirmed onchain session time.</p></div><div className="session-state-path" aria-label="Session flow"><span>QUOTE</span><b>›</b><span>RESERVE</span><b>›</b><span>RUN</span><b>›</b><span>SETTLE</span></div></div>
      {!sessionEnabled&&<div className="session-disabled"><Info size={18}/><div><strong>Timed checkout is not configured here.</strong><p>This page keeps the working direct hold playground below. A session Router and dedicated server provider/relayer accounts are required to enable this flow.</p></div></div>}
      {covaConfig.local&&sessionEnabled&&<div className="session-notice"><Info size={17}/><span>Local Anvil test only. MockUSDG has no public-chain value.</span></div>}
      {!cova.demo&&cova.wrongChain&&<div className="session-notice session-error"><Info size={17}/><span>Switch to {cova.chainName} before authorizing a session.</span><button className="text-button" type="button" onClick={()=>void cova.switchChain()}>Switch network</button></div>}
      <div className="session-layout">
        <div className="session-terms">
          <div className="session-terms-head"><span>HOW BILLING WORKS</span><span>USDG · 6 decimals</span></div>
          <div className="session-equation"><strong>{displayedRate}</strong><span>USDG / minute</span><i>×</i><strong>confirmed time</strong><b>=</b><strong>final charge</strong></div>
          <div className="session-policy"><div><ShieldCheck size={17}/><p>The provider receives the agreed rate for elapsed session time. The budget is only the maximum you approve.</p></div><div><Clock3 size={17}/><p>If you stop early, the remainder returns to your available Cova balance after settlement.</p></div></div>
          {record&&<div className="session-receipt" aria-live="polite">
            <div className="receipt-header"><span>{record.status===1?'SESSION ACTIVE':record.status===2?'SETTLED':record.status===3?'EXPIRED · RECOVERY CONFIRMED':session?.startHash?'START SUBMITTED · WAITING FOR CHAIN':'SESSION'}</span><span>{session?.id&&shortAddress(session.id)}</span></div>
            <dl>
              <div><dt>Provider</dt><dd title={record.provider}>{shortAddress(record.provider)}</dd></div><div><dt>Rate</dt><dd>{formatAmount(record.ratePerMinute,6)} USDG / min</dd></div>
              <div><dt>Elapsed onchain time</dt><dd>{elapsed}s <span>({Math.floor(elapsed/60)}m {elapsed%60}s)</span></dd></div>
              <div><dt>Maximum approved</dt><dd>{formatAmount(record.maxAmount,6)} USDG</dd></div>
              {record.status===2&&<><div><dt>Provider received</dt><dd className="receipt-paid">{formatAmount(charge,6)} USDG</dd></div><div><dt>Returned to Cova available</dt><dd>{formatAmount(record.returnedAmount,6)} USDG</dd></div><div><dt>Customer available now</dt><dd>{formatAmount(cova.available,6)} USDG</dd></div></>}
              {record.status===3&&<div><dt>Returned to Cova available</dt><dd>{formatAmount(record.returnedAmount,6)} USDG</dd></div>}
            </dl>
            {session?.startHash&&explorer(session.startHash)&&<a href={explorer(session.startHash)} target="_blank" rel="noreferrer">Start transaction <ExternalLink size={13}/></a>}
            {session?.stopHash&&explorer(session.stopHash)&&<a href={explorer(session.stopHash)} target="_blank" rel="noreferrer">Settlement transaction <ExternalLink size={13}/></a>}
          </div>}
        </div>
        <div className="session-checkout">
          <div className="session-checkout-heading"><div><span>CHECKOUT</span><h3>{record?.status===1?'Your session is running':record?.status===2?'Session receipt':record?.status===0&&session?.startHash?'Waiting for session confirmation':'Start a compute session'}</h3></div><span className="session-network">{covaConfig.local?'LOCAL TEST':'ARB SEPOLIA'}</span></div>
          {!session&&<form onSubmit={requestQuote}>
            <label htmlFor="session-budget">Maximum session budget</label><div className="session-budget-input"><input id="session-budget" value={maximum} inputMode="decimal" onChange={event=>{setMaximum(event.target.value);setQuote(undefined);setError('');}} disabled={working}/><span>USDG</span></div>
            <div className="session-summary-line"><span>Maximum duration</span><strong>{Math.floor(quotedDuration/60)} minutes</strong></div>
            <div className="session-summary-line"><span>Available in Cova</span><strong>{cova.ready?`${formatAmount(available,6)} USDG`:'—'}</strong></div>
            {quote&&<div className="quote-consent" aria-live="polite"><span>PROVIDER QUOTE · REVIEW BEFORE SIGNING</span><dl><div><dt>Provider</dt><dd title={quote.quote.provider as string}>{shortAddress(String(quote.quote.provider))}</dd></div><div><dt>Rate</dt><dd>{formatAmount(BigInt(String(quote.quote.ratePerMinute)),6)} USDG per minute</dd></div><div><dt>Maximum spend</dt><dd>{formatAmount(BigInt(String(quote.quote.maxAmount)),6)} USDG</dd></div><div><dt>Session limit</dt><dd>{Math.floor(Number(quote.quote.maxDurationSeconds)/60)} minutes</dd></div><div><dt>Start before</dt><dd>{new Date(Number(BigInt(String(quote.quote.startBy)))*1000).toLocaleTimeString()}</dd></div><div><dt>Hold expiry</dt><dd>{new Date(Number(BigInt(String(quote.quote.holdExpiresAt)))*1000).toLocaleTimeString()}</dd></div></dl><p>You are authorizing up to this amount. The final charge uses the displayed rate and session time. Unused funds return to your available Cova balance.</p></div>}
            {!quote&&<button className="button button-outline button-full" type="submit" disabled={working||!sessionEnabled||!account.address||!cova.ready||!amount||amount<=0n||available<amount}>{working?<><LoaderCircle size={16} className="spinning"/>Request quote</>:'Review session quote'}</button>}
            {quote&&<button className="button button-primary button-full" type="button" onClick={()=>void authorizeAndStart()} disabled={!canAuthorize||working}>{working?<><LoaderCircle size={16} className="spinning"/>Authorize and start</>:`Authorize up to ${maximum} USDG and start`}</button>}
            {!cova.connected&&<button className="button button-outline button-full" type="button" onClick={()=>void cova.connect()}>Connect wallet</button>}
            {cova.ready&&amount&&available<amount&&<div className="session-funding-hint"><p>Deposit enough USDG into Cova before starting. Your reserved session balance cannot be withdrawn while the service runs.</p><a href="#playground">Open funding controls</a></div>}
          </form>}
          {session&&record?.status===1&&<div className="session-active-controls"><p>Provider may begin only after the start transaction confirms. Your wallet can stop and settle the session at any time.</p><button className="button button-primary button-full" type="button" disabled={working||!sdk||!account.address} onClick={()=>void stopSession()}>{working?<><LoaderCircle size={16} className="spinning"/>Settling session</>:'Stop and settle session'}</button><button className="text-button" type="button" onClick={()=>void refreshSession(session)}>Refresh onchain session status</button></div>}
          {session&&(record?.status===0||!record)&&<div className="session-active-controls"><p>The session has not appeared as active in Router storage. The provider must wait for confirmation.</p><button className="button button-outline button-full" type="button" onClick={()=>void refreshSession(session)}>Refresh onchain session status</button></div>}
          {session&&record&&record.status!==0&&record.status!==1&&<button className="button button-outline button-full" type="button" onClick={()=>{setSession(undefined);setRecord(undefined);setQuote(undefined);setStatus('');setError('');}}>Start another session</button>}
          {(status||error||ariaError)&&<div className={`session-message ${error||ariaError?'is-error':''}`} role={error||ariaError?'alert':'status'}>{error||ariaError||status}</div>}
          <p className="session-fineprint">The onchain clock records session duration. It does not independently verify offchain work. Session start and settlement use a dedicated testnet relayer; customer signatures approve the exact quote.</p>
        </div>
      </div>
    </div>
  </section>;
}
