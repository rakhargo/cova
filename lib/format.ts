import { formatUnits } from 'viem';
import type { Hold } from './types';
export function formatAmount(amount: bigint, decimals=6) {
  const [whole, fraction]=formatUnits(amount,decimals).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',') + (fraction ? '.'+fraction : '');
}
export function shortAddress(address: string) { return address.slice(0,6)+'…'+address.slice(-4); }
export function remainingAmount(hold: Hold) { return hold.status===1 ? hold.authorizedAmount-hold.capturedAmount : 0n; }
export function releasedAmount(hold: Hold) { return hold.status===3 ? hold.authorizedAmount-hold.capturedAmount : 0n; }
