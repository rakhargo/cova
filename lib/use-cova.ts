'use client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useAccount, useConnect, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { decodeEventLog, erc20Abi, keccak256, toHex, type Hash, type Address, type TransactionReceipt } from 'viem';
import { covaConfig as config, configurationError } from './config';
import { vaultAbi } from './abi';
import { readSnapshot, verifyDeployment } from './chain';
import { DEMO_CUSTOMER, DEMO_MERCHANT, demoTransition, initialDemoState, type DemoAction } from './demo';
import { friendlyError } from './errors';
import { parseAmount, validateHold } from './validation';
import { waitForCovaReceipt } from './transactions';
import type { CovaController, Hold, CreateHoldInput, TransactionState } from './types';

type HoldMetadata={description?:string;createHash?:Hash;captureHashes?:Hash[];releaseHash?:Hash};
const storageKey=`cova-receipts-${config.chainId}-${config.vault ?? 'demo'}`;
function metadata():Record<string,HoldMetadata> {
  try {return JSON.parse(localStorage.getItem(storageKey) || '{}');} catch {return {};}
}
function saveMetadata(id:Hash,patch:HoldMetadata) {
  try {const data=metadata();data[id]={...data[id],...patch};localStorage.setItem(storageKey,JSON.stringify(data));} catch { /* Onchain discovery works without browser storage. */ }
}
function enrich(holds:Hold[]) {
  const data=metadata();
  return holds.map(h=>{
    const extra=data[h.id];
    if(!extra) return h;
    // Browser storage supplies display references and links only. Money and status
    // always remain the values returned by the contract.
    return {...h,description:typeof extra.description==='string'?extra.description:h.description,
      createHash:extra.createHash,captureHashes:extra.captureHashes,releaseHash:extra.releaseHash};
  });
}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const subscribe=()=>()=>{};
export function useCova():CovaController {
  const hydrated=useSyncExternalStore(subscribe,()=>true,()=>false);
  const demo=config.demo && !configurationError;
  const account=useAccount();
  const connection=useConnect(); const disconnection=useDisconnect(); const switching=useSwitchChain();
  const writer=useWriteContract();
  const client=usePublicClient({chainId:config.chainId});
  const [demoState,setDemoState]=useState(initialDemoState);
  const demoRef=useRef(demoState);
  const [transaction,setTransaction]=useState<TransactionState>({status:'idle',label:''});
  const lock=useRef(false);
  const wrongChain=account.isConnected && account.chainId!==config.chainId;
  const deployment=useQuery({queryKey:['cova-deployment',config.chainId,config.vault,config.token],queryFn:()=>verifyDeployment(client!,config),enabled:!demo && !configurationError && !!client,staleTime:60_000,retry:1});
  const balances=useQuery({queryKey:['cova-state',config.chainId,config.vault,account.address],queryFn:()=>readSnapshot(client!,config,account.address!),enabled:!demo && !wrongChain && !!account.address && !!deployment.data,refetchInterval:5_000,retry:1});
  const decimals=deployment.data?.decimals ?? 6;
  const readError=deployment.error?friendlyError(deployment.error):balances.error?friendlyError(balances.error):undefined;
  const ready=hydrated && !configurationError && (demo || (!!balances.data && !!deployment.data && !readError && !wrongChain && account.isConnected));
  function refresh() {
    if(!demo && !configurationError) void deployment.refetch().then(result=>{
      if(result.data && account.address) void balances.refetch();
    });
  }
  async function operation(label:string,task:()=>Promise<void>,requiresReady=true) {
    if(lock.current) return;
    lock.current=true;setTransaction({status:'awaiting-wallet',label});
    try {
      if(configurationError) throw new Error(configurationError);
      if(requiresReady && !ready) throw new Error(wrongChain?'Switch to the Cova network before continuing.':readError || 'Connect your wallet and wait for balances to load.');
      await task();
    } catch(error) {setTransaction(previous=>({...previous,status:'failed',error:friendlyError(error)}));}
    finally {lock.current=false;}
  }
  async function simulated(action:DemoAction) {
    // Validate before animation; apply once at confirmation. No fabricated hashes.
    const next=demoTransition(demoRef.current,action);
    setTransaction(t=>({...t,status:'pending',label:`${t.label} · simulation`}));
    await pause(220);
    demoRef.current=next;setDemoState(next);
    setTransaction(t=>({...t,status:'confirmed'}));
  }
  async function sendVault(functionName:'deposit'|'withdraw'|'createHold'|'capture'|'release'|'releaseExpired',args:readonly unknown[]):Promise<TransactionReceipt> {
    if(!client || !account.address || !config.vault) throw new Error('Connect your wallet first.');
    // viem narrows the union of six method signatures through the ABI; the runtime
    // simulation validates the selected signature and arguments before requesting a wallet write.
    const request=await client.simulateContract({address:config.vault,abi:vaultAbi,functionName,args:args as never,account:account.address});
    const hash=await writer.writeContractAsync({...request.request,chainId:config.chainId});
    return confirm(hash);
  }
  async function confirm(hash:Hash) {
    setTransaction(t=>({...t,status:'submitted',hash}));
    await pause(100);
    setTransaction(t=>({...t,status:'pending'}));
    const receipt=await waitForCovaReceipt(args=>client!.waitForTransactionReceipt(args),hash,
      replacementHash=>setTransaction(t=>({...t,hash:replacementHash})));
    await balances.refetch();
    setTransaction(t=>({...t,status:'confirmed'}));
    return receipt;
  }
  async function approve(value:string) {await operation('Approve USDG',async()=>{
    const amount=parseAmount(value,decimals);
    if(demo) {await simulated({type:'approve',amount});return;}
    if(!client || !account.address || !config.vault) throw new Error('Connect your wallet first.');
    const request=await client.simulateContract({address:config.token,abi:erc20Abi,functionName:'approve',args:[config.vault,amount],account:account.address});
    const hash=await writer.writeContractAsync({...request.request,chainId:config.chainId});
    await confirm(hash);
  });}
  async function deposit(value:string) {await operation('Deposit USDG',async()=>{
    const amount=parseAmount(value,decimals);
    if(demo) {await simulated({type:'deposit',amount});return;}
    if(amount>(balances.data?.walletBalance ?? 0n)) throw new Error('Insufficient wallet USDG. Obtain test USDG from the Paxos faucet.');
    if(amount>(balances.data?.allowance ?? 0n)) throw new Error('Approve this exact deposit amount first.');
    await sendVault('deposit',[amount]);
  });}
  async function withdraw(value:string) {await operation('Withdraw USDG',async()=>{
    const amount=parseAmount(value,decimals);
    if(demo) {await simulated({type:'withdraw',amount});return;}
    if(amount>(balances.data?.available ?? 0n)) throw new Error('Insufficient available Cova balance. Reserved funds cannot be withdrawn.');
    await sendVault('withdraw',[amount]);
  });}
  async function createHold(input:CreateHoldInput) {await operation('Authorize hold',async()=>{
    const valid=validateHold(input,decimals);
    // Chain timestamp is the authority for expiry; local time only drives display.
    const now=demo?Math.floor(Date.now()/1000):Number((await client!.getBlock()).timestamp);
    const expiresAt=now+valid.expiryMinutes*60;
    if(demo) {await simulated({type:'create',merchant:valid.merchant,amount:valid.amount,expiresAt,description:valid.description});return;}
    if(valid.amount>(balances.data?.available ?? 0n)) throw new Error('Insufficient available Cova balance. Deposit USDG first.');
    const referenceId=keccak256(toHex(valid.description));
    const receipt=await sendVault('createHold',[valid.merchant,valid.amount,BigInt(expiresAt),referenceId]);
    for(const log of receipt.logs) {
      if(log.address.toLowerCase()!==config.vault!.toLowerCase()) continue;
      try {
        const event=decodeEventLog({abi:vaultAbi,data:log.data,topics:log.topics,eventName:'HoldCreated'});
        saveMetadata(event.args.holdId,{description:valid.description,createHash:receipt.transactionHash});
      } catch { /* Ignore other vault events. */ }
    }
    refresh();
  });}
  async function capture(id:Hash,value:string) {await operation('Capture USDG',async()=>{
    const amount=parseAmount(value,decimals);
    if(demo) {await simulated({type:'capture',id,amount,actor:DEMO_MERCHANT});return;}
    const hold=balances.data?.merchantHolds.find(h=>h.id===id);
    if(!hold || hold.merchant.toLowerCase()!==account.address?.toLowerCase()) throw new Error('Connect the authorized merchant wallet to capture.');
    if(hold.status!==1) throw new Error('This hold is already settled.');
    if(amount>hold.authorizedAmount-hold.capturedAmount) throw new Error('Capture exceeds the remaining authorization.');
    const receipt=await sendVault('capture',[id,amount]);
    saveMetadata(id,{captureHashes:[...(metadata()[id]?.captureHashes ?? []),receipt.transactionHash]});refresh();
  });}
  async function release(id:Hash) {await operation('Release remaining USDG',async()=>{
    if(demo) {await simulated({type:'release',id,actor:DEMO_MERCHANT});return;}
    const hold=balances.data?.merchantHolds.find(h=>h.id===id);
    if(!hold || hold.merchant.toLowerCase()!==account.address?.toLowerCase()) throw new Error('Connect the authorized merchant wallet to release before expiry.');
    const receipt=await sendVault('release',[id]);saveMetadata(id,{releaseHash:receipt.transactionHash});refresh();
  });}
  async function releaseExpired(id:Hash) {await operation('Release expired USDG',async()=>{
    if(demo) {await simulated({type:'expired',id});return;}
    const receipt=await sendVault('releaseExpired',[id]);saveMetadata(id,{releaseHash:receipt.transactionHash});refresh();
  });}
  async function connect() {await operation('Connect wallet',async()=>{
    if(!connection.connectors[0]) throw new Error('Install an injected EVM wallet, then reload Cova.');
    await connection.connectAsync({connector:connection.connectors[0]});setTransaction({status:'idle',label:''});
  },false);}
  async function switchChain() {await operation('Switch network',async()=>{
    await switching.switchChainAsync({chainId:config.chainId});setTransaction({status:'idle',label:''});
  },false);}
  return {
    demo:demo,local:config.local,ready,configError:configurationError,readError,
    address:demo?DEMO_CUSTOMER:account.address as Address|undefined,connected:demo || account.isConnected,
    wrongChain:demo?false:wrongChain,chainName:config.local?'Local Anvil':'Arbitrum Sepolia',decimals,
    available:demo?demoState.available:balances.data?.available ?? 0n,reserved:demo?demoState.reserved:balances.data?.reserved ?? 0n,
    walletBalance:demo?demoState.walletBalance:balances.data?.walletBalance ?? 0n,allowance:demo?demoState.allowance:balances.data?.allowance ?? 0n,
    customerHolds:demo?demoState.holds:enrich(balances.data?.customerHolds ?? []),
    merchantHolds:demo?demoState.holds:enrich(balances.data?.merchantHolds ?? []),transaction,
    chainTime:balances.data?balances.data.blockTimestamp+Math.max(0,Math.floor(Date.now()/1000)-balances.data.fetchedAt):undefined,
    busy:!hydrated || ['awaiting-wallet','submitted','pending'].includes(transaction.status),loading:!hydrated || (!demo && (deployment.isLoading || balances.isLoading)),
    connect,disconnect:()=>disconnection.disconnect(),switchChain,refresh,approve,deposit,withdraw,createHold,capture,release,releaseExpired,
    resetDemo:()=>{if(lock.current)return;const next=initialDemoState();demoRef.current=next;setDemoState(next);setTransaction({status:'idle',label:''});},
    explorerTx:hash=>demo || config.local?undefined:`https://sepolia.arbiscan.io/tx/${hash}`
  };
}
