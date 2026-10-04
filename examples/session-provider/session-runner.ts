import { createHash } from 'node:crypto';

export type ProviderSession={id:string;status:0|1|2|3;startedAt:bigint;stoppedAt:bigint;maxDurationSeconds:number;provider:string;observedAt?:bigint};
export type SessionReader={list:()=>Promise<string[]>;read:(id:string)=>Promise<ProviderSession>};
export type SessionWork={start:(session:ProviderSession)=>void;stop:(session:ProviderSession,reason:'settled'|'expired'|'maximum')=>{ticks:number;digest:string}};

export class ProviderSessionRunner {
  private active=new Set<string>();
  private finished=new Set<string>();
  private capped=new Set<string>();
  private polling=false;
  constructor(private readonly reader:SessionReader,private readonly work:SessionWork,private readonly provider:string,private readonly finalizeMaximum?:(id:string)=>Promise<void>){}

  async pollOnce(){
    if(this.polling)return;this.polling=true;
    try{for(const id of await this.reader.list()){
      const key=id.toLowerCase();if(this.finished.has(key))continue;
      const session=await this.reader.read(id);if(session.provider.toLowerCase()!==this.provider.toLowerCase())continue;
      if(session.status===1){
        if(this.capped.has(key)){await this.finalizeMaximum?.(id);continue;}
        if(session.startedAt>0n&&session.observedAt!==undefined&&session.observedAt-session.startedAt>=BigInt(session.maxDurationSeconds)){
          const receipt=this.active.has(key)?this.work.stop(session,'maximum'):{ticks:0,digest:''};
          this.active.delete(key);this.capped.add(key);await this.finalizeMaximum?.(id);return {id,reason:'maximum',...receipt};
        }
        if(session.startedAt===0n)continue;if(!this.active.has(key)){this.active.add(key);this.work.start(session);}continue;
      }
      if(this.active.delete(key)){const reason=session.status===2?'settled':'expired';const receipt=this.work.stop(session,reason);this.finished.add(key);return {id,reason,...receipt};}
      if(session.status===2||session.status===3)this.finished.add(key);
    }}finally{this.polling=false;}
  }
}

export function createDeterministicWork():SessionWork{
  const jobs=new Map<string,{timer:ReturnType<typeof setInterval>;ticks:number;digest:string}>();
  return {
    start(session){const id=session.id.toLowerCase();if(jobs.has(id))return;const job={ticks:0,digest:session.id,timer:setInterval(()=>{job.digest=createHash('sha256').update(job.digest).update(String(job.ticks)).digest('hex');job.ticks++;},10)};jobs.set(id,job);},
    stop(session){const id=session.id.toLowerCase();const job=jobs.get(id);if(!job)return {ticks:0,digest:''};clearInterval(job.timer);jobs.delete(id);return {ticks:job.ticks,digest:job.digest};}
  };
}
