import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseUnits, type Abi, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { mnemonicToAccount } from 'viem/accounts';

// The well-known Anvil test mnemonic is intentionally local-only, never a live secret.
const mnemonic='test test test test test test test test test test test junk';
const customer=mnemonicToAccount(mnemonic,{addressIndex:0});
const merchant=mnemonicToAccount(mnemonic,{addressIndex:1});
const rpc='http://127.0.0.1:8545';
const client=createPublicClient({chain:foundry,transport:http(rpc)});
const wallet=createWalletClient({account:customer,chain:foundry,transport:http(rpc)});
if(await client.getChainId()!==31337) throw new Error('Local deployment requires Anvil chain 31337.');
function artifact(name:string) {
  return JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`,'utf8')) as {abi:Abi;bytecode:{object:Hex}};
}
const tokenArtifact=artifact('MockUSDG');
const tokenReceipt=await client.waitForTransactionReceipt({hash:await wallet.deployContract({abi:tokenArtifact.abi,bytecode:tokenArtifact.bytecode.object})});
if(tokenReceipt.status!=='success' || !tokenReceipt.contractAddress) throw new Error('Local token deployment failed.');
const token=tokenReceipt.contractAddress;
const vaultArtifact=artifact('CovaVault');
const vaultReceipt=await client.waitForTransactionReceipt({hash:await wallet.deployContract({abi:vaultArtifact.abi,bytecode:vaultArtifact.bytecode.object,args:[token]})});
if(vaultReceipt.status!=='success' || !vaultReceipt.contractAddress) throw new Error('Vault deployment failed.');
const vault=vaultReceipt.contractAddress;
await client.waitForTransactionReceipt({hash:await wallet.writeContract({address:token,abi:tokenArtifact.abi,functionName:'mint',args:[customer.address,parseUnits('1000',6)]})});
writeFileSync('local-deployment.json',JSON.stringify({chainId:31337,token,vault,customer:customer.address,merchant:merchant.address},null,2)+'\n');
const env=`# LOCAL ANVIL ONLY. MockUSDG is a test fixture, not Paxos USDG.\nNEXT_PUBLIC_CHAIN_ID=31337\nNEXT_PUBLIC_RPC_URL=${rpc}\nNEXT_PUBLIC_USDG_ADDRESS=${token}\nNEXT_PUBLIC_COVA_VAULT_ADDRESS=${vault}\nNEXT_PUBLIC_DEMO_MERCHANT_ADDRESS=${merchant.address}\n`;
// Use a separate file so a developer's live .env.local is never overwritten.
writeFileSync('.env.anvil',env);
console.log(JSON.stringify({network:'Local Anvil only',token,vault,customer:customer.address,merchant:merchant.address,frontendEnv:'.env.anvil'},null,2));
