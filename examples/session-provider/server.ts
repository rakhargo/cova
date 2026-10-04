import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sessionRouterAbi } from '../../sdk/src/session-abi.js';
import { ProviderSessionRunner, createDeterministicWork, type ProviderSession } from './session-runner.js';

const router=process.env.COVA_SESSION_ROUTER_ADDRESS as Address|undefined;
const provider=process.env.COVA_SESSION_PROVIDER_ADDRESS as Address|undefined;
const rpc=process.env.COVA_SESSION_RPC_URL;
const chainId=Number(process.env.COVA_SESSION_CHAIN_ID||421614);
const chain=chainId===421614?defineChain({id:421614,name:'Arbitrum Sepolia',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://sepolia-rollup.arbitrum.io/rpc']}}}):chainId===31337?defineChain({id:31337,name:'Local Anvil',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['http://127.0.0.1:8545']}}}):undefined;
if(!router||!provider||!/^0x[\da-f]{40}$/i.test(router)||!/^0x[\da-f]{40}$/i.test(provider)||!chain)throw new Error('Set COVA_SESSION_ROUTER_ADDRESS, COVA_SESSION_PROVIDER_ADDRESS and supported chain config first.');
const client=createPublicClient({chain,transport:http(rpc||undefined,{timeout:10_000,retryCount:1})});
if(await client.getChainId()!==chainId||!(await client.getCode({address:router})))throw new Error('Session Router is not deployed on the configured provider network.');
const rawProviderKey=process.env.COVA_SESSION_PROVIDER_PRIVATE_KEY;
if(!rawProviderKey||!/^0x[\da-f]{64}$/i.test(rawProviderKey))throw new Error('A dedicated provider key is required to finalize the maximum session duration.');
const providerAccount=privateKeyToAccount(rawProviderKey as Hex);
if(providerAccount.address.toLowerCase()!==provider.toLowerCase())throw new Error('Provider address does not match the configured quote signer.');
const providerWallet=createWalletClient({account:providerAccount,chain,transport:http(rpc||undefined,{timeout:10_000,retryCount:1})});
const reader={
  async list(){const ids:string[]=[];for(let offset=0n;offset<100_000n;offset+=100n){const page=await client.readContract({address:router,abi:sessionRouterAbi,functionName:'getProviderSessionIds',args:[provider,offset,100n]});ids.push(...page);if(page.length<100)break;}return ids;},
  async read(id:string){const [raw,block]=await Promise.all([client.readContract({address:router,abi:sessionRouterAbi,functionName:'sessions',args:[id as `0x${string}`]}),client.getBlock()]);return {id,status:Number(raw[0]) as ProviderSession['status'],provider:raw[4],startedAt:raw[10],stoppedAt:raw[11],maxDurationSeconds:Number(raw[9]),observedAt:block.timestamp};}
};
const runner=new ProviderSessionRunner(reader,createDeterministicWork(),provider,async id=>{const args=[id as `0x${string}`] as const;await client.simulateContract({address:router,abi:sessionRouterAbi,functionName:'settleAtMaxDuration',args,account:providerAccount.address});const hash=await providerWallet.writeContract({account:providerAccount,address:router,abi:sessionRouterAbi,functionName:'settleAtMaxDuration',args});const receipt=await client.waitForTransactionReceipt({hash,confirmations:1,timeout:120_000});if(receipt.status!=='success')throw new Error('Maximum duration settlement reverted.');});
console.info(`Reference provider watching confirmed sessions on ${chain.name}. This local hash workload is illustrative only.`);
async function tick(){try{const result=await runner.pollOnce();if(result)console.info(JSON.stringify({event:'session-work-stopped',sessionId:result.id,reason:result.reason,ticks:result.ticks,localDigest:result.digest}));}catch{console.error('Provider session check failed. It will retry.');}}
await tick();setInterval(()=>void tick(),3000);
