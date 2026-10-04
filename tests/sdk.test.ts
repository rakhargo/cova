import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContractFunctionRevertedError, hashTypedData, keccak256, toHex, verifyTypedData, zeroAddress, type Address, type Hash, type PublicClient, type WalletClient } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { authorizationDomain, authorizationTypedData, authorizationDigest, createCovaClient, decodeSignedAuthorization, encodeSignedAuthorization, type HoldAuthorization, type SignedAuthorization } from '../sdk/src/index.js';

const customer=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:0});
const merchant=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:1});
const relayer=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:2});
const vault='0x1111111111111111111111111111111111111111' as Address;
const token='0x2222222222222222222222222222222222222222' as Address;
const referenceId=keccak256(toHex('Court Booking'));
const message:HoldAuthorization={customer:customer.address,merchant:merchant.address,maxAmount:20_000_000n,expiresAt:2_000_000_000n,nonce:0n,referenceId};
async function envelope():Promise<SignedAuthorization> { return {schemaVersion:1,chainId:31337,vault,authorization:message,signature:await customer.signTypedData(authorizationTypedData(31337,vault,message)),description:'Court Booking'}; }

test('signed JSON roundtrip preserves base units and EOA signature validity',async()=>{
  const original=await envelope(); const json=encodeSignedAuthorization(original);
  assert.equal(JSON.parse(json).authorization.maxAmount,'20000000');
  const decoded=decodeSignedAuthorization(json);
  assert.deepEqual(decoded,original);
  assert.equal(await verifyTypedData({...authorizationTypedData(decoded.chainId,decoded.vault,decoded.authorization),address:customer.address,signature:decoded.signature}),true);
  assert.equal(authorizationDigest(31337,vault,message),hashTypedData(authorizationTypedData(31337,vault,message)));
});

test('signature binds every field, chain and vault',async()=>{
  const signed=await envelope();
  const mutations:HoldAuthorization[]=[{...message,customer:relayer.address},{...message,merchant:relayer.address},{...message,maxAmount:19n},{...message,expiresAt:message.expiresAt+1n},{...message,nonce:1n},{...message,referenceId:keccak256(toHex('Other'))}];
  for(const altered of mutations) assert.equal(await verifyTypedData({...authorizationTypedData(31337,vault,altered),address:customer.address,signature:signed.signature}),false);
  assert.equal(await verifyTypedData({...authorizationTypedData(1,vault,message),address:customer.address,signature:signed.signature}),false);
  assert.equal(await verifyTypedData({...authorizationTypedData(31337,token,message),address:customer.address,signature:signed.signature}),false);
});

