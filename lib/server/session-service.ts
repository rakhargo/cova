import {
  createPublicClient, createWalletClient, defineChain, hashTypedData, http, keccak256, parseAbi, toHex,
  verifyTypedData, type Address, type Hash, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sessionRouterAbi, vaultAbi, checkedSessionQuote, sessionQuoteTypedData, checkedHash, checkedUint, type SessionQuote } from '@/sdk/dist/index.js';
import { OFFICIAL_USDG } from '@/lib/config';

const routerAddress = process.env.COVA_SESSION_ROUTER_ADDRESS;
const vaultAddress = process.env.COVA_SESSION_VAULT_ADDRESS;
const tokenAddress = process.env.COVA_SESSION_TOKEN_ADDRESS;
const rpcUrl = process.env.COVA_SESSION_RPC_URL;
const chainId = Number(process.env.COVA_SESSION_CHAIN_ID || '421614');
const allowedChain = chainId === 421614 ? defineChain({id:421614,name:'Arbitrum Sepolia',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://sepolia-rollup.arbitrum.io/rpc']}}})
  : chainId === 31337 ? defineChain({id:31337,name:'Local Anvil',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['http://127.0.0.1:8545']}}}) : undefined;
const ratePerMinute = BigInt(process.env.COVA_SESSION_RATE_PER_MINUTE || '500000');
const maxDuration = Number(process.env.COVA_SESSION_MAX_DURATION_SECONDS || '2400');
const startWindow = Number(process.env.COVA_SESSION_START_WINDOW_SECONDS || '300');
const settlementGrace = Number(process.env.COVA_SESSION_SETTLEMENT_GRACE_SECONDS || '3600');
const providerKey = process.env.COVA_SESSION_PROVIDER_PRIVATE_KEY;
const relayerKey = process.env.COVA_SESSION_RELAYER_PRIVATE_KEY;
const bodyLimit = 32_768;
const processRelayLimit = Number(process.env.COVA_SESSION_PER_PROCESS_RELAY_LIMIT || '100');
const requests = new Map<string,{window:number;count:number}>();
let relayBudget={period:'',count:0};

