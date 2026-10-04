export function formatHoldExpiry(expiresAt:number, raw?:bigint):{iso?:string;label:string} {
 const milliseconds=expiresAt*1000;
 if(!Number.isFinite(milliseconds) || Math.abs(milliseconds)>8640000000000000) return {label:raw===undefined?'Beyond calendar range':`Unix timestamp ${raw.toString()}`};
 const date=new Date(milliseconds);
 return {iso:date.toISOString(),label:date.toLocaleString()};
}