test('codec rejects width, zero address, domain and hex errors while preserving ERC1271 bytes',async()=>{
  const original=await envelope();
  for(const altered of [{...message,maxAmount:0n},{...message,maxAmount:1n<<128n},{...message,expiresAt:1n<<64n},{...message,nonce:1n<<256n},{...message,nonce:-1n},{...message,customer:zeroAddress},{...message,merchant:zeroAddress},{...message,referenceId:'0x12' as Hash}]) assert.throws(()=>encodeSignedAuthorization({...original,authorization:altered}));
  for(const chainId of [0,-1,1.1,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>authorizationDomain(chainId,vault));
  assert.throws(()=>authorizationDomain(1,zeroAddress));
  assert.throws(()=>encodeSignedAuthorization({...original,signature:'0x123'}));
  assert.throws(()=>encodeSignedAuthorization({...original,description:'Altered description'}),/reference/i);
  assert.equal(decodeSignedAuthorization(encodeSignedAuthorization({...original,signature:'0x1234'})).signature,'0x1234');
  const json=JSON.parse(encodeSignedAuthorization(original));
  json.authorization.maxAmount=20_000_000;
  assert.throws(()=>decodeSignedAuthorization(JSON.stringify(json)),/decimal/i);
  json.authorization.maxAmount='020000000';
  assert.throws(()=>decodeSignedAuthorization(JSON.stringify(json)),/decimal/i);
  assert.throws(()=>decodeSignedAuthorization('{"schemaVersion":2}'));
});

function clients(overrides:Record<string,unknown>={}) {
  const publicClient={getChainId:async()=>31337,getBlockNumber:async()=>50n,getBlock:async()=>({timestamp:1_900_000_000n}),readContract:async({functionName}:{functionName:string})=>{
    if(functionName==='token') return token;
    if(functionName==='version') return 2n;
    if(functionName==='eip712Domain') return ['0x0f','CovaVault','2',31337n,vault,('0x'+'0'.repeat(64)),[]];
    if(functionName==='nonces') return 0n;
    if(functionName==='availableBalance') return 100n;
    if(functionName==='heldBalance') return 20n;
    throw new Error(functionName);
  },simulateContract:async(args:unknown)=>({request:args}),...overrides} as unknown as PublicClient;
  const walletClient={account:relayer,chain:{id:31337},getChainId:async()=>31337,getAddresses:async()=>[relayer.address],writeContract:async()=>('0x'+'a'.repeat(64)) as Hash,signTypedData:async(args:Parameters<typeof customer.signTypedData>[0])=>relayer.signTypedData(args)} as unknown as WalletClient;
  return {publicClient,walletClient};
}

test('v1 fallback needs absent-method contract revert; RPC and custom reverts propagate',async()=>{
  const missing=new ContractFunctionRevertedError({abi:[],functionName:'version',data:'0x'});
  const base=clients();
  const v1=createCovaClient({...clients({readContract:async(args:{functionName:string})=>{if(args.functionName==='version') throw missing;return base.publicClient.readContract(args as never);}}),chainId:31337,vault});
  assert.equal(await v1.protocolVersion(),1);
  assert.deepEqual(await v1.balances(customer.address),{available:100n,held:20n});
  await assert.rejects(v1.prepareAuthorization(message),/version|v2|support/i);
  for(const error of [new Error('RPC network unavailable'),new ContractFunctionRevertedError({abi:[],functionName:'version',message:'Access forbidden'})]) {
    await assert.rejects(createCovaClient({...clients({readContract:async()=>{throw error;}}),chainId:31337,vault}).protocolVersion());
  }
  await assert.rejects(createCovaClient({...clients({getChainId:async()=>1}),chainId:31337,vault}).protocolVersion(),/chain/i);
});

test('submission permits real relayer and relies on contract simulation rather than offchain verification',async()=>{
  const original=await envelope();
  let simulated=false; let submitted=false;
  const {publicClient,walletClient}=clients({simulateContract:async(args:{account:Address;args:unknown[];functionName:string})=>{
    assert.equal(args.account,relayer.address);
    assert.equal(args.functionName,'authorizeHold');
    assert.deepEqual(args.args,[message,'0x1234']); simulated=true;
    return {request:args};
  }});
  walletClient.writeContract=async()=>{assert.equal(simulated,true);submitted=true;return ('0x'+'a'.repeat(64)) as Hash;};
  assert.equal(await createCovaClient({publicClient,walletClient,chainId:31337,vault,token}).submitAuthorization({...original,signature:'0x1234'}),('0x'+'a'.repeat(64)));
  assert.equal(submitted,true);
  const reject=clients({simulateContract:async()=>{throw new Error('InvalidSignature');}});
  reject.walletClient.writeContract=async()=>{assert.fail('simulation failure must prevent broadcast');};
  await assert.rejects(createCovaClient({...reject,chainId:31337,vault}).submitAuthorization(original),/InvalidSignature/);
});

test('writes reject envelope, wallet, token and EIP712 context mismatches before broadcast',async()=>{
  const original=await envelope();
  const c=createCovaClient({...clients(),vault,chainId:31337,token});
  await assert.rejects(c.submitAuthorization({...original,chainId:1}),/chain/i);
  await assert.rejects(c.submitAuthorization({...original,vault:token}),/vault/i);
  await assert.rejects(c.signAuthorization(message),/customer|account/i);
  await assert.rejects(c.invalidateAuthorizations((1n<<256n)-1n),/nonce/i);
  const wrongWallet=clients();wrongWallet.walletClient.getChainId=async()=>1;
  await assert.rejects(createCovaClient({...wrongWallet,vault,chainId:31337}).deposit(1n),/chain/i);
  await assert.rejects(createCovaClient({...clients(),vault,chainId:31337,token:vault}).deposit(1n),/token/i);
  const wrongDomain=clients({readContract:async(args:{functionName:string})=>args.functionName==='eip712Domain'?['0x0f','CovaVault','1',31337n,vault,('0x'+'0'.repeat(64)),[]]:clients().publicClient.readContract(args as never)});
  await assert.rejects(createCovaClient({...wrongDomain,vault,chainId:31337}).protocolVersion(),/domain/i);
});


test('prepare/sign reject expired or unfunded authorizations before opening the signing wallet',async()=>{
  let signed=0;
  const base=clients();
  base.walletClient.account=customer;
  base.walletClient.getAddresses=async()=>[customer.address];
  base.walletClient.signTypedData=async args=>{signed++;return customer.signTypedData(args as Parameters<typeof customer.signTypedData>[0]);};
  const c=createCovaClient({...base,vault,chainId:31337});
  await assert.rejects(c.prepareAuthorization({...message,expiresAt:1_900_000_000n}),/expiry|expire/i);
  await assert.rejects(c.signAuthorization({...message,expiresAt:1_900_000_000n}),/expiry|expire/i);
  await assert.rejects(c.prepareAuthorization(message),/fund/i);
  await assert.rejects(c.signAuthorization(message),/fund/i);
  assert.equal(signed,0);
});

test('successful signing checks SignatureChecker by eth_call without broadcasting or reserving funds',async()=>{
  let signed=0;let simulated=0;let writes=0;
  const base=clients();base.walletClient.account=customer;base.walletClient.getAddresses=async()=>[customer.address];
  base.walletClient.signTypedData=async args=>{signed++;return customer.signTypedData(args as Parameters<typeof customer.signTypedData>[0]);};
  base.walletClient.writeContract=async()=>{writes++;throw new Error('must not write while signing');};
  base.publicClient.simulateContract=async args=>{assert.equal(args.account,customer.address);assert.equal(args.functionName,'authorizeHold');simulated++;return {request:args} as never;};
  const c=createCovaClient({...base,vault,chainId:31337});
  const envelope=await c.signAuthorization({...message,maxAmount:20n});
  assert.equal(await verifyTypedData({...authorizationTypedData(31337,vault,envelope.authorization),address:customer.address,signature:envelope.signature}),true);
  assert.equal(signed,1);assert.equal(simulated,1);assert.equal(writes,0);
});

test('balances and hold IDs pin reads to a fresh uncached block',async()=>{
  let fresh=0;const blocks:(bigint|undefined)[]=[];const base=clients();
  base.publicClient.getBlockNumber=async options=>{assert.equal(options?.cacheTime,0);fresh++;return 50n;};
  const original=base.publicClient.readContract;
  base.publicClient.readContract=async args=>{if(['availableBalance','heldBalance','getCustomerHoldIds'].includes(args.functionName)) blocks.push(args.blockNumber);return (args.functionName==='getCustomerHoldIds'?[]:await original(args as never)) as never;};
  const c=createCovaClient({...base,vault,chainId:31337});await c.balances(customer.address);await c.holdIds(customer.address,'customer');
  assert.equal(fresh,2);assert.deepEqual(blocks,[50n,50n,50n]);
});

test('portable JSON bounds descriptions and payload size and retains contract error cause',async()=>{
  const original=await envelope();
  const long='a'.repeat(121);
  assert.throws(()=>encodeSignedAuthorization({...original,description:long,authorization:{...message,referenceId:keccak256(toHex(long))}}),/description/i);
  assert.throws(()=>decodeSignedAuthorization(' '.repeat(65_537)),/size|large/i);
  const failure=new ContractFunctionRevertedError({abi:[],functionName:'capture',message:'InvalidNonce'});
  const c=createCovaClient({...clients({simulateContract:async()=>{throw failure;}}),vault,chainId:31337});
  await assert.rejects(c.capture(referenceId,1n),(error:unknown)=>error instanceof Error&&error.cause===failure);
});

test('bound history rejects RPC chain and vault token mismatches before fetching logs',async()=>{
  let logs=0;
  const getLogs=async()=>{logs++;return [];};
  const wrongChain=createCovaClient({...clients({getChainId:async()=>1,getLogs}),vault,chainId:31337,token});
  await assert.rejects(wrongChain.readHoldHistory([referenceId],{fromBlock:0n,toBlock:10n}),/chain/i);
  const wrongToken=createCovaClient({...clients({getLogs}),vault,chainId:31337,token:vault});
  await assert.rejects(wrongToken.readHoldHistory([referenceId],{fromBlock:0n,toBlock:10n}),/token/i);
  assert.equal(logs,0);
});

test('SDK receipt helper rejects successful cancellation and changed replacement receipts',async()=>{
  const hash=('0x'+'1'.repeat(64)) as Hash;
  const replacement=('0x'+'2'.repeat(64)) as Hash;
  const receipt={status:'success',transactionHash:replacement,logs:[]} as unknown as import('viem').TransactionReceipt;
  for(const reason of ['cancelled','replaced'] as const) {
    const base=clients({waitForTransactionReceipt:async(args:import('viem').WaitForTransactionReceiptParameters)=>{
      args.onReplaced?.({reason,transactionReceipt:receipt} as Parameters<NonNullable<typeof args.onReplaced>>[0]);
      return receipt;
    }});
    await assert.rejects(createCovaClient({...base,vault,chainId:31337}).waitForReceipt(hash),new RegExp(reason));
  }
});

test('SDK receipt helper accepts repricing and forwards the actual replacement hash',async()=>{
  const hash=('0x'+'1'.repeat(64)) as Hash;
  const replacement=('0x'+'2'.repeat(64)) as Hash;
  const receipt={status:'success',transactionHash:replacement,logs:[]} as unknown as import('viem').TransactionReceipt;
  const base=clients({waitForTransactionReceipt:async(args:import('viem').WaitForTransactionReceiptParameters)=>{
    assert.equal(args.hash,hash);
    args.onReplaced?.({reason:'repriced',transactionReceipt:receipt} as Parameters<NonNullable<typeof args.onReplaced>>[0]);
    return receipt;
  }});
  let forwarded:Hash|undefined;
  const result=await createCovaClient({...base,vault,chainId:31337}).waitForReceipt(hash,{onReplaced:event=>{forwarded=event.transactionReceipt.transactionHash;}});
  assert.equal(result.transactionHash,replacement);assert.equal(forwarded,replacement);
});
