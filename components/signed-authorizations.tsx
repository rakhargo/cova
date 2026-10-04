'use client';
import { useState } from 'react';
import { Copy, FileSignature, ShieldCheck } from 'lucide-react';
import type { CovaController,CreateHoldInput } from '@/lib/types';
import styles from './signed-authorizations.module.css';
export function CustomerSignature({cova,input,canAct,canSign,execute}:{cova:CovaController;input:CreateHoldInput;canAct:boolean;canSign:boolean;execute:(f:()=>Promise<void>)=>Promise<void>}) {
 const [copied,setCopied]=useState(false);
 if(cova.demo) return null;
 return <details className={styles.panel}><summary>Customer-signed authorization</summary><p>Sign a maximum charge for your merchant to submit. Funds become reserved only after submission confirms.</p>
 {!cova.supportsSignedAuthorizations?<p className={styles.notice}>This vault uses direct authorizations. Signed authorizations require the version 2 deployment.</p>:<>
 <div className={styles.actions}><button type="button" className="button button-outline" disabled={!canSign} onClick={()=>void execute(()=>cova.signAuthorization(input))}><FileSignature size={16}/>Sign authorization</button><button type="button" className="text-button" disabled={!canAct} onClick={()=>void execute(cova.invalidateAuthorizations)}>Invalidate pending signatures</button></div>
 <p className={styles.help}>Invalidation cancels unsubmitted signatures. Existing holds remain reserved.</p>
 {cova.signedAuthorization && <div className="field"><label htmlFor="signed-authorization">Signed authorization JSON</label><textarea id="signed-authorization" className={styles.packet} readOnly value={cova.signedAuthorization}/><button type="button" className="text-button" onClick={()=>void execute(async()=>{await navigator.clipboard.writeText(cova.signedAuthorization!);setCopied(true);})}><Copy size={14}/>{copied?'Copied':'Copy authorization'}</button><p className={styles.help}>Share with the assigned merchant. Treat this signature as an authorization to reserve the specified maximum.</p></div>}
 </>}
 </details>;
}
export function MerchantSignature({cova,canAct,execute}:{cova:CovaController;canAct:boolean;execute:(f:()=>Promise<void>)=>Promise<void>}) {
 const [packet,setPacket]=useState(cova.signedAuthorization ?? '');
 if(cova.demo || !cova.supportsSignedAuthorizations) return null;
 return <section className={styles.panel} aria-labelledby="submit-authorization-heading"><h3 id="submit-authorization-heading"><ShieldCheck size={17}/>Submit customer authorization</h3><p>Paste a customer signature addressed to your wallet. The contract validates the signer, expiry, nonce and available funds.</p><form onSubmit={e=>{e.preventDefault();void execute(()=>cova.submitAuthorization(packet));}}><div className="field"><label htmlFor="customer-authorization">Customer authorization JSON</label><textarea id="customer-authorization" className={styles.packet} value={packet} onChange={e=>setPacket(e.target.value)} maxLength={32768} required/></div><button className="button button-primary" type="submit" disabled={!canAct || !packet.trim()}>Submit authorization</button></form></section>;
}
