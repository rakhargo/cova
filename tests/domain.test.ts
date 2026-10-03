import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, validateHold } from '../lib/validation';
import { initialDemoState, demoTransition, DEMO_MERCHANT, DEMO_CUSTOMER } from '../lib/demo';
import { resolveConfig } from '../lib/config';
import { releasedAmount } from '../lib/format';

test('money accepts exact token precision and refuses rounded or nonpositive input', () => {
  assert.equal(parseAmount('17.42', 6), 17_420_000n);
  assert.equal(parseAmount('0.000001', 6), 1n);
  assert.equal(parseAmount('1.000000000000000001', 18), 1_000_000_000_000_000_001n);
  for (const input of ['0','-1','1e3','NaN','0.0000001','1.0000001','']) assert.throws(() => parseAmount(input,6));
});
test('authorization refuses invalid merchant, expiry, reference and overflow', () => {
  const valid = {merchant:DEMO_MERCHANT,amount:'20',expiryMinutes:60,description:'Court Booking'};
  assert.equal(validateHold(valid,6).amount,20_000_000n);
  for (const patch of [{merchant:'0x0000000000000000000000000000000000000000'},{merchant:'bad'},{expiryMinutes:0},{expiryMinutes:1.2},{expiryMinutes:525601},{description:''},{amount:'340282366920938463463374607431768211456'}]) {
    assert.throws(() => validateHold({...valid,...patch},6));
  }
});
test('20 authorization, 14 capture, 6 release reconciles customer and merchant', () => {
  let state = initialDemoState();
  state = demoTransition(state,{type:'create',merchant:DEMO_MERCHANT,amount:20_000_000n,expiresAt:160,description:'Court Booking'},100);
  const id=state.holds[0].id;
  assert.equal(state.available,80_000_000n); assert.equal(state.reserved,20_000_000n);
  assert.throws(()=>demoTransition(state,{type:'withdraw',amount:81_000_000n},100));
  assert.throws(()=>demoTransition(state,{type:'capture',id,amount:14_000_000n,actor:DEMO_CUSTOMER},101));
  state=demoTransition(state,{type:'capture',id,amount:14_000_000n,actor:DEMO_MERCHANT},101);
  assert.equal(state.merchantReceived,14_000_000n); assert.equal(state.reserved,6_000_000n);
  state=demoTransition(state,{type:'release',id,actor:DEMO_MERCHANT},102);
  assert.equal(state.available,86_000_000n); assert.equal(state.reserved,0n);
  assert.equal(releasedAmount(state.holds[0]),6_000_000n);
  assert.throws(()=>demoTransition(state,{type:'release',id,actor:DEMO_MERCHANT},103));
  assert.throws(()=>demoTransition(state,{type:'capture',id,amount:1n,actor:DEMO_MERCHANT},103));
});
test('EV charging settles exact cents, expiry blocks captures, full capture is terminal',()=>{
  let state=demoTransition(initialDemoState(),{type:'create',merchant:DEMO_MERCHANT,amount:30_000_000n,expiresAt:160,description:'EV Charging'},100);
  const id=state.holds[0].id;
  assert.throws(()=>demoTransition(state,{type:'capture',id,amount:30_000_001n,actor:DEMO_MERCHANT},101));
  assert.throws(()=>demoTransition(state,{type:'release',id,actor:DEMO_CUSTOMER},101));
  state=demoTransition(state,{type:'capture',id,amount:17_420_000n,actor:DEMO_MERCHANT},101);
  assert.throws(()=>demoTransition(state,{type:'capture',id,amount:1n,actor:DEMO_MERCHANT},160));
  state=demoTransition(state,{type:'expired',id},160);
  assert.equal(state.available,82_580_000n); assert.equal(releasedAmount(state.holds[0]),12_580_000n);
  state=demoTransition(state,{type:'create',merchant:DEMO_MERCHANT,amount:10_000_000n,expiresAt:250,description:'Camera Rental'},161);
  state=demoTransition(state,{type:'capture',id:state.holds[0].id,amount:10_000_000n,actor:DEMO_MERCHANT},162);
  assert.equal(state.holds[0].status,2); assert.equal(state.reserved,0n);
});
test('approval/deposit/withdraw preserves balances and exact allowance',()=>{
  let state=initialDemoState();
  assert.throws(()=>demoTransition(state,{type:'deposit',amount:50_000_000n},100));
  state=demoTransition(state,{type:'approve',amount:50_000_000n},100);
  state=demoTransition(state,{type:'deposit',amount:50_000_000n},100);
  assert.equal(state.walletBalance,350_000_000n); assert.equal(state.available,150_000_000n); assert.equal(state.allowance,0n);
  state=demoTransition(state,{type:'withdraw',amount:10_000_000n},100);
  assert.equal(state.walletBalance,360_000_000n); assert.equal(state.available,140_000_000n);
});
test('configuration defaults to honest demo, supports local, rejects malformed live settings',()=>{
  assert.equal(resolveConfig({}).demo,true);
  const live=resolveConfig({vault:DEMO_CUSTOMER});
  assert.equal(live.demo,false); assert.equal(live.chainId,421614);
  assert.throws(()=>resolveConfig({vault:'bad'}));
  assert.throws(()=>resolveConfig({vault:DEMO_CUSTOMER,chainId:'1'}));
  assert.throws(()=>resolveConfig({vault:DEMO_CUSTOMER,chainId:'31337'}));
  assert.equal(resolveConfig({vault:DEMO_CUSTOMER,token:DEMO_MERCHANT,chainId:'31337',rpc:'http://127.0.0.1:8545'}).local,true);
});
