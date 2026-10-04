import {
  getAbiItem, getAddress, hashTypedData, type Abi, type Address, type Hash,
  type Hex, type PublicClient, type WalletClient, type WaitForTransactionReceiptParameters,
} from 'viem';
import { sessionRouterAbi } from './session-abi.js';
import { vaultAbi } from './abi.js';
import { authorizationTypes, checkedAddress, checkedHash, checkedUint, type HoldAuthorization } from './authorization.js';
import { safeCall, safeErrorMessage } from './errors.js';

export type SessionQuote={sessionId:Hash;customer:Address;provider:Address;serviceId:Hash;ratePerMinute:bigint;maxAmount:bigint;maxDurationSeconds:number;startBy:bigint;holdExpiresAt:bigint};
export type SessionRecord={status:0|1|2|3;quoteDigest:Hash;holdId:Hash;customer:Address;provider:Address;ratePerMinute:bigint;maxAmount:bigint;chargedAmount:bigint;returnedAmount:bigint;maxDurationSeconds:number;startedAt:bigint;stoppedAt:bigint};
export type SessionReceipt={sessionId:Hash;startHash?:Hash;settlementHash?:Hash;record:SessionRecord};
export type SessionHistoryOptions={fromBlock:bigint;toBlock?:bigint;chunkSize?:bigint;maxRequests?:number};
export type SessionHistoryResult={sessions:SessionReceipt[];scannedThrough:bigint;complete:boolean;error?:string};
export const sessionQuoteTypes={SessionQuote:[
  {name:'sessionId',type:'bytes32'},{name:'customer',type:'address'},{name:'provider',type:'address'},
  {name:'serviceId',type:'bytes32'},{name:'ratePerMinute',type:'uint128'},{name:'maxAmount',type:'uint128'},
  {name:'maxDurationSeconds',type:'uint32'},{name:'startBy',type:'uint64'},{name:'holdExpiresAt',type:'uint64'}
]} as const;
export const sessionStopTypes={SessionStop:[{name:'sessionId',type:'bytes32'},{name:'validUntil',type:'uint64'}]} as const;
export function checkedSessionQuote(value:unknown,now=BigInt(Math.floor(Date.now()/1000))):SessionQuote {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('quote must be an object.');
  const q=value as Record<string,unknown>;
  const quote:SessionQuote={
    sessionId:checkedHash(q.sessionId,'sessionId'),customer:checkedAddress(q.customer,'customer'),
    provider:checkedAddress(q.provider,'provider'),serviceId:checkedHash(q.serviceId,'serviceId'),
    ratePerMinute:checkedUint(q.ratePerMinute,128,'ratePerMinute',true),maxAmount:checkedUint(q.maxAmount,128,'maxAmount',true),
    maxDurationSeconds:Number(checkedUint(typeof q.maxDurationSeconds==='number'?BigInt(q.maxDurationSeconds):q.maxDurationSeconds,32,'maxDurationSeconds',true)),
    startBy:checkedUint(q.startBy,64,'startBy',true),holdExpiresAt:checkedUint(q.holdExpiresAt,64,'holdExpiresAt',true)
  };
  if(quote.customer.toLowerCase()===quote.provider.toLowerCase()) throw new Error('customer and provider must differ.');
  if(quote.startBy<now) throw new Error('quote start deadline has passed.');
  if(quote.holdExpiresAt<=quote.startBy+BigInt(quote.maxDurationSeconds)) throw new Error('hold expiry needs a cleanup window after the maximum session duration.');
  const charge=quote.ratePerMinute*BigInt(quote.maxDurationSeconds)/60n;
  if(charge>quote.maxAmount) throw new Error('full-duration charge exceeds the quoted maximum.');
  return quote;
}
export function sessionQuoteDomain(chainId:number,router:Address) {
  if(!Number.isSafeInteger(chainId)||chainId<=0) throw new Error('chainId must be a positive safe integer.');
  return {name:'CovaSessionRouter',version:'1',chainId,verifyingContract:checkedAddress(router,'router')} as const;
}
export function sessionQuoteTypedData(chainId:number,router:Address,quote:SessionQuote) {
  return {domain:sessionQuoteDomain(chainId,router),types:sessionQuoteTypes,primaryType:'SessionQuote',message:checkedSessionQuote(quote)} as const;
}
export function sessionQuoteDigest(chainId:number,router:Address,quote:SessionQuote):Hash {return hashTypedData(sessionQuoteTypedData(chainId,router,quote));}
export function sessionStopTypedData(chainId:number,router:Address,sessionId:Hash,validUntil:bigint) {
  return {domain:sessionQuoteDomain(chainId,router),types:sessionStopTypes,primaryType:'SessionStop',message:{sessionId:checkedHash(sessionId,'sessionId'),validUntil:checkedUint(validUntil,64,'validUntil',true)}} as const;
}
function checkedSignature(signature:unknown,label:string):Hex {
  if(typeof signature!=='string'||!/^0x(?:[\da-f]{2})+$/i.test(signature)) throw new Error(`${label} must be non-empty hex bytes.`);
  return signature as Hex;
}
function record(raw:readonly unknown[]):SessionRecord {
  return {status:Number(raw[0]) as SessionRecord['status'],quoteDigest:raw[1] as Hash,holdId:raw[2] as Hash,customer:getAddress(raw[3] as Address),provider:getAddress(raw[4] as Address),ratePerMinute:raw[5] as bigint,maxAmount:raw[6] as bigint,chargedAmount:raw[7] as bigint,returnedAmount:raw[8] as bigint,maxDurationSeconds:Number(raw[9]),startedAt:raw[10] as bigint,stoppedAt:raw[11] as bigint};
}
export type SessionClientOptions={publicClient:PublicClient;walletClient?:WalletClient;router:Address;vault:Address;token:Address;chainId:number};
export function createCovaSessionClient(options:SessionClientOptions) {
  const {publicClient,chainId}=options;const router=checkedAddress(options.router,'router');const vault=checkedAddress(options.vault,'vault');const token=checkedAddress(options.token,'token');
  async function context(){
    if(publicClient.chain&&publicClient.chain.id!==chainId) throw new Error('Public client chain differs from the configured chain.');
    if(await publicClient.getChainId()!==chainId) throw new Error('RPC chain differs from the configured chain.');
    const [routerVault,routerToken,vaultToken,version,domain]=await Promise.all([
      publicClient.readContract({address:router,abi:sessionRouterAbi,functionName:'vault'}),publicClient.readContract({address:router,abi:sessionRouterAbi,functionName:'token'}),
      publicClient.readContract({address:vault,abi:vaultAbi,functionName:'token'}),publicClient.readContract({address:vault,abi:vaultAbi,functionName:'version'}),
      publicClient.readContract({address:router,abi:sessionRouterAbi,functionName:'eip712Domain'})
    ]);
    if(routerVault.toLowerCase()!==vault.toLowerCase()||routerToken.toLowerCase()!==token.toLowerCase()||vaultToken.toLowerCase()!==token.toLowerCase()||version!==2n) throw new Error('Router, vault and settlement token configuration does not match.');
    if(domain[1]!=='CovaSessionRouter'||domain[2]!=='1'||domain[3]!==BigInt(chainId)||domain[4].toLowerCase()!==router.toLowerCase()) throw new Error('Router EIP712 domain does not match this chain and address.');
  }
  async function actor(){
    const wallet=options.walletClient;if(!wallet)throw new Error('A wallet client is required for signing and transactions.');
    if(wallet.chain&&wallet.chain.id!==chainId||await wallet.getChainId()!==chainId)throw new Error('Wallet is on the wrong chain.');
    const addresses=await wallet.getAddresses();const account=checkedAddress(addresses[0],'wallet account');
    if(wallet.account&&wallet.account.address.toLowerCase()!==account.toLowerCase())throw new Error('Wallet account changed.');
    return {wallet,account:wallet.account??account,address:account};
  }
  async function simulateWrite(functionName:string,args:readonly unknown[]) {
    await context();const signer=await actor();
    const simulation=await publicClient.simulateContract({address:router,abi:sessionRouterAbi as Abi,functionName,args,account:signer.address});
    return signer.wallet.writeContract({...simulation.request,account:signer.account,chain:signer.wallet.chain});
  }
  const client={
    protocolVersion:()=>safeCall(async()=>{await context();return 1 as const;}),
    quote:(quote:SessionQuote)=>safeCall(async()=>{const value=checkedSessionQuote(quote);await context();return {quote:value,digest:sessionQuoteDigest(chainId,router,value)};}),
    signQuote:(quote:SessionQuote)=>safeCall(async()=>{const value=checkedSessionQuote(quote);await context();const signer=await actor();if(signer.address.toLowerCase()!==value.provider.toLowerCase())throw new Error('Provider wallet must match the quote provider.');return signer.wallet.signTypedData({...sessionQuoteTypedData(chainId,router,value),account:signer.account});}),
    prepareStart:(quote:SessionQuote)=>safeCall(async()=>{const q=checkedSessionQuote(quote);await context();const signer=await actor();if(signer.address.toLowerCase()!==q.customer.toLowerCase())throw new Error('Customer wallet must match the quote customer.');const blockNumber=await publicClient.getBlockNumber({cacheTime:0});const [nonce,available,block]=await Promise.all([publicClient.readContract({address:vault,abi:vaultAbi,functionName:'nonces',args:[signer.address],blockNumber}),publicClient.readContract({address:vault,abi:vaultAbi,functionName:'availableBalance',args:[signer.address],blockNumber}),publicClient.getBlock({blockNumber})]);if(block.timestamp>q.startBy)throw new Error('Quote start deadline has passed.');if(available<q.maxAmount)throw new Error('Insufficient Cova available balance for the session maximum.');return {customer:signer.address,merchant:router,maxAmount:q.maxAmount,expiresAt:q.holdExpiresAt,nonce,referenceId:sessionQuoteDigest(chainId,router,q)} satisfies HoldAuthorization;}),
    signStart:(quote:SessionQuote,providerSignature:Hex)=>safeCall(async()=>{const q=checkedSessionQuote(quote);const providerSig=checkedSignature(providerSignature,'providerSignature');await context();const signer=await actor();if(signer.address.toLowerCase()!==q.customer.toLowerCase())throw new Error('Customer wallet must match the quote customer.');const blockNumber=await publicClient.getBlockNumber({cacheTime:0});const [nonce,available,block]=await Promise.all([publicClient.readContract({address:vault,abi:vaultAbi,functionName:'nonces',args:[signer.address],blockNumber}),publicClient.readContract({address:vault,abi:vaultAbi,functionName:'availableBalance',args:[signer.address],blockNumber}),publicClient.getBlock({blockNumber})]);if(block.timestamp>q.startBy)throw new Error('Quote start deadline has passed.');if(available<q.maxAmount)throw new Error('Insufficient Cova available balance for the session maximum.');const authorization:HoldAuthorization={customer:signer.address,merchant:router,maxAmount:q.maxAmount,expiresAt:q.holdExpiresAt,nonce,referenceId:sessionQuoteDigest(chainId,router,q)};const signature=await signer.wallet.signTypedData({domain:{name:'CovaVault',version:'2',chainId,verifyingContract:vault},types:authorizationTypes,primaryType:'HoldAuthorization',message:authorization,account:signer.account});await publicClient.simulateContract({address:router,abi:sessionRouterAbi,functionName:'startSession',args:[q,providerSig,authorization,signature],account:signer.address});return {authorization,signature};}),
    start:(quote:SessionQuote,providerSignature:Hex,authorization:HoldAuthorization,customerSignature:Hex)=>safeCall(async()=>{const q=checkedSessionQuote(quote);const sig=checkedSignature(providerSignature,'providerSignature');const auth={...authorization,customer:checkedAddress(authorization.customer,'authorization customer'),merchant:checkedAddress(authorization.merchant,'authorization merchant'),maxAmount:checkedUint(authorization.maxAmount,128,'maxAmount',true),expiresAt:checkedUint(authorization.expiresAt,64,'expiresAt',true),nonce:checkedUint(authorization.nonce,256,'nonce'),referenceId:checkedHash(authorization.referenceId,'referenceId')};if(auth.customer.toLowerCase()!==q.customer.toLowerCase()||auth.merchant.toLowerCase()!==router.toLowerCase()||auth.maxAmount!==q.maxAmount||auth.expiresAt!==q.holdExpiresAt||auth.referenceId.toLowerCase()!==sessionQuoteDigest(chainId,router,q).toLowerCase())throw new Error('Customer authorization does not match the signed session quote.');return simulateWrite('startSession',[q,sig,auth,checkedSignature(customerSignature,'customerSignature')]);}),
    stop:(sessionId:Hash)=>safeCall(()=>simulateWrite('stopSession',[checkedHash(sessionId,'sessionId')])),
    signStop:(sessionId:Hash,validUntil:bigint)=>safeCall(async()=>{await context();const signer=await actor();const id=checkedHash(sessionId,'sessionId');const current=record(await publicClient.readContract({address:router,abi:sessionRouterAbi,functionName:'sessions',args:[id]}));if(current.status!==1||current.customer.toLowerCase()!==signer.address.toLowerCase())throw new Error('Only the active session customer can sign a stop.');const deadline=checkedUint(validUntil,64,'validUntil',true);return signer.wallet.signTypedData({...sessionStopTypedData(chainId,router,id,deadline),account:signer.account});}),
    submitStop:(sessionId:Hash,validUntil:bigint,signature:Hex)=>safeCall(()=>simulateWrite('stopSessionWithSignature',[checkedHash(sessionId,'sessionId'),checkedUint(validUntil,64,'validUntil',true),checkedSignature(signature,'customerSignature')])),
    settleAtMaxDuration:(sessionId:Hash)=>safeCall(()=>simulateWrite('settleAtMaxDuration',[checkedHash(sessionId,'sessionId')])),
    expireSession:(sessionId:Hash)=>safeCall(()=>simulateWrite('expireSession',[checkedHash(sessionId,'sessionId')])),
    session:(sessionId:Hash):Promise<SessionRecord>=>safeCall(async()=>{await context();const raw=await publicClient.readContract({address:router,abi:sessionRouterAbi,functionName:'sessions',args:[checkedHash(sessionId,'sessionId') ]});return record(raw);}),
    waitForReceipt:(hash:Hash,params:Omit<WaitForTransactionReceiptParameters,'hash'>={})=>safeCall(async()=>{await context();const result=await publicClient.waitForTransactionReceipt({hash,...params});if(result.status!=='success')throw new Error('Session transaction reverted.');return result;}),
    history:(owner:Address,role:'customer'|'provider',opts:SessionHistoryOptions):Promise<SessionHistoryResult>=>safeCall(()=>readSessionHistory(publicClient,router,owner,role,opts))
  };
  return client;
}
export async function readSessionHistory(client:PublicClient,router:Address,owner:Address,role:'customer'|'provider',options:SessionHistoryOptions):Promise<SessionHistoryResult>{
  const address=checkedAddress(router,'router');const account=checkedAddress(owner,'owner');if(role!=='customer'&&role!=='provider')throw new Error('role must be customer or provider.');
  if(typeof options.fromBlock!=='bigint'||options.fromBlock<0n)throw new Error('fromBlock must be a nonnegative bigint.');
  const head=options.toBlock??await client.getBlockNumber({cacheTime:0});const chunk=options.chunkSize??2000n;const max=options.maxRequests??40;
  if(head<options.fromBlock||chunk<1n||!Number.isSafeInteger(max)||max<1)throw new Error('Invalid bounded history range.');
  let cursor=options.fromBlock;let scanned=cursor-1n;let requests=0;let error:string|undefined;const hashes=new Map<string,{id:Hash;start?:Hash;settle?:Hash}>();
  const eventAbis=[getAbiItem({abi:sessionRouterAbi,name:'SessionStarted'}),getAbiItem({abi:sessionRouterAbi,name:'SessionSettled'}),getAbiItem({abi:sessionRouterAbi,name:'SessionExpired'})] as const;
  while(cursor<=head){if(requests>=max){error='History request budget exhausted; resume after scannedThrough.';break;}const end=cursor+chunk-1n<head?cursor+chunk-1n:head;requests++;try{const logs=await client.getLogs({address,events:eventAbis,fromBlock:cursor,toBlock:end,strict:true});for(const log of logs){if(log.removed||!log.transactionHash||!log.blockNumber)continue;const id=log.args.sessionId as Hash;const entry=hashes.get(id.toLowerCase())??{id};if(log.eventName==='SessionStarted')entry.start=log.transactionHash;else entry.settle=log.transactionHash;hashes.set(id.toLowerCase(),entry);}scanned=end;cursor=end+1n;}catch(cause){error=safeErrorMessage(cause);break;}}
  const ids=role==='customer'?'getCustomerSessionIds':'getProviderSessionIds';const receipts:SessionReceipt[]=[];
  for(const entry of hashes.values()){try{const session=record(await client.readContract({address,abi:sessionRouterAbi,functionName:'sessions',args:[entry.id]}));if((role==='customer'?session.customer:session.provider).toLowerCase()===account.toLowerCase())receipts.push({sessionId:entry.id,startHash:entry.start,settlementHash:entry.settle,record:session});}catch(cause){error??=safeErrorMessage(cause);}}
  // Include current records even when old deployments or pruned RPC history omit logs.
  try{for(let offset=0n;offset<100_000n;offset+=100n){const page=await client.readContract({address,abi:sessionRouterAbi,functionName:ids,args:[account,offset,100n]});for(const id of page){if(receipts.some(item=>item.sessionId.toLowerCase()===id.toLowerCase()))continue;const session=record(await client.readContract({address,abi:sessionRouterAbi,functionName:'sessions',args:[id]}));receipts.push({sessionId:id,record:session});}if(page.length<100)break;}}catch(cause){error??=safeErrorMessage(cause);}
  receipts.sort((a,b)=>a.record.startedAt<b.record.startedAt?1:a.record.startedAt>b.record.startedAt?-1:0);
  return {sessions:receipts,scannedThrough:scanned,complete:cursor>head&&!error,...(error?{error}:{})};
}
