'use client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useAccount, useConnect, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { getWalletClient } from '@wagmi/core';
import { walletConfig } from './wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { decodeEventLog, erc20Abi, keccak256, toHex, type Hash, type Address, type TransactionReceipt } from 'viem';
import { covaConfig as config, configurationError } from './config';
import { createCovaClient, encodeSignedAuthorization, decodeSignedAuthorization, readHoldHistory, type HoldReceipt } from '../sdk/dist/index.js';
import { visibleSignature,clearOwnSignature,type PendingSignature } from './signature-state';
import { mergeHistory,reconcileHistory,type HistorySnapshot } from './history';
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
function enrich(holds:Hold[], receipts:Record<string,HoldReceipt>={}) {
 const data=metadata();
 return holds.map(h=>{
  const extra=data[h.id];
  const local=typeof extra?.description==='string' && keccak256(toHex(extra.description)).toLowerCase()===h.referenceId.toLowerCase()?extra.description:undefined;
  const known=['Court booking','Court Booking','Camera rental','Camera Rental','EV charging','EV Charging'].find(label=>keccak256(toHex(label)).toLowerCase()===h.referenceId.toLowerCase());
  return {...h,description:local ?? known ?? h.description,createHash:receipts[h.id]?.createHash,captureHashes:receipts[h.id]?.captureHashes,releaseHash:receipts[h.id]?.releaseHash};
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
  const [pendingSignature,setPendingSignature]=useState<PendingSignature>();
  const signatureContext=account.address && config.vault?{customer:account.address,chainId:config.chainId,vault:config.vault}:undefined;
  const signedAuthorization=visibleSignature(pendingSignature,signatureContext);
  const client=usePublicClient({chainId:config.chainId});
  const [demoState,setDemoState]=useState(initialDemoState);
  const demoRef=useRef(demoState);
  const [transaction,setTransaction]=useState<TransactionState>({status:'idle',label:''});
  const lock=useRef(false);
  const wrongChain=account.isConnected && account.chainId!==config.chainId;
  const deployment=useQuery({queryKey:['cova-deployment',config.chainId,config.vault,config.token],queryFn:()=>verifyDeployment(client!,config),enabled:!demo && !configurationError && !!client,staleTime:60_000,retry:1});
  const balances=useQuery({queryKey:['cova-state',config.chainId,config.vault,account.address],queryFn:()=>readSnapshot(client!,config,account.address!),enabled:!demo && !wrongChain && !!account.address && !!deployment.data,refetchInterval:5_000,retry:1});
  const queryClient=useQueryClient();
  const ids=[...new Set([...(balances.data?.customerHolds ?? []),...(balances.data?.merchantHolds ?? [])].map(h=>h.id))];
  const snapshotEpoch=queryClient.getQueryState(['cova-state',config.chainId,config.vault,account.address])?.dataUpdateCount ?? 0;
  const historyCursorKey=['cova-history-cursor',config.chainId,config.vault,account.address];
  const history=useQuery({
    queryKey:['cova-history',config.chainId,config.vault,account.address,balances.data?.blockNumber.toString(),ids.join(',')],
    enabled:!demo && !!client && !!config.vault && !!account.address && !!balances.data && ids.length>0 && config.deploymentBlock!==undefined,
    refetchInterval:15_000,retry:1,
    queryFn:async()=>{
      const previous=queryClient.getQueryData<HistorySnapshot>(historyCursorKey);
      const priorHead=previous?previous.scannedThrough>balances.data!.blockNumber?balances.data!.blockNumber:previous.scannedThrough:config.deploymentBlock!;
      const start=priorHead>config.deploymentBlock!+2n?priorHead-2n:config.deploymentBlock!;
      const result=await readHoldHistory(client!,config.vault!,ids,{fromBlock:start,toBlock:balances.data!.blockNumber,chunkSize:2000n,maxRequests:40});
      const merged=mergeHistory(previous,result,start,ids,balances.data!.blockNumber);
      const newer=queryClient.getQueryData<HistorySnapshot>(historyCursorKey);
      const chosen=reconcileHistory(merged,newer,snapshotEpoch);
      queryClient.setQueryData(historyCursorKey,chosen);
      return chosen;
    }
  });
  const decimals=deployment.data?.decimals ?? 6;
  const readError=deployment.error?friendlyError(deployment.error):balances.error?friendlyError(balances.error):undefined;
  const ready=hydrated && !configurationError && (demo || (!!balances.data && !!deployment.data && !readError && !wrongChain && account.isConnected));
  function refresh() {
    if(!demo && !configurationError) void deployment.refetch().then(result=>{
      if(result.data && account.address) void balances.refetch();
      if(ids.length>0 && config.deploymentBlock!==undefined) void history.refetch();
    });
  }
  async function operation(label:string,task:()=>Promise<void>,requiresReady=true,kind:'signature'|'transaction'='transaction') {
    if(lock.current) return;
    lock.current=true;setTransaction({status:'awaiting-wallet',label,kind});
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
  async function sendVault(functionName:'deposit'|'withdraw'|'createHold'|'capture'|'release'|'releaseExpired'|'authorizeHold'|'invalidateAuthorizations',args:readonly unknown[]):Promise<TransactionReceipt> {
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
  async function signAuthorization(input:CreateHoldInput) {await operation('Sign authorization',async()=>{
    if(demo || deployment.data?.protocolVersion!==2) throw new Error('Signed authorization requires a version 2 vault.');
    const valid=validateHold(input,decimals);
    if(valid.amount>(balances.data?.available ?? 0n)) throw new Error('Deposit sufficient USDG before signing this authorization.');
    const walletClient=await getWalletClient(walletConfig,{account:account.address!,chainId:config.chainId});
    const sdk=createCovaClient({publicClient:client!,walletClient,vault:config.vault!,chainId:config.chainId,token:config.token});
    const block=await client!.getBlock();
    const authorization=await sdk.prepareAuthorization({customer:account.address!,merchant:valid.merchant,maxAmount:valid.amount,expiresAt:block.timestamp+BigInt(valid.expiryMinutes*60),referenceId:keccak256(toHex(valid.description))});
    const envelope=await sdk.signAuthorization(authorization);
    setPendingSignature({customer:authorization.customer,chainId:config.chainId,vault:config.vault!,json:encodeSignedAuthorization({...envelope,description:valid.description})});
    setTransaction({status:'confirmed',kind:'signature',label:'Signature ready. Funds are reserved only after merchant submission.'});
  },true,'signature');}
  async function submitAuthorization(json:string) {await operation('Submit authorization',async()=>{
    if(demo || deployment.data?.protocolVersion!==2) throw new Error('Signed authorization requires a version 2 vault.');
    const packet=decodeSignedAuthorization(json);
    if(packet.chainId!==config.chainId || packet.vault.toLowerCase()!==config.vault!.toLowerCase()) throw new Error('Authorization targets another network or vault.');
    if(packet.authorization.merchant.toLowerCase()!==account.address?.toLowerCase()) throw new Error('Connect the merchant wallet named in this authorization.');
    const receipt=await sendVault('authorizeHold',[packet.authorization,packet.signature]);
    for(const log of receipt.logs) {if(log.address.toLowerCase()!==config.vault!.toLowerCase())continue;try{
      const event=decodeEventLog({abi:vaultAbi,data:log.data,topics:log.topics,eventName:'HoldCreated'});
      saveMetadata(event.args.holdId,{description:packet.description,createHash:receipt.transactionHash});
    }catch{}}
    setPendingSignature(undefined);refresh();
  });}
  async function invalidateAuthorizations() {await operation('Invalidate pending signatures',async()=>{
    if(demo || deployment.data?.protocolVersion!==2) throw new Error('Signature invalidation requires a version 2 vault.');
    const nonce=await client!.readContract({address:config.vault!,abi:vaultAbi,functionName:'nonces',args:[account.address!]});
    if(nonce>=(1n<<256n)-2n) throw new Error('The authorization nonce cannot advance further.');
    await sendVault('invalidateAuthorizations',[nonce+1n]);setPendingSignature(previous=>clearOwnSignature(previous,{customer:account.address!,chainId:config.chainId,vault:config.vault!}));
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
    protocolVersion:deployment.data?.protocolVersion ?? 0,supportsSignedAuthorizations:!demo && deployment.data?.protocolVersion===2,signedAuthorization,signAuthorization,submitAuthorization,invalidateAuthorizations,receiptHistoryLoading:history.isFetching,receiptHistoryError:history.error?'Could not read receipt history.':history.data?.error || (!demo && ids.length>0 && config.deploymentBlock===undefined?'Configure the vault deployment block to load shared receipts.':undefined),
    address:demo?DEMO_CUSTOMER:account.address as Address|undefined,connected:demo || account.isConnected,
    wrongChain:demo?false:wrongChain,chainName:config.local?'Local Anvil':'Arbitrum Sepolia',decimals,
    available:demo?demoState.available:balances.data?.available ?? 0n,reserved:demo?demoState.reserved:balances.data?.reserved ?? 0n,
    walletBalance:demo?demoState.walletBalance:balances.data?.walletBalance ?? 0n,allowance:demo?demoState.allowance:balances.data?.allowance ?? 0n,
    customerHolds:demo?demoState.holds:enrich(balances.data?.customerHolds ?? [],history.data?.receipts),
    merchantHolds:demo?demoState.holds:enrich(balances.data?.merchantHolds ?? [],history.data?.receipts),transaction,
    chainTime:balances.data?balances.data.blockTimestamp+Math.max(0,Math.floor(Date.now()/1000)-balances.data.fetchedAt):undefined,
    busy:!hydrated || ['awaiting-wallet','submitted','pending'].includes(transaction.status),loading:!hydrated || (!demo && (deployment.isLoading || balances.isLoading)),
    connect,disconnect:()=>disconnection.disconnect(),switchChain,refresh,approve,deposit,withdraw,createHold,capture,release,releaseExpired,
    resetDemo:()=>{if(lock.current)return;const next=initialDemoState();demoRef.current=next;setDemoState(next);setTransaction({status:'idle',label:''});},
    explorerTx:hash=>demo || config.local?undefined:`https://sepolia.arbiscan.io/tx/${hash}`
  };
}
