import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashTypedData, keccak256, toHex, type Address, type Hash, type PublicClient, type WalletClient } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { checkedSessionQuote, createCovaSessionClient, readSessionHistory, sessionQuoteDigest, sessionQuoteTypedData, sessionStopTypedData } from '../sdk/src/index.js';

const customer=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:4});
const provider=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:5});
const relayer=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:6});
const router='0x3333333333333333333333333333333333333333' as Address;
const vault='0x1111111111111111111111111111111111111111' as Address;
const token='0x2222222222222222222222222222222222222222' as Address;
function quote(){const now=BigInt(Math.floor(Date.now()/1000));return {sessionId:keccak256(toHex('session-1')),customer:customer.address,provider:provider.address,serviceId:keccak256(toHex('compute')),ratePerMinute:500_000n,maxAmount:20_000_000n,maxDurationSeconds:2400,startBy:now+300n,holdExpiresAt:now+3000n};}

test('provider quote typed data binds all terms and matches viem digest',async()=>{
  const q=quote();const typed=sessionQuoteTypedData(31337,router,q);const signature=await provider.signTypedData(typed);
  assert.equal(sessionQuoteDigest(31337,router,q),hashTypedData(typed));
  assert.equal(await (await import('viem')).verifyTypedData({...typed,address:provider.address,signature}),true);
  for(const altered of [{...q,customer:relayer.address},{...q,provider:relayer.address},{...q,serviceId:keccak256(toHex('other'))},{...q,ratePerMinute:q.ratePerMinute-1n},{...q,maxAmount:q.maxAmount+1n},{...q,maxDurationSeconds:2399},{...q,startBy:q.startBy+1n},{...q,holdExpiresAt:q.holdExpiresAt+1n},{...q,sessionId:keccak256(toHex('replay'))}]) assert.notEqual(sessionQuoteDigest(31337,router,altered),sessionQuoteDigest(31337,router,q));
  const stop=sessionStopTypedData(31337,router,q.sessionId,BigInt(Math.floor(Date.now()/1000))+60n);assert.equal(stop.primaryType,'SessionStop');
});

test('quote codec rejects invalid addresses, expired timing and cap/rate mismatch',()=>{
  const q=quote();
  assert.throws(()=>checkedSessionQuote({...q,provider:'0x0000000000000000000000000000000000000000'}),/address/i);
  assert.throws(()=>checkedSessionQuote({...q,startBy:1n}),/deadline/i);
  assert.throws(()=>checkedSessionQuote({...q,maxAmount:1n}),/exceeds/i);
  assert.throws(()=>checkedSessionQuote({...q,holdExpiresAt:q.startBy+2400n}),/cleanup/i);
  assert.throws(()=>checkedSessionQuote({...q,maxDurationSeconds:1n<<32n}),/uint32/i);
});

function mockClients(overrides:{readContract?:(args:{functionName:string})=>Promise<unknown>;simulateContract?:(args:{functionName:string;args?:unknown[]})=>Promise<unknown>}={}){
  const recordData:unknown[]=[0,'0x'+'0'.repeat(64),'0x'+'0'.repeat(64),customer.address,provider.address,500_000n,20_000_000n,0n,0n,2400n,0n,0n];
  const publicClient={chain:{id:31337},getChainId:async()=>31337,getBlockNumber:async()=>50n,getBlock:async()=>({timestamp:BigInt(Math.floor(Date.now()/1000))}),readContract:async({functionName}:{functionName:string})=>{
    if(functionName==='vault')return vault;if(functionName==='token')return token;if(functionName==='version')return 2n;
    if(functionName==='eip712Domain')return ['0x0f','CovaSessionRouter','1',31337n,router,'0x'+'0'.repeat(64),[]];
    if(functionName==='nonces')return 0n;if(functionName==='availableBalance')return 100_000_000n;if(functionName==='sessions')return recordData;
    if(functionName==='getCustomerSessionIds'||functionName==='getProviderSessionIds')return [];
    throw new Error(functionName);
  },simulateContract:async(args:{functionName:string;args?:unknown[]})=>({request:args}),...overrides} as unknown as PublicClient;
  const walletClient={account:customer,chain:{id:31337},getChainId:async()=>31337,getAddresses:async()=>[customer.address],signTypedData:async(args:Parameters<typeof customer.signTypedData>[0])=>customer.signTypedData(args),writeContract:async()=>('0x'+'a'.repeat(64)) as Hash} as unknown as WalletClient;
  return {publicClient,walletClient};
}

