import { erc20Abi, getAddress, type PublicClient, type Address, type Hash } from 'viem';
import { vaultAbi } from './abi';
import type { CovaConfig } from './config';
import type { Hold, HoldStatus } from './types';

export async function verifyDeployment(client:PublicClient,config:CovaConfig) {
  if(!config.vault) throw new Error('Configure the CovaVault address first.');
  const [chainId,vaultCode,tokenCode]=await Promise.all([client.getChainId(),client.getCode({address:config.vault}),client.getCode({address:config.token})]);
  if(chainId!==config.chainId) throw new Error('RPC network does not match the selected Cova chain.');
  if(!vaultCode || vaultCode==='0x') throw new Error('No CovaVault deployed at the configured address on this network.');
  if(!tokenCode || tokenCode==='0x') throw new Error('No USDG token deployed at the configured address.');
  const [token,decimals,symbol]=await Promise.all([
    client.readContract({address:config.vault,abi:vaultAbi,functionName:'token'}),
    client.readContract({address:config.token,abi:erc20Abi,functionName:'decimals'}),
    client.readContract({address:config.token,abi:erc20Abi,functionName:'symbol'})
  ]);
  if(getAddress(token)!==getAddress(config.token)) throw new Error('CovaVault uses a different token. Check the deployment configuration.');
  if((symbol!=='USDG' && !(config.local && symbol==='MockUSDG')) || decimals<0 || decimals>36) throw new Error('Configured settlement asset has invalid USDG metadata.');
  return {decimals};
}
async function readIds(client:PublicClient,config:CovaConfig,owner:Address,role:'customer'|'merchant',blockNumber:bigint) {
  const ids:Hash[]=[];
  for(let offset=0n;;offset+=100n) {
    const page=await client.readContract({address:config.vault!,abi:vaultAbi,functionName:role==='customer'?'getCustomerHoldIds':'getMerchantHoldIds',args:[owner,offset,100n],blockNumber});
    ids.push(...page);
    if(page.length<100) return ids;
  }
}
export async function readSnapshot(client:PublicClient,config:CovaConfig,owner:Address) {
  const blockNumber=await client.getBlockNumber({cacheTime:0});
  const [available,reserved,walletBalance,allowance,customerIds,merchantIds,block]=await Promise.all([
    client.readContract({address:config.vault!,abi:vaultAbi,functionName:'availableBalance',args:[owner],blockNumber}),
    client.readContract({address:config.vault!,abi:vaultAbi,functionName:'heldBalance',args:[owner],blockNumber}),
    client.readContract({address:config.token,abi:erc20Abi,functionName:'balanceOf',args:[owner],blockNumber}),
    client.readContract({address:config.token,abi:erc20Abi,functionName:'allowance',args:[owner,config.vault!],blockNumber}),
    readIds(client,config,owner,'customer',blockNumber), readIds(client,config,owner,'merchant',blockNumber),client.getBlock({blockNumber})
  ]);
  const unique=[...new Set([...customerIds,...merchantIds])];
  const holdList:Hold[]=await Promise.all(unique.map(async id=>{
    const hold=await client.readContract({address:config.vault!,abi:vaultAbi,functionName:'holds',args:[id],blockNumber});
    const customerAvailable=hold[0].toLowerCase()===owner.toLowerCase()?available:await client.readContract({address:config.vault!,abi:vaultAbi,functionName:'availableBalance',args:[hold[0]],blockNumber});
    return {id,customer:hold[0],merchant:hold[1],authorizedAmount:hold[2],capturedAmount:hold[3],expiresAt:Number(hold[4]),status:hold[5] as HoldStatus,referenceId:hold[6],description:'Payment authorization',customerAvailable};
  }));
  const byId=new Map(holdList.map(h=>[h.id,h]));
  return {available,reserved,walletBalance,allowance,blockTimestamp:Number(block.timestamp),fetchedAt:Math.floor(Date.now()/1000),customerHolds:customerIds.toReversed().map(id=>byId.get(id)!),merchantHolds:merchantIds.toReversed().map(id=>byId.get(id)!)};
}
