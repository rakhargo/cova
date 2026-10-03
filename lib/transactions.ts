import type { Hash, TransactionReceipt, WaitForTransactionReceiptParameters } from 'viem';
export async function waitForCovaReceipt(
  wait:(args:WaitForTransactionReceiptParameters)=>Promise<TransactionReceipt>,hash:Hash,onHash:(hash:Hash)=>void
) {
  let changedReason:'cancelled'|'replaced'|undefined;
  const receipt=await wait({hash,confirmations:1,timeout:180_000,onReplaced:replacement=>{
    onHash(replacement.transactionReceipt.transactionHash);
    if(replacement.reason==='cancelled' || replacement.reason==='replaced') changedReason=replacement.reason;
  }});
  if(changedReason) throw new Error(`Wallet transaction ${changedReason}. The Cova action was not confirmed. Check the latest transaction before trying again.`);
  if(receipt.status!=='success') throw new Error('Transaction reverted. Refresh balances and check wallet permissions.');
  return receipt;
}
