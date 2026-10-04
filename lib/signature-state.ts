import type { Address } from 'viem';
export interface SignatureContext {customer:Address;chainId:number;vault:Address}
export interface PendingSignature extends SignatureContext {json:string}
function matches(packet:PendingSignature,context:SignatureContext) {
 return packet.customer.toLowerCase()===context.customer.toLowerCase() && packet.vault.toLowerCase()===context.vault.toLowerCase() && packet.chainId===context.chainId;
}
export function visibleSignature(packet:PendingSignature|undefined,context:SignatureContext|undefined) {return packet && context && matches(packet,context)?packet.json:undefined;}
export function clearOwnSignature(packet:PendingSignature|undefined,context:SignatureContext) {return packet && matches(packet,context)?undefined:packet;}