export type SessionServiceError=Error&{status:number;code:string;transactionHash?:Hash};
function failure(status:number,code:string,message:string,details:Partial<SessionServiceError>={}):never {throw Object.assign(new Error(message),{status,code,...details});}
function address(value:string|undefined,label:string):Address {
  if(!value||!/^0x[\da-f]{40}$/i.test(value)||/^0x0{40}$/i.test(value))throw failure(503,'SESSION_DISABLED',`Session checkout is unavailable: ${label} is not configured.`);
  return value as Address;
}
function secretAccount(key:string|undefined,label:string) {
  if(!key||!/^0x[\da-f]{64}$/i.test(key))throw failure(503,'SESSION_DISABLED',`Session checkout is unavailable: ${label} credentials are not configured.`);
  try{return privateKeyToAccount(key as Hex);}catch{return failure(503,'SESSION_DISABLED',`Session checkout is unavailable: ${label} credentials are invalid.`);}
}
export function sessionServiceConfigured(){return Boolean(routerAddress&&vaultAddress&&tokenAddress&&providerKey&&relayerKey);}
function env() {
  if(!allowedChain||!routerAddress||!vaultAddress||!tokenAddress||!providerKey||!relayerKey)throw failure(503,'SESSION_DISABLED','Timed sessions are not configured on this deployment.');
  const router=address(routerAddress,'router address');const vault=address(vaultAddress,'vault address');const token=address(tokenAddress,'token address');
  if(chainId===421614&&token.toLowerCase()!==OFFICIAL_USDG.toLowerCase())throw failure(503,'SESSION_DISABLED','Arbitrum Sepolia sessions must use official Paxos USDG.');
  if(ratePerMinute<=0n||ratePerMinute>=(1n<<128n)||!Number.isSafeInteger(maxDuration)||maxDuration<60||maxDuration>86_400||!Number.isSafeInteger(startWindow)||startWindow<30||startWindow>3600||!Number.isSafeInteger(settlementGrace)||settlementGrace<60||settlementGrace>86_400||!Number.isSafeInteger(processRelayLimit)||processRelayLimit<1||processRelayLimit>10_000)throw failure(503,'SESSION_DISABLED','Session pricing or process guard configuration is invalid.');
  const provider=secretAccount(providerKey,'provider');const relayer=secretAccount(relayerKey,'relayer');
  const transport=http(rpcUrl||undefined,{timeout:10_000,retryCount:1});
  const publicClient=createPublicClient({chain:allowedChain,transport});
  const walletClient=createWalletClient({account:relayer,chain:allowedChain,transport});
  return {router,vault,token,provider,relayer,publicClient,walletClient};
}
export async function parseJson(request:Request):Promise<Record<string,unknown>> {
  const length=Number(request.headers.get('content-length')||0);
  if(length>bodyLimit)throw failure(413,'BODY_TOO_LARGE','Request body is too large.');
  let value:unknown;try{const raw=await request.text();if(raw.length>bodyLimit)throw failure(413,'BODY_TOO_LARGE','Request body is too large.');value=JSON.parse(raw);}catch(error){if((error as SessionServiceError).status)throw error;throw failure(400,'INVALID_JSON','Request body must be valid JSON.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw failure(400,'INVALID_REQUEST','Request body must be an object.');
  return value as Record<string,unknown>;
}
export function requireRateLimit(request:Request,key:string,limit=12) {
  const now=Date.now();const bucket=Math.floor(now/60_000);const ip=request.headers.get('x-real-ip')||'unknown';const id=`${ip}:${key}`;const current=requests.get(id);
  if(!current||current.window!==bucket){if(requests.size>=5000){for(const [entry,value] of requests)if(value.window<bucket-2)requests.delete(entry);if(requests.size>=5000)throw failure(429,'RATE_LIMITED','Session request capacity is temporarily full. Try again shortly.');}requests.set(id,{window:bucket,count:1});}
  else if(current.count>=limit)throw failure(429,'RATE_LIMITED','Too many session requests. Wait a minute and try again.');else current.count++;
}
function checkedCustomer(value:unknown):Address {if(typeof value!=='string'||!/^0x[\da-f]{40}$/i.test(value)||/^0x0{40}$/i.test(value))throw failure(400,'INVALID_CUSTOMER','customer must be a nonzero EVM address.');return value as Address;}
function checkedAmount(value:unknown):bigint {if(typeof value!=='string'||! /^(0|[1-9]\d{0,37})$/.test(value))throw failure(400,'INVALID_AMOUNT','maxAmount must be an integer token base-unit string.');const n=BigInt(value);if(n<=0n||n>=(1n<<128n))throw failure(400,'INVALID_AMOUNT','maxAmount must be a positive uint128 base-unit amount.');return n;}
function checkedDuration(value:unknown):number {if(!Number.isSafeInteger(value)||Number(value)<60||Number(value)>maxDuration)throw failure(400,'INVALID_DURATION',`maxDurationSeconds must be between 60 and ${maxDuration}.`);return Number(value);}
function checkedService(value:unknown):{id:Hash;label:string} {if(value!=='compute-session')throw failure(400,'INVALID_SERVICE','Unknown service.');return {id:keccak256(toHex('compute-session')),label:'Timed compute session'};}
async function verifyDeployment(config:ReturnType<typeof env>) {
  const {publicClient,router,vault,token}=config;
  if(await publicClient.getChainId()!==chainId)throw failure(503,'SESSION_DISABLED','Session RPC is connected to the wrong chain.');
  const [routerCode,vaultCode,actualVault,actualToken,vaultToken,version,domain,tokenSymbol,decimals]=await Promise.all([
    publicClient.getCode({address:router}),publicClient.getCode({address:vault}),
    publicClient.readContract({address:router,abi:sessionRouterAbi,functionName:'vault'}),publicClient.readContract({address:router,abi:sessionRouterAbi,functionName:'token'}),
    publicClient.readContract({address:vault,abi:vaultAbi,functionName:'token'}),publicClient.readContract({address:vault,abi:vaultAbi,functionName:'version'}),
    publicClient.readContract({address:router,abi:sessionRouterAbi,functionName:'eip712Domain'}),
    publicClient.readContract({address:token,abi:parseAbi(['function symbol() view returns (string)']),functionName:'symbol'}),
    publicClient.readContract({address:token,abi:parseAbi(['function decimals() view returns (uint8)']),functionName:'decimals'})
  ]);
  if(!routerCode||routerCode==='0x'||!vaultCode||vaultCode==='0x'||actualVault.toLowerCase()!==vault.toLowerCase()||actualToken.toLowerCase()!==token.toLowerCase()||vaultToken.toLowerCase()!==token.toLowerCase()||version!==2n||tokenSymbol!=='USDG'||decimals!==6||domain[1]!=='CovaSessionRouter'||domain[2]!=='1'||domain[3]!==BigInt(chainId)||domain[4].toLowerCase()!==router.toLowerCase())throw failure(503,'SESSION_DISABLED','Session Router, CovaVault v2, USDG or signing domain failed verification.');
}
function makeQuote(customer:Address,serviceId:Hash,maxAmount:bigint,duration:number,provider:Address):SessionQuote {
  const now=BigInt(Math.floor(Date.now()/1000));const startBy=now+BigInt(startWindow);const holdExpiresAt=startBy+BigInt(duration+settlementGrace);
  return checkedSessionQuote({sessionId:`0x${crypto.randomUUID().replaceAll('-','')}`,customer,provider,serviceId,ratePerMinute,maxAmount,maxDurationSeconds:duration,startBy,holdExpiresAt},now);
}
export async function createQuote(request:Request,body:Record<string,unknown>) {
  const customer=checkedCustomer(body.customer);const maxAmount=checkedAmount(body.maxAmount);const duration=checkedDuration(body.maxDurationSeconds);const service=checkedService(body.serviceId);
  const fullDurationCharge=ratePerMinute*BigInt(duration)/60n;
  if(fullDurationCharge>maxAmount)throw failure(422,'CAP_BELOW_FULL_DURATION',`Budget must cover the full ${duration} second quote at the provider rate.`);
  requireRateLimit(request,customer.toLowerCase());const config=env();await verifyDeployment(config);
  const account=await config.publicClient.readContract({address:config.vault,abi:vaultAbi,functionName:'availableBalance',args:[customer]});
  if(account<maxAmount)throw failure(422,'INSUFFICIENT_COVA_BALANCE','Deposit enough USDG into Cova before starting this session.');
  const quote=makeQuote(customer,service.id,maxAmount,duration,config.provider.address);
  const signature=await config.provider.signTypedData(sessionQuoteTypedData(chainId,config.router,quote));
  return {quote:{...quote,ratePerMinute:quote.ratePerMinute.toString(),maxAmount:quote.maxAmount.toString(),startBy:quote.startBy.toString(),holdExpiresAt:quote.holdExpiresAt.toString()},providerSignature:signature,serviceLabel:service.label,billingUnit:'minute',token:'USDG',decimals:6,network:chainId===421614?'Arbitrum Sepolia':'Local Anvil',testnet:chainId===421614};
}
function quoteFrom(value:unknown):SessionQuote {try{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();const quote=value as Record<string,unknown>;for(const field of ['ratePerMinute','maxAmount','startBy','holdExpiresAt'])if(typeof quote[field]==='string'&&/^(0|[1-9]\d*)$/.test(quote[field] as string))quote[field]=BigInt(quote[field] as string);return checkedSessionQuote(quote);}catch{throw failure(400,'INVALID_QUOTE','Quote fields or session limits are invalid.');}}
export async function startSession(request:Request,body:Record<string,unknown>) {
  const config=env();const quote=quoteFrom(body.quote);const providerSignature=body.providerSignature;const auth=body.covaAuthorization as Record<string,unknown>|undefined;const customerSignature=body.covaSignature;
  if(typeof providerSignature!=='string'||!/^0x(?:[\da-f]{2})+$/i.test(providerSignature)||typeof customerSignature!=='string'||!/^0x(?:[\da-f]{2})+$/i.test(customerSignature)||!auth)throw failure(400,'INVALID_SIGNATURE','Quote and customer authorization signatures are required.');
  const expectedService=keccak256(toHex('compute-session'));
  if(quote.serviceId!==expectedService||quote.provider.toLowerCase()!==config.provider.address.toLowerCase()||quote.customer.toLowerCase()!==checkedCustomer(body.customer??quote.customer).toLowerCase())throw failure(400,'INVALID_QUOTE','Quote does not match this provider or customer.');
  let terms:{customer:Address;merchant:Address;maxAmount:bigint;expiresAt:bigint;nonce:bigint;referenceId:Hash};
  try{terms={customer:checkedCustomer(auth.customer),merchant:checkedCustomer(auth.merchant),maxAmount:checkedAmount(auth.maxAmount),expiresAt:checkedUint(BigInt(String(auth.expiresAt)),64,'expiresAt',true),nonce:checkedUint(BigInt(String(auth.nonce)),256,'nonce'),referenceId:checkedHash(auth.referenceId,'referenceId')};}
  catch{throw failure(400,'INVALID_AUTHORIZATION','Customer authorization fields are invalid.');}
  const expectedReference=hashTypedData(sessionQuoteTypedData(chainId,config.router,quote));
  if(terms.customer.toLowerCase()!==quote.customer.toLowerCase()||terms.merchant.toLowerCase()!==config.router.toLowerCase()||terms.maxAmount!==quote.maxAmount||terms.expiresAt!==quote.holdExpiresAt||terms.referenceId.toLowerCase()!==expectedReference.toLowerCase())throw failure(400,'INVALID_AUTHORIZATION','Customer authorization does not match the signed provider quote.');
  requireRateLimit(request,quote.customer.toLowerCase());await verifyDeployment(config);
  const validProvider=await verifyTypedData({...sessionQuoteTypedData(chainId,config.router,quote),address:quote.provider,signature:providerSignature as Hex});
  if(!validProvider)throw failure(400,'INVALID_SIGNATURE','Provider quote signature is invalid.');
  const existing=await config.publicClient.readContract({address:config.router,abi:sessionRouterAbi,functionName:'sessions',args:[quote.sessionId]});
  if(existing[0]!==0){if(existing[0]===1&&existing[3].toLowerCase()===quote.customer.toLowerCase())return {sessionId:quote.sessionId,transactionHash:null,status:'confirmed',alreadyStarted:true};throw failure(409,'SESSION_ALREADY_USED','This session quote has already been used.');}
  const active=await config.publicClient.readContract({address:config.router,abi:sessionRouterAbi,functionName:'activeSessionCount',args:[quote.customer]});
  if(active>=1n)throw failure(429,'ACTIVE_SESSION_LIMIT','Finish the active session before starting another.');
  const today=new Date().toISOString().slice(0,10);if(relayBudget.period!==today)relayBudget={period:today,count:0};if(relayBudget.count>=processRelayLimit)throw failure(429,'PROCESS_RELAY_LIMIT','This process has reached its best-effort relay budget for the current UTC day.');
  const args=[quote,providerSignature as Hex,terms,customerSignature as Hex] as const;
  try{await config.publicClient.simulateContract({address:config.router,abi:sessionRouterAbi,functionName:'startSession',args,account:config.relayer.address});}
  catch{throw failure(422,'START_REJECTED','The signed session could not start. Check available funds, expiry and wallet authorization.');}
  relayBudget.count++;
  let submittedHash:Hash|undefined;
  try{submittedHash=await config.walletClient.writeContract({account:config.relayer,address:config.router,abi:sessionRouterAbi,functionName:'startSession',args});const receipt=await config.publicClient.waitForTransactionReceipt({hash:submittedHash,confirmations:1,timeout:120_000});if(receipt.status!=='success')throw failure(422,'START_REVERTED','Session start transaction reverted.');return {sessionId:quote.sessionId,transactionHash:receipt.transactionHash,status:'confirmed'};}
  catch(error){if((error as SessionServiceError).status)throw error;if(submittedHash)throw failure(202,'START_PENDING','Session start was submitted; the service remains stopped until chain confirmation.',{transactionHash:submittedHash});throw failure(503,'START_UNAVAILABLE','Session start could not be submitted. Check the Router and relayer.');}
}
export async function stopSession(request:Request,sessionId:string,body:Record<string,unknown>) {
  if(!/^0x[\da-f]{64}$/i.test(sessionId))throw failure(400,'INVALID_SESSION','sessionId must be bytes32.');const validUntil=body.validUntil;const signature=body.customerSignature;
  if(typeof validUntil!=='string'||!/^\d{1,20}$/.test(validUntil)||typeof signature!=='string'||!/^0x(?:[\da-f]{2})+$/i.test(signature))throw failure(400,'INVALID_SIGNATURE','Customer stop authorization is invalid.');
  const deadline=BigInt(validUntil);const config=env();requireRateLimit(request,sessionId.toLowerCase());await verifyDeployment(config);
  const session=await config.publicClient.readContract({address:config.router,abi:sessionRouterAbi,functionName:'sessions',args:[sessionId as Hash]});
  if(session[0]!==1)throw failure(409,'SESSION_NOT_ACTIVE','This session is no longer active.');
  if(deadline<BigInt(Math.floor(Date.now()/1000)))throw failure(400,'SIGNATURE_EXPIRED','Stop authorization expired. Sign again from the customer wallet.');
  const args=[sessionId as Hash,deadline,signature as Hex] as const;
  try{await config.publicClient.simulateContract({address:config.router,abi:sessionRouterAbi,functionName:'stopSessionWithSignature',args,account:config.relayer.address});}
  catch{throw failure(422,'STOP_REJECTED','The session stop could not be confirmed. Refresh its onchain status.');}
  try{const hash=await config.walletClient.writeContract({account:config.relayer,address:config.router,abi:sessionRouterAbi,functionName:'stopSessionWithSignature',args});const receipt=await config.publicClient.waitForTransactionReceipt({hash,confirmations:1,timeout:120_000});if(receipt.status!=='success')throw failure(422,'STOP_REVERTED','Session settlement transaction reverted.');return {sessionId,transactionHash:receipt.transactionHash,status:'confirmed'};}
  catch(error){if((error as SessionServiceError).status)throw error;throw failure(503,'STOP_PENDING','Session stop was submitted but confirmation is pending. Refresh before retrying.');}
}
export function apiError(error:unknown) {
  const known=error as Partial<SessionServiceError>;
  if(typeof known.status==='number'&&typeof known.code==='string')return Response.json({error:known.message,code:known.code,...(known.status===202?{status:'pending'}:{}),...(known.transactionHash?{transactionHash:known.transactionHash}:{})},{status:known.status,headers:{'Cache-Control':'no-store'}});
  return Response.json({error:'Session service is temporarily unavailable.',code:'SESSION_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});
}
