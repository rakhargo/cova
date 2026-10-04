import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, erc20Abi, http, keccak256, parseUnits, toHex, type Abi, type Hash, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { mnemonicToAccount } from 'viem/accounts';
import { authorizationDigest, createCovaClient, decodeSignedAuthorization, encodeSignedAuthorization, readHoldHistory, vaultAbi } from '../sdk/src/index.js';

const rpc=process.env.COVA_LOCAL_RPC_URL??'http://127.0.0.1:8545';
const endpoint=new URL(rpc);
if(!['http:','https:'].includes(endpoint.protocol)||!['127.0.0.1','localhost'].includes(endpoint.hostname)||endpoint.username||endpoint.password) throw new Error('SDK integration requires a local loopback RPC endpoint.');
const publicClient=createPublicClient({chain:foundry,transport:http(rpc)});
if(await publicClient.getChainId()!==31337) throw new Error('SDK integration requires local Anvil chain31337.');
// This public test mnemonic is used ONLY after the loopback URL and local chain guards.
const mnemonic='test test test test test test test test test test test junk';
const customer=mnemonicToAccount(mnemonic,{addressIndex:0});
const merchant=mnemonicToAccount(mnemonic,{addressIndex:1});
const relayer=mnemonicToAccount(mnemonic,{addressIndex:2});
assert.notEqual(customer.address,merchant.address);assert.notEqual(customer.address,relayer.address);assert.notEqual(merchant.address,relayer.address);
const customerWallet=createWalletClient({account:customer,chain:foundry,transport:http(rpc)});
const merchantWallet=createWalletClient({account:merchant,chain:foundry,transport:http(rpc)});
const relayerWallet=createWalletClient({account:relayer,chain:foundry,transport:http(rpc)});
function artifact(name:string) {return JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`,'utf8')) as {abi:Abi;bytecode:{object:Hex}};}
async function confirmed(hash:Hash) {const receipt=await publicClient.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');return receipt;}
const tokenArtifact=artifact('MockUSDG');
const tokenReceipt=await confirmed(await customerWallet.deployContract({abi:tokenArtifact.abi,bytecode:tokenArtifact.bytecode.object}));
assert.ok(tokenReceipt.contractAddress);const token=tokenReceipt.contractAddress;
const vaultArtifact=artifact('CovaVault');
const deployment=await confirmed(await customerWallet.deployContract({abi:vaultArtifact.abi,bytecode:vaultArtifact.bytecode.object,args:[token]}));
assert.ok(deployment.contractAddress);const vault=deployment.contractAddress;
const customerSdk=createCovaClient({publicClient,walletClient:customerWallet,vault,chainId:31337,token});
const merchantSdk=createCovaClient({publicClient,walletClient:merchantWallet,vault,chainId:31337,token});
const relayerSdk=createCovaClient({publicClient,walletClient:relayerWallet,vault,chainId:31337,token});
const amount=(value:string)=>parseUnits(value,6);
assert.equal(await customerSdk.protocolVersion(),2);
await confirmed(await customerWallet.writeContract({address:token,abi:tokenArtifact.abi,functionName:'mint',args:[customer.address,amount('100')]}));
await confirmed(await customerWallet.writeContract({address:token,abi:erc20Abi,functionName:'approve',args:[vault,amount('100')]}));
await customerSdk.waitForReceipt(await customerSdk.deposit(amount('100')));
const now=(await publicClient.getBlock()).timestamp;
const authorization=await customerSdk.prepareAuthorization({customer:customer.address,merchant:merchant.address,maxAmount:amount('20'),expiresAt:now+3600n,referenceId:keccak256(toHex('Court Booking'))});
assert.equal(authorization.nonce,0n);
assert.equal(authorizationDigest(31337,vault,authorization),await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'authorizationDigest',args:[authorization]}));
const signed={...await customerSdk.signAuthorization(authorization),description:'Court Booking'};
assert.deepEqual(await customerSdk.balances(customer.address),{available:amount('100'),held:0n});
assert.equal(await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'nonces',args:[customer.address]}),0n);
// Sharing serialized JSON does not require browser storage or a backend.
const imported=decodeSignedAuthorization(encodeSignedAuthorization(signed));
const created=await relayerSdk.waitForReceipt(await relayerSdk.submitAuthorization(imported));
const ids=await merchantSdk.holdIds(merchant.address,'merchant');assert.equal(ids.length,1);const id=ids[0];
assert.deepEqual(await customerSdk.balances(customer.address),{available:amount('80'),held:amount('20')});
assert.equal((await relayerSdk.hold(id)).customer,customer.address);assert.equal((await relayerSdk.hold(id)).merchant,merchant.address);
await assert.rejects(customerSdk.capture(id,amount('14')));
await assert.rejects(relayerSdk.capture(id,amount('14')));
await assert.rejects(relayerSdk.submitAuthorization(imported));
const capturedA=await merchantSdk.waitForReceipt(await merchantSdk.capture(id,amount('10')));
const capturedB=await merchantSdk.waitForReceipt(await merchantSdk.capture(id,amount('4')));
assert.equal(await publicClient.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[merchant.address]}),amount('14'));
const released=await merchantSdk.waitForReceipt(await merchantSdk.release(id));
assert.deepEqual(await customerSdk.balances(customer.address),{available:amount('86'),held:0n});
const hold=await merchantSdk.hold(id);assert.equal(hold.status,3);assert.equal(hold.capturedAmount,amount('14'));

const cancelledMessage=await customerSdk.prepareAuthorization({...authorization,maxAmount:amount('1')});
const cancelled=await customerSdk.signAuthorization(cancelledMessage);assert.equal(cancelledMessage.nonce,1n);
const cancellation=await customerSdk.waitForReceipt(await customerSdk.invalidateAuthorizations(2n));
await assert.rejects(relayerSdk.submitAuthorization(cancelled));
const freshMessage=await customerSdk.prepareAuthorization({...authorization,maxAmount:amount('1')});assert.equal(freshMessage.nonce,2n);
const fresh=await customerSdk.signAuthorization(freshMessage);await relayerSdk.waitForReceipt(await relayerSdk.submitAuthorization(fresh));
await assert.rejects(relayerSdk.submitAuthorization(fresh));
assert.deepEqual(await customerSdk.balances(customer.address),{available:amount('85'),held:amount('1')});
const freshIds=await customerSdk.holdIds(customer.address,'customer');assert.equal(freshIds.length,2);
await merchantSdk.waitForReceipt(await merchantSdk.release(freshIds[1]));

// A new read-only client recovers receipts from chain logs with empty browser state.
const anotherPublicClient=createPublicClient({chain:foundry,transport:http(rpc)});
const readOnly=createCovaClient({publicClient:anotherPublicClient,vault,chainId:31337,token});
const recoveredIds=await readOnly.holdIds(customer.address,'customer');
const toBlock=await anotherPublicClient.getBlockNumber();
const recovered=await readHoldHistory(anotherPublicClient,vault,recoveredIds,{fromBlock:deployment.blockNumber,toBlock,chunkSize:3n});
assert.equal(recovered.complete,true);assert.equal(recovered.scannedThrough,toBlock);
assert.deepEqual(recovered.receipts[id],{createHash:created.transactionHash,captureHashes:[capturedA.transactionHash,capturedB.transactionHash],releaseHash:released.transactionHash});
assert.equal(recovered.events.filter(event=>event.holdId===id).length,4);
await customerSdk.waitForReceipt(await customerSdk.withdraw(amount('86')));
assert.deepEqual(await customerSdk.balances(customer.address),{available:0n,held:0n});
assert.equal(await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'totalLiability'}),0n);
assert.equal(await publicClient.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[vault]}),0n);
console.log(JSON.stringify({network:'Local Anvil chain31337 ONLY; MockUSDG test fixture',success:true,vault,deploymentBlock:deployment.blockNumber.toString(),accounts:{customer:customer.address,merchant:merchant.address,relayer:relayer.address},flow:'100 deposit -> signed20 -> relayer reserve20 -> merchant capture10+4 -> release6 ->86 withdraw',checks:['SDK/onchain digest equality','signature reserves nothing','wrong caller capture rejected','nonce cancellation and replay rejected','fresh read-only receipt recovery without localStorage'],holdId:id,receipts:{...recovered.receipts[id],cancellationHash:cancellation.transactionHash}},null,2));
