import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TransactionReceipt, WaitForTransactionReceiptParameters, Hash } from 'viem';
import { waitForCovaReceipt } from '../lib/transactions';
const original=('0x'+'1'.repeat(64)) as Hash;
const replacement=('0x'+'2'.repeat(64)) as Hash;
const receipt={status:'success',transactionHash:replacement,logs:[]} as unknown as TransactionReceipt;
test('a successful cancellation receipt does not confirm a Cova payment',async()=>{
  const wait=async(args:WaitForTransactionReceiptParameters)=>{
    args.onReplaced?.({reason:'cancelled',transactionReceipt:receipt} as Parameters<NonNullable<WaitForTransactionReceiptParameters['onReplaced']>>[0]);return receipt;
  };
  await assert.rejects(waitForCovaReceipt(wait,original,()=>{}),/cancelled/);
});
test('repriced payment uses the replacement hash and a different replacement fails',async()=>{
  let displayed:Hash=original;
  const wait=async(args:WaitForTransactionReceiptParameters)=>{
    args.onReplaced?.({reason:'repriced',transactionReceipt:receipt} as Parameters<NonNullable<WaitForTransactionReceiptParameters['onReplaced']>>[0]);return receipt;
  };
  assert.equal((await waitForCovaReceipt(wait,original,hash=>{displayed=hash;})).transactionHash,replacement);assert.equal(displayed,replacement);
  await assert.rejects(waitForCovaReceipt(async args=>{
    args.onReplaced?.({reason:'replaced',transactionReceipt:receipt} as Parameters<NonNullable<WaitForTransactionReceiptParameters['onReplaced']>>[0]);return receipt;
  },original,()=>{}),/replaced/);
});