test('customer signs a quote-bound vault hold, simulates Router start, and never broadcasts during signing',async()=>{
  const q=quote();let simulated=0;let writes=0;let captured:unknown[]=[];const mocks=mockClients({simulateContract:async(args:{functionName:string;args?:unknown[]})=>{simulated++;captured=args.args??[];return {request:args};}});
  mocks.walletClient.account=customer;mocks.walletClient.getAddresses=async()=>[customer.address];
  mocks.walletClient.writeContract=async()=>{writes++;return ('0x'+'a'.repeat(64)) as Hash;};
  const client=createCovaSessionClient({...mocks,router,vault,token,chainId:31337});
  const signature=await provider.signTypedData(sessionQuoteTypedData(31337,router,q));
  const signed=await client.signStart(q,signature);
  assert.equal(simulated,1);assert.equal(writes,0);
  const auth=captured[2] as {referenceId:Hash;maxAmount:bigint;merchant:Address};
  assert.equal(auth.referenceId,sessionQuoteDigest(31337,router,q));assert.equal(auth.maxAmount,q.maxAmount);assert.equal(auth.merchant,router);
  const tx=await client.start(q,signature,signed.authorization,signed.signature);
  assert.match(tx,/^0x/);assert.equal(writes,1);
});

test('SDK rejects wallet changes and quote substitution before transaction broadcast',async()=>{
  const q=quote();const mocks=mockClients();const client=createCovaSessionClient({...mocks,router,vault,token,chainId:31337});
  const signature=await provider.signTypedData(sessionQuoteTypedData(31337,router,q));
  const signed=await client.signStart(q,signature);
  await assert.rejects(client.start({...q,maxAmount:q.maxAmount-1n},signature,signed.authorization,signed.signature),/quote/i);
  mocks.walletClient.getChainId=async()=>1;
  await assert.rejects(client.stop(q.sessionId),/wrong chain/i);
});

test('a fresh SDK client recovers active customer sessions and start receipts from Router state',async()=>{
  const sessionId=keccak256(toHex('recoverable session'));const startHash=keccak256(toHex('confirmed start transaction'));
  const raw=[1,'0x'+'a'.repeat(64),keccak256(toHex('hold')),customer.address,provider.address,500_000n,20_000_000n,0n,0n,2400n,1000n,0n];
  const publicClient={getLogs:async()=>[{eventName:'SessionStarted',args:{sessionId,holdId:raw[2],customer:customer.address,provider:provider.address},removed:false,transactionHash:startHash,blockNumber:10n,blockHash:keccak256(toHex('block')),transactionIndex:0,logIndex:0}],readContract:async({functionName}:{functionName:string})=>{
    if(functionName==='getCustomerSessionIds')return [sessionId];if(functionName==='sessions')return raw;throw new Error(functionName);
  }} as unknown as PublicClient;
  const result=await readSessionHistory(publicClient,router,customer.address,'customer',{fromBlock:1n,toBlock:20n,maxRequests:2});
  assert.equal(result.complete,true);assert.equal(result.sessions.length,1);assert.equal(result.sessions[0].record.status,1);assert.equal(result.sessions[0].record.provider,provider.address);
  assert.equal(result.sessions[0].record.ratePerMinute,500_000n);assert.equal(result.sessions[0].record.maxDurationSeconds,2400);
  assert.equal(result.sessions[0].startHash,startHash);
});
