import { getAddress, hashTypedData, isAddress, keccak256, toHex, type Address, type Hash, type Hex } from 'viem';

export type HoldAuthorization = {
  customer:Address; merchant:Address; maxAmount:bigint; expiresAt:bigint; nonce:bigint; referenceId:Hash;
};
export type SignedAuthorization = {
  schemaVersion:1; chainId:number; vault:Address; authorization:HoldAuthorization; signature:Hex; description?:string;
};
export const authorizationTypes = {
  HoldAuthorization: [
    {name:'customer',type:'address'}, {name:'merchant',type:'address'},
    {name:'maxAmount',type:'uint128'}, {name:'expiresAt',type:'uint64'},
    {name:'nonce',type:'uint256'}, {name:'referenceId',type:'bytes32'}
  ]
} as const;

export function checkedAddress(value:unknown,label:string):Address {
  if(typeof value!=='string'||!isAddress(value)||/^0x0{40}$/i.test(value)) throw new Error(`${label} must be a nonzero address.`);
  return getAddress(value);
}
export function checkedUint(value:unknown,bits:number,label:string,nonzero=false):bigint {
  if(typeof value!=='bigint'||value<0n||value>=(1n<<BigInt(bits))||(nonzero&&value===0n)) throw new Error(`${label} must fit uint${bits}${nonzero?' and be nonzero':''}.`);
  return value;
}
export function checkedHash(value:unknown,label:string):Hash {
  if(typeof value!=='string'||!/^0x[\da-f]{64}$/i.test(value)) throw new Error(`${label} must be bytes32 hex.`);
  return value as Hash;
}
function record(value:unknown,label:string):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string,unknown>;
}
export function checkedAuthorization(value:unknown):HoldAuthorization {
  const a=record(value,'authorization');
  return {customer:checkedAddress(a.customer,'customer'),merchant:checkedAddress(a.merchant,'merchant'),maxAmount:checkedUint(a.maxAmount,128,'maxAmount',true),expiresAt:checkedUint(a.expiresAt,64,'expiresAt',true),nonce:checkedUint(a.nonce,256,'nonce'),referenceId:checkedHash(a.referenceId,'referenceId')};
}
export function authorizationDomain(chainId:number,vault:Address) {
  if(!Number.isSafeInteger(chainId)||chainId<=0) throw new Error('chainId must be a positive safe integer.');
  return {name:'CovaVault',version:'2',chainId,verifyingContract:checkedAddress(vault,'vault')} as const;
}
export function authorizationTypedData(chainId:number,vault:Address,message:HoldAuthorization) {
  return {domain:authorizationDomain(chainId,vault),types:authorizationTypes,primaryType:'HoldAuthorization',message:checkedAuthorization(message)} as const;
}
export function authorizationDigest(chainId:number,vault:Address,message:HoldAuthorization):Hash {
  return hashTypedData(authorizationTypedData(chainId,vault,message));
}
function checkedEnvelope(value:unknown):SignedAuthorization {
  const e=record(value,'envelope');
  if(e.schemaVersion!==1) throw new Error('Unsupported signed authorization schemaVersion.');
  if(typeof e.chainId!=='number') throw new Error('chainId must be a number.');
  const domain=authorizationDomain(e.chainId,e.vault as Address);
  const authorization=checkedAuthorization(e.authorization);
  if(typeof e.signature!=='string'||!/^0x(?:[\da-f]{2})*$/i.test(e.signature)) throw new Error('signature must be even-length bytes hex.');
  if(e.description!==undefined) {
    if(typeof e.description!=='string'||e.description.length>120) throw new Error('description must be a string of at most 120 characters.');
    if(keccak256(toHex(e.description)).toLowerCase()!==authorization.referenceId.toLowerCase()) throw new Error('description does not match referenceId.');
  }
  return {schemaVersion:1,chainId:e.chainId,vault:domain.verifyingContract,authorization,signature:e.signature as Hex,...(e.description===undefined?{}:{description:e.description as string})};
}
export function encodeSignedAuthorization(envelope:SignedAuthorization):string {
  const json=JSON.stringify(checkedEnvelope(envelope),(_key,value)=>typeof value==='bigint'?value.toString():value);
  if(json.length>65_536) throw new Error('Signed authorization JSON exceeds the 65536 character size limit.');
  return json;
}
export function decodeSignedAuthorization(json:string):SignedAuthorization {
  if(typeof json!=='string'||json.length>65_536) throw new Error('Signed authorization JSON exceeds the 65536 character size limit.');
  const e=record(JSON.parse(json) as unknown,'envelope');
  const a={...record(e.authorization,'authorization')};
  for(const field of ['maxAmount','expiresAt','nonce']) {
    const value=a[field];
    if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${field} must be a canonical decimal string.`);
    a[field]=BigInt(value);
  }
  return checkedEnvelope({...e,authorization:a});
}
