import {friendlyError}from'../lib/errors';
import {test}from'node:test';
import assert from'node:assert/strict';
import {mergeHistory,reconcileHistory}from'../lib/history';
import {formatHoldExpiry}from'../lib/expiry';
import {visibleSignature,clearOwnSignature,type PendingSignature}from'../lib/signature-state';
import type {HoldHistoryEvent,HoldHistoryResult}from'../sdk/src/index';
const id=('0x'+'1'.repeat(64)) as `0x${string}`,hash=('0x'+'2'.repeat(64)) as `0x${string}`;
const event={eventName:'HoldCaptured',holdId:id,transactionHash:hash,blockNumber:100n,blockHash:hash,transactionIndex:0,logIndex:0,amount:14n} as HoldHistoryEvent;
const old={events:[event],receipts:{[id]:{captureHashes:[hash]}},scannedThrough:100n,complete:true} as HoldHistoryResult;
test('failed overlap keeps known receipts while exposing incomplete/error state',()=>{
 const failed={events:[],receipts:{},scannedThrough:97n,complete:false,error:'RPC unavailable'} as HoldHistoryResult;
 const result=mergeHistory(old,failed,98n,[id],103n);
 const chosen=reconcileHistory(result,{...old,snapshotEpoch:1},1);assert.equal(chosen.complete,false);assert.equal(chosen.error,'RPC unavailable');
 assert.equal(result.complete,false);assert.equal(result.error,'RPC unavailable');assert.deepEqual(result.receipts[id].captureHashes,[hash]);
});
test('a lowered chain head removes orphaned receipt events',()=>{
 const latest={events:[],receipts:{},scannedThrough:99n,complete:true} as HoldHistoryResult;
 assert.equal(mergeHistory(old,latest,98n,[id],99n).events.length,0);
});
test('uint64 expiry beyond Date range can be displayed without crashing',()=>{
 const expiry=1n<<63n;const result=formatHoldExpiry(Number(expiry),expiry);
 assert.equal(result.iso,undefined);assert.match(result.label,/9223372036854775808/);
 assert.match(formatHoldExpiry(1700000000).iso!,/^2023-/);
});
test('a signature is visible and invalidated only under its own wallet context',()=>{
 const a='0x1000000000000000000000000000000000000001' as const,b='0x2000000000000000000000000000000000000002' as const;
 const packet:PendingSignature={customer:a,vault:b,chainId:31337,json:'signed by A'};
 const own={customer:a,vault:b,chainId:31337},other={...own,customer:b};
 assert.equal(visibleSignature(packet,own),'signed by A');
 assert.equal(visibleSignature(packet,other),undefined);
 assert.equal(visibleSignature(packet,{...own,chainId:421614}),undefined);
 assert.equal(clearOwnSignature(packet,other),packet);
 assert.equal(clearOwnSignature(packet,own),undefined);
});

test('wrapped wallet rejection retains the useful rejection message',()=>{const rejected=Object.assign(new Error('User rejected request'),{code:4001});assert.match(friendlyError(new Error('SDK request failed',{cause:rejected})),/^Wallet request rejected/);});

test('slow old-head scan cannot overwrite a newer snapshot, but a later reorg can',()=>{
 const newer={...old,scannedThrough:115n,snapshotEpoch:2,events:[{...event,blockNumber:115n}]};
 const slow={events:[],receipts:{},scannedThrough:110n,complete:true};
 assert.equal(reconcileHistory(slow,newer,1).scannedThrough,115n);
 const reorg=mergeHistory(newer,{events:[],receipts:{},scannedThrough:109n,complete:true},107n,[id],109n);
 const fresh=reconcileHistory(reorg,newer,3);assert.equal(fresh.scannedThrough,109n);assert.equal(fresh.events.length,0);
});
