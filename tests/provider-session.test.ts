import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeterministicWork, ProviderSessionRunner, type ProviderSession } from '../examples/session-provider/session-runner.js';

const id='0x'+'11'.repeat(32);const provider='0x2000000000000000000000000000000000000002';
function fixture(){let status:ProviderSession['status']=1;let starts=0;let stops=0;const session:ProviderSession={id,status,startedAt:100n,stoppedAt:0n,maxDurationSeconds:2400,provider};const reader={list:async()=>[id],read:async()=>({...session,status})};const work={start:()=>{starts++;},stop:()=>{stops++;return {ticks:4,digest:'done'};}};return {runner:new ProviderSessionRunner(reader,work,provider),setStatus:(next:ProviderSession['status'])=>{status=next;},counts:()=>({starts,stops})};}

test('provider work starts only for a confirmed active session and stops once after settlement',async()=>{
  const f=fixture();await f.runner.pollOnce();await f.runner.pollOnce();assert.deepEqual(f.counts(),{starts:1,stops:0});
  f.setStatus(2);const receipt=await f.runner.pollOnce();assert.deepEqual(receipt,{id,reason:'settled',ticks:4,digest:'done'});assert.deepEqual(f.counts(),{starts:1,stops:1});await f.runner.pollOnce();assert.deepEqual(f.counts(),{starts:1,stops:1});
});

test('provider adapter ignores pending, other-provider and pre-start records',async()=>{
  const status:ProviderSession['status']=1;let starts=0;const session:ProviderSession={id,status,startedAt:0n,stoppedAt:0n,maxDurationSeconds:2400,provider};
  const runner=new ProviderSessionRunner({list:async()=>[id],read:async()=>({...session,status,provider:'0x3000000000000000000000000000000000000003'})},{start:()=>{starts++;},stop:()=>({ticks:0,digest:''})},provider);
  await runner.pollOnce();assert.equal(starts,0);
});

test('provider stops work and permissionlessly settles at the signed duration cap',async()=>{
  let observedAt=100n;let status:ProviderSession['status']=1;let stopped=0;let finalized=0;
  const session:ProviderSession={id,status,startedAt:100n,stoppedAt:0n,maxDurationSeconds:40,provider,observedAt};
  const runner=new ProviderSessionRunner({list:async()=>[id],read:async()=>({...session,status,observedAt})},{start:()=>{},stop:()=>{stopped++;return {ticks:2,digest:'local'};}},provider,async()=>{finalized++;status=2;});
  await runner.pollOnce();observedAt=140n;const receipt=await runner.pollOnce();assert.equal(receipt?.reason,'maximum');assert.equal(stopped,1);assert.equal(finalized,1);await runner.pollOnce();assert.equal(stopped,1);assert.equal(finalized,1);
});

test('deterministic reference workload produces a bounded local receipt after work stops',async()=>{
  const work=createDeterministicWork();const session:ProviderSession={id,status:1,startedAt:1n,stoppedAt:0n,maxDurationSeconds:20,provider};work.start(session);await new Promise(resolve=>setTimeout(resolve,40));const receipt=work.stop({...session,status:2},'settled');assert.ok(receipt.ticks>0);assert.equal(receipt.digest.length,64);assert.ok(!receipt.digest.includes('0x')); 
});
