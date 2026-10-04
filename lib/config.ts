import { getAddress, isAddress, zeroAddress, type Address } from 'viem';
export const OFFICIAL_USDG:Address='0xFFC95faa3d63Cde504a05B567C600B78C0b41892';
export interface CovaConfig {demo:boolean;local:boolean;chainId:421614|31337;rpc:string;vault?:Address;token:Address;deploymentBlock?:bigint}
export function resolveConfig(env:{vault?:string;token?:string;chainId?:string;rpc?:string;deploymentBlock?:string}):CovaConfig {
  const chainId=Number(env.chainId || 421614);
  if(chainId!==421614 && chainId!==31337) throw new Error('Cova supports Arbitrum Sepolia (421614) or local Anvil (31337).');
  const local=chainId===31337;
  if(local && env.vault && !env.token) throw new Error('Supply the local test token address for Anvil.');
  const token=env.token || OFFICIAL_USDG;
  for(const [name,value] of [['vault',env.vault],['USDG',token]] as const) {
    if(value && (!isAddress(value) || value.toLowerCase()===zeroAddress)) throw new Error(`Invalid ${name} address in environment configuration.`);
  }
  if(!local && getAddress(token)!==getAddress(OFFICIAL_USDG)) throw new Error('Arbitrum Sepolia must use the verified official Paxos USDG token.');
  const rpc=env.rpc || (local?'http://127.0.0.1:8545':'https://sepolia-rollup.arbitrum.io/rpc');
  if(!/^https?:\/\//.test(rpc)) throw new Error('Supply a valid HTTP RPC URL.');
  let deploymentBlock:bigint|undefined;
  if(env.deploymentBlock){if(!/^\d+$/.test(env.deploymentBlock))throw new Error('Invalid deployment block.');deploymentBlock=BigInt(env.deploymentBlock);}
  else if(local)deploymentBlock=0n;
  else if(env.vault?.toLowerCase()==='0xeb008dd97b0d17200055a3c7b5c60ab8b31ce428')deploymentBlock=315383406n;
  return {deploymentBlock,demo:!env.vault,local,chainId,rpc,vault:env.vault?getAddress(env.vault):undefined,token:getAddress(token)};
}
let configError:string|undefined;
let resolved:CovaConfig;
try {resolved=resolveConfig({vault:process.env.NEXT_PUBLIC_COVA_VAULT_ADDRESS,token:process.env.NEXT_PUBLIC_USDG_ADDRESS,chainId:process.env.NEXT_PUBLIC_CHAIN_ID,rpc:process.env.NEXT_PUBLIC_RPC_URL,deploymentBlock:process.env.NEXT_PUBLIC_COVA_DEPLOYMENT_BLOCK});}
catch(error) {configError=error instanceof Error?error.message:'Invalid environment configuration.';resolved=resolveConfig({});}
export const covaConfig=resolved;
export const configurationError=configError;
