export const LIVE_URL=process.env.COVA_E2E_LIVE_URL || 'http://127.0.0.1:3101';
export const LOCAL_RPC=process.env.COVA_LOCAL_RPC_URL || 'http://127.0.0.1:8545';
import type { Page } from '@playwright/test';
import type { Address } from 'viem';
export async function injectedWallet(page:Page, info:{customer:Address;merchant:Address}) {
  await page.addInitScript(({customer,merchant,rpc})=>{
    let active=customer;let chain='0x1';let rejectNext=false;
    const listeners=new Map<string,Set<(value:unknown)=>void>>();
    const emit=(event:string,value:unknown)=>listeners.get(event)?.forEach(fn=>fn(value));
    const target=window as unknown as Record<string,unknown>;
    target.ethereum={
      isMetaMask:true,
      on:(event:string,fn:(value:unknown)=>void)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn);},
      removeListener:(event:string,fn:(value:unknown)=>void)=>listeners.get(event)?.delete(fn),
      request:async({method,params=[]}:{method:string;params:unknown[]})=>{
        if(method==='eth_accounts' || method==='eth_requestAccounts') return [active];
        if(method==='eth_chainId') return chain;
        if(method==='wallet_switchEthereumChain' || method==='wallet_addEthereumChain') {chain='0x7a69';emit('chainChanged',chain);return null;}
        if(method==='eth_signTypedData_v4' && typeof params[1]==='string') params=[params[0],JSON.parse(params[1] as string)];
        if(method==='eth_sendTransaction' || method==='eth_signTypedData_v4') {
          if(rejectNext) {rejectNext=false;throw Object.assign(new Error('User rejected request'),{code:4001});}
          const from=method==='eth_sendTransaction'?(params[0] as {from:string}).from:params[0] as string;
          if(from.toLowerCase()!==active.toLowerCase()) throw new Error('Unauthorized local signer');
        }
        const response=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
        const result=await response.json();if(result.error) throw Object.assign(new Error(result.error.message),{code:result.error.code});return result.result;
      }
    };
    target.covaSetWallet=(role:'customer'|'merchant')=>{active=role==='customer'?customer:merchant;emit('accountsChanged',[active]);};
    target.covaRejectNext=()=>{rejectNext=true;};
  },{customer:info.customer,merchant:info.merchant,rpc:LOCAL_RPC});
}
