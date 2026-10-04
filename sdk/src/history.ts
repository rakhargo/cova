import { getAbiItem, type Address, type Hash, type PublicClient } from 'viem';
import { vaultAbi } from './abi.js';
import { checkedAddress, checkedHash } from './authorization.js';
import { safeErrorMessage } from './errors.js';

export type HoldReceipt={createHash?:Hash;captureHashes:Hash[];releaseHash?:Hash};
export type HoldHistoryEvent={eventName:'HoldCreated'|'HoldCaptured'|'HoldReleased';holdId:Hash;transactionHash:Hash;blockNumber:bigint;blockHash:Hash;transactionIndex:number;logIndex:number;amount:bigint;customer?:Address;merchant?:Address;expiresAt?:bigint;referenceId?:Hash;removed?:boolean};
export type HoldHistoryOptions={fromBlock:bigint;toBlock:bigint;chunkSize?:bigint;maxRequests?:number};
export type HoldHistoryResult={receipts:Record<Hash,HoldReceipt>;events:HoldHistoryEvent[];scannedThrough:bigint;complete:boolean;error?:string};
const holdEvents=[getAbiItem({abi:vaultAbi,name:'HoldCreated'}),getAbiItem({abi:vaultAbi,name:'HoldCaptured'}),getAbiItem({abi:vaultAbi,name:'HoldReleased'})] as const;

function orderedEvents(events:readonly HoldHistoryEvent[],holdIds?:readonly Hash[]):HoldHistoryEvent[] {
  const wanted=holdIds&&new Set(holdIds.map(id=>id.toLowerCase()));const seen=new Set<string>();
  return [...events].filter(event=>{
    if(event.removed||(wanted&&!wanted.has(event.holdId.toLowerCase()))) return false;
    const key=`${event.blockHash}:${event.transactionHash}:${event.logIndex}`.toLowerCase();
    if(seen.has(key)) return false;seen.add(key);return true;
  }).sort((a,b)=>a.blockNumber<b.blockNumber?-1:a.blockNumber>b.blockNumber?1:a.transactionIndex-b.transactionIndex||a.logIndex-b.logIndex);
}
export function receiptsFromEvents(events:readonly HoldHistoryEvent[],holdIds?:readonly Hash[]):Record<Hash,HoldReceipt> {
  const receipts:Record<Hash,HoldReceipt>={};
  for(const id of holdIds??[]) receipts[id]={captureHashes:[]};
  const keys=new Map((holdIds??[]).map(id=>[id.toLowerCase(),id]));
  for(const event of orderedEvents(events,holdIds)) {
    const id=keys.get(event.holdId.toLowerCase())??event.holdId;
    const receipt=receipts[id]??={captureHashes:[]};
    if(event.eventName==='HoldCreated') receipt.createHash??=event.transactionHash;
    else if(event.eventName==='HoldReleased') receipt.releaseHash=event.transactionHash;
    else if(!receipt.captureHashes.some(hash=>hash.toLowerCase()===event.transactionHash.toLowerCase())) receipt.captureHashes.push(event.transactionHash);
  }return receipts;
}
function rangeLimit(error:unknown):boolean {
  const message=safeErrorMessage(error);
  if(/rate limit|too many requests|quota|unauthori[sz]ed|forbidden/i.test(message)) return false;
  return /block range|range (?:is )?too (?:large|wide)|too many (?:results|logs)|query returned more than|response (?:size|too large)|log response size|exceed(?:ed|s).*(?:block|result|log)|(?:block|result|log).*limit/i.test(message);
}
export async function readHoldHistory(client:PublicClient,vault:Address,holdIds:Hash[],options:HoldHistoryOptions):Promise<HoldHistoryResult> {
  checkedAddress(vault,'vault');holdIds.forEach(id=>checkedHash(id,'holdId'));
  const {fromBlock,toBlock,maxRequests=40}=options;let chunkSize=options.chunkSize??2000n;
  if(typeof fromBlock!=='bigint'||typeof toBlock!=='bigint'||fromBlock<0n||toBlock<0n||typeof chunkSize!=='bigint'||chunkSize<1n||!Number.isSafeInteger(maxRequests)||maxRequests<1) throw new Error('History requires nonnegative fixed block bounds, positive chunkSize and maxRequests.');
  if(fromBlock>toBlock) return {receipts:receiptsFromEvents([],holdIds),events:[],scannedThrough:toBlock,complete:true};
  const wanted=new Set(holdIds.map(id=>id.toLowerCase()));const events:HoldHistoryEvent[]=[];
  let cursor=fromBlock;let scannedThrough=fromBlock-1n;let requests=0;let error:string|undefined;
  while(cursor<=toBlock) {
    if(requests>=maxRequests) {error='History request budget exhausted; resume after scannedThrough.';break;}
    const end=cursor+chunkSize-1n<toBlock?cursor+chunkSize-1n:toBlock;
    requests++;
    try {
      const logs=await client.getLogs({address:vault,events:holdEvents,fromBlock:cursor,toBlock:end,strict:true});
      const chunk:HoldHistoryEvent[]=[];
      for(const log of logs) {
        if(log.removed||log.blockNumber===null||log.blockHash===null||log.transactionHash===null||log.transactionIndex===null||log.logIndex===null||!wanted.has(log.args.holdId.toLowerCase())||log.address.toLowerCase()!==vault.toLowerCase()||log.blockNumber<cursor||log.blockNumber>end) continue;
        const event:HoldHistoryEvent={eventName:log.eventName,holdId:log.args.holdId,amount:log.args.amount,transactionHash:log.transactionHash,blockNumber:log.blockNumber,blockHash:log.blockHash,transactionIndex:log.transactionIndex,logIndex:log.logIndex};
        if(log.eventName==='HoldCreated') {event.customer=log.args.customer;event.merchant=log.args.merchant;event.expiresAt=log.args.expiresAt;event.referenceId=log.args.referenceId;}
        chunk.push(event);
      }
      events.push(...chunk);scannedThrough=end;cursor=end+1n;
    } catch(failure) {
      if(chunkSize>1n&&rangeLimit(failure)) {chunkSize=chunkSize/2n||1n;continue;}
      error=safeErrorMessage(failure);break;
    }
  }
  const sorted=orderedEvents(events,holdIds);
  return {receipts:receiptsFromEvents(sorted,holdIds),events:sorted,scannedThrough,complete:cursor>toBlock,...(error?{error}:{})};
}
