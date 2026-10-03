import { keccak256, toHex } from 'viem';
import type { Address, Hash } from 'viem';
import type { Hold } from './types';
export const DEMO_CUSTOMER: Address='0x1000000000000000000000000000000000000001';
export const DEMO_MERCHANT: Address='0x2000000000000000000000000000000000000002';
export interface DemoState {available:bigint;reserved:bigint;walletBalance:bigint;allowance:bigint;merchantReceived:bigint;nonce:number;holds:Hold[]}
export type DemoAction =
  | {type:'approve';amount:bigint}
  | {type:'deposit';amount:bigint}
  | {type:'withdraw';amount:bigint}
  | {type:'create';merchant:Address;amount:bigint;expiresAt:number;description:string}
  | {type:'capture';id:Hash;amount:bigint;actor:Address}
  | {type:'release';id:Hash;actor:Address}
  | {type:'expired';id:Hash};
export function initialDemoState(): DemoState {return {available:100_000_000n,reserved:0n,walletBalance:400_000_000n,allowance:0n,merchantReceived:0n,nonce:0,holds:[]};}
function positive(amount:bigint) {if(amount<=0n) throw new Error('Amount must be greater than zero.');}
export function demoTransition(previous:DemoState,action:DemoAction,now=Math.floor(Date.now()/1000)):DemoState {
  const state={...previous,holds:previous.holds.map(hold=>({...hold}))};
  if ('amount' in action) positive(action.amount);
  if(action.type==='approve') state.allowance=action.amount;
  else if(action.type==='deposit') {
    if(state.walletBalance<action.amount) throw new Error('Insufficient wallet USDG. Obtain test USDG first.');
    if(state.allowance<action.amount) throw new Error('Approve this deposit amount first.');
    state.walletBalance-=action.amount;state.allowance-=action.amount;state.available+=action.amount;
  } else if(action.type==='withdraw') {
    if(state.available<action.amount) throw new Error('Insufficient available Cova balance. Reserved funds cannot be withdrawn.');
    state.available-=action.amount;state.walletBalance+=action.amount;
  } else if(action.type==='create') {
    if(action.amount>state.available) throw new Error('Insufficient available Cova balance. Deposit USDG first.');
    if(action.expiresAt<=now) throw new Error('Choose an expiry in the future.');
    state.nonce++;
    state.holds.unshift({id:keccak256(toHex(`demo-hold-${state.nonce}`)),customer:DEMO_CUSTOMER,merchant:action.merchant,
      authorizedAmount:action.amount,capturedAmount:0n,expiresAt:action.expiresAt,status:1,referenceId:keccak256(toHex(action.description)),description:action.description});
    state.available-=action.amount;state.reserved+=action.amount;
  } else {
    const hold=state.holds.find(h=>h.id===action.id);
    if(!hold || hold.status!==1) throw new Error('This authorization is already settled or does not exist.');
    const remaining=hold.authorizedAmount-hold.capturedAmount;
    if(action.type==='capture') {
      if(action.actor.toLowerCase()!==hold.merchant.toLowerCase()) throw new Error('Connect the authorized merchant wallet to capture.');
      if(now>=hold.expiresAt) throw new Error('Authorization expired. Release the remaining funds.');
      if(action.amount>remaining) throw new Error('Capture exceeds the remaining authorization.');
      hold.capturedAmount+=action.amount;state.reserved-=action.amount;state.merchantReceived+=action.amount;
      if(hold.capturedAmount===hold.authorizedAmount) hold.status=2;
    } else {
      if(action.type==='release' && action.actor.toLowerCase()!==hold.merchant.toLowerCase()) throw new Error('Only the merchant can release before expiry.');
      if(action.type==='expired' && now<hold.expiresAt) throw new Error('Authorization has not expired yet.');
      state.available+=remaining;state.reserved-=remaining;hold.status=3;
    }
  }
  state.holds=state.holds.map(h=>({...h,customerAvailable:state.available}));
  return state;
}
