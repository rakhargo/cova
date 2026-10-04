import { receiptsFromEvents, type HoldHistoryResult } from '../sdk/dist/index.js';
export function mergeHistory(previous:HoldHistoryResult|undefined,next:HoldHistoryResult,fromBlock:bigint,ids:`0x${string}`[],head:bigint):HoldHistoryResult {
 const old=previous?.events ?? [];
 const retained=old.filter(e=>e.blockNumber<=head && (e.blockNumber<fromBlock || (!next.complete && e.blockNumber>next.scannedThrough)));
 const events=[...retained,...next.events.filter(e=>e.blockNumber<=head)].sort((a,b)=>a.blockNumber===b.blockNumber?a.transactionIndex===b.transactionIndex?a.logIndex-b.logIndex:a.transactionIndex-b.transactionIndex:a.blockNumber<b.blockNumber?-1:1);
 const unique=[...new Map(events.map(e=>[e.transactionHash+':'+e.logIndex,e])).values()];
 const oldProgress=previous?.scannedThrough ?? -1n;
 const progress=next.complete?next.scannedThrough:oldProgress>next.scannedThrough?(oldProgress>head?head:oldProgress):next.scannedThrough;
 return {...next,scannedThrough:progress,events:unique,receipts:receiptsFromEvents(unique,ids)};
}
export type HistorySnapshot=HoldHistoryResult & {snapshotEpoch:number};
export function reconcileHistory(merged:HoldHistoryResult,latest:HistorySnapshot|undefined,snapshotEpoch:number):HistorySnapshot {
 if(latest && latest.snapshotEpoch>snapshotEpoch) return latest;
 return {...merged,snapshotEpoch};
}
