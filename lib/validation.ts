import { getAddress, isAddress, parseUnits, zeroAddress } from 'viem';
import { z } from 'zod';
import type { CreateHoldInput } from './types';

export function parseAmount(value: string, decimals: number): bigint {
  const input=value.trim();
  if (!/^\d+(\.\d+)?$/.test(input)) throw new Error('Enter a positive USDG amount, such as 17.42.');
  if ((input.split('.')[1]?.length ?? 0)>decimals) throw new Error(`USDG supports up to ${decimals} decimal places.`);
  const amount=parseUnits(input,decimals);
  if (amount<=0n) throw new Error('Amount must be greater than zero.');
  if (amount>2n**256n-1n) throw new Error('Amount is too large.');
  return amount;
}
const holdSchema=z.object({
  merchant:z.string().refine(v=>isAddress(v) && v.toLowerCase()!==zeroAddress,'Enter a valid, nonzero merchant address.'),
  amount:z.string(),
  expiryMinutes:z.number().int().min(1).max(525600),
  description:z.string().trim().min(1,'Add a reference description.').max(120,'Keep the reference under 120 characters.')
});
export function validateHold(input: CreateHoldInput, decimals: number) {
  const result=holdSchema.safeParse(input);
  if (!result.success) throw new Error(result.error.issues[0].message);
  const amount=parseAmount(result.data.amount,decimals);
  if (amount>2n**128n-1n) throw new Error('Authorization amount is too large.');
  return {...result.data,merchant:getAddress(result.data.merchant),amount};
}
