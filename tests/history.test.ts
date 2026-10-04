import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hash, PublicClient } from 'viem';
import { readHoldHistory } from '../sdk/src/index.js';
const vault='0x1111111111111111111111111111111111111111' as Address;
const id=('0x'+'1'.repeat(64)) as Hash;
const hash=(n:number)=>('0x'+n.toString(16).padStart(64,'0')) as Hash;
function log(eventName:'HoldCreated'|'HoldCaptured'|'HoldReleased',blockNumber:bigint,logIndex:number,transactionHash:Hash,removed=false) {
  return {address:vault,eventName,args:{holdId:id,amount:1n},blockNumber,blockHash:hash(Number(blockNumber)+100),transactionIndex:0,logIndex,transactionHash,removed};
}
test('history sorts, deduplicates and preserves all confirmed capture hashes without removed logs',async()=>{
  const events=[log('HoldReleased',5n,0,hash(5)),log('HoldCaptured',4n,0,hash(4)),log('HoldCreated',2n,0,hash(2)),log('HoldCaptured',3n,0,hash(3)),log('HoldCaptured',4n,0,hash(4)),log('HoldCaptured',4n,1,hash(6),true)];
  const client={getLogs:async({fromBlock,toBlock}:{fromBlock:bigint;toBlock:bigint})=>events.filter(e=>e.blockNumber>=fromBlock&&e.blockNumber<=toBlock)} as unknown as PublicClient;
  const result=await readHoldHistory(client,vault,[id],{fromBlock:2n,toBlock:5n,chunkSize:2n});
  assert.deepEqual(result.receipts[id],{createHash:hash(2),captureHashes:[hash(3),hash(4)],releaseHash:hash(5)});
  assert.deepEqual(result.events.map(e=>e.eventName),['HoldCreated','HoldCaptured','HoldCaptured','HoldReleased']);
  assert.equal(result.complete,true);assert.equal(result.scannedThrough,5n);
});
test('history shrinks provider range limits while covering each block exactly once',async()=>{
  const completed:bigint[]=[];
  const client={getLogs:async({fromBlock,toBlock}:{fromBlock:bigint;toBlock:bigint})=>{
    if(toBlock-fromBlock+1n>2n) throw new Error('block range too large; maximum 2 blocks');
    for(let n=fromBlock;n<=toBlock;n++) completed.push(n);
    return fromBlock<=2n&&toBlock>=2n?[log('HoldCreated',2n,0,hash(2))]:[];
  }} as unknown as PublicClient;
  const result=await readHoldHistory(client,vault,[id],{fromBlock:0n,toBlock:6n,chunkSize:8n});
  assert.equal(result.complete,true);assert.equal(result.scannedThrough,6n);
  assert.deepEqual(completed,[0n,1n,2n,3n,4n,5n,6n]);assert.equal(result.receipts[id].createHash,hash(2));
});
test('history error preserves completed receipts and never advances cursor past failed chunk',async()=>{
  const client={getLogs:async({fromBlock}:{fromBlock:bigint})=>{
    if(fromBlock>=4n) throw new Error('RPC unavailable');
    return [log('HoldCreated',2n,0,hash(2)),log('HoldCaptured',3n,0,hash(3))];
  }} as unknown as PublicClient;
  const result=await readHoldHistory(client,vault,[id],{fromBlock:2n,toBlock:8n,chunkSize:2n});
  assert.equal(result.complete,false);assert.equal(result.scannedThrough,3n);assert.match(result.error!,/RPC unavailable/);
  assert.deepEqual(result.receipts[id],{createHash:hash(2),captureHashes:[hash(3)]});
  assert.equal(result.events.length,2);
});
test('history has no silent empty fallback and validates bounded ranges',async()=>{
  let calls=0;
  const client={getLogs:async()=>{calls++;throw new Error('rate limit exceeded');}} as unknown as PublicClient;
  const result=await readHoldHistory(client,vault,[id],{fromBlock:0n,toBlock:100n});
  assert.equal(result.complete,false);assert.equal(result.scannedThrough,-1n);assert.equal(calls,1);assert.match(result.error!,/rate limit/);
  await assert.rejects(readHoldHistory(client,vault,[id],{fromBlock:-1n,toBlock:100n}));
  await assert.rejects(readHoldHistory(client,vault,[id],{fromBlock:0n,toBlock:100n,chunkSize:0n}));
});
test('history request budget returns resumable partial results and scrubs RPC URLs',async()=>{
  const client={getLogs:async({fromBlock}:{fromBlock:bigint})=>fromBlock===2n?[log('HoldCreated',2n,0,hash(2))]:[]} as unknown as PublicClient;
  const result=await readHoldHistory(client,vault,[id],{fromBlock:2n,toBlock:20n,chunkSize:2n,maxRequests:2});
  assert.equal(result.complete,false);assert.equal(result.scannedThrough,5n);assert.equal(result.receipts[id].createHash,hash(2));assert.match(result.error!,/budget/i);
  const failed=await readHoldHistory({getLogs:async()=>{throw new Error('Failed https://user:password@example.com/key');}} as unknown as PublicClient,vault,[id],{fromBlock:2n,toBlock:2n});
  assert.equal(failed.error!.includes('password'),false);assert.equal(failed.error!.includes('/key'),false);
});
