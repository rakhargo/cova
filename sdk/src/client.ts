import { ContractFunctionRevertedError, type Abi, type Address, type Hash, type PublicClient, type WalletClient, type WaitForTransactionReceiptParameters } from 'viem';
import { vaultAbi } from './abi.js';
import { authorizationDomain, authorizationTypedData, checkedAddress, checkedAuthorization, checkedHash, checkedUint, decodeSignedAuthorization, encodeSignedAuthorization, type HoldAuthorization, type SignedAuthorization } from './authorization.js';
import { safeCall } from './errors.js';
import { readHoldHistory, type HoldHistoryOptions } from './history.js';

export type CovaClientOptions={publicClient:PublicClient;walletClient?:WalletClient;vault:Address;chainId:number;token?:Address};
export type CovaBalances={available:bigint;held:bigint};
export type CovaHold={id:Hash;customer:Address;merchant:Address;authorizedAmount:bigint;capturedAmount:bigint;expiresAt:bigint;status:0|1|2|3;referenceId:Hash};
type WriteFunction='deposit'|'withdraw'|'createHold'|'capture'|'release'|'releaseExpired'|'authorizeHold'|'invalidateAuthorizations';
const maxNonce=(1n<<256n)-1n;

function absentVersion(error:unknown):boolean {
  const seen=new Set<unknown>();
  let current=error;
  while(current&&typeof current==='object'&&!seen.has(current)) {
    seen.add(current);
    if(current instanceof ContractFunctionRevertedError) return !current.data&&!current.signature&&(current.raw===undefined||current.raw==='0x')&&(current.reason===undefined||current.reason==='execution reverted');
    current='cause' in current?current.cause:undefined;
  }
  return false;
}
export function createCovaClient(options:CovaClientOptions) {
  const {publicClient,walletClient,chainId}=options;
  const vault=authorizationDomain(chainId,options.vault).verifyingContract;
  const token=options.token===undefined?undefined:checkedAddress(options.token,'token');
  async function context() {
    if(publicClient.chain&&publicClient.chain.id!==chainId) throw new Error('Public client chain differs from the configured chain.');
    if(await publicClient.getChainId()!==chainId) throw new Error('RPC chain differs from the configured chain.');
    const actualToken=checkedAddress(await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'token'}),'vault token');
    if(token&&actualToken.toLowerCase()!==token.toLowerCase()) throw new Error('Vault token differs from the configured token.');
  }
  async function caller() {
    if(!walletClient) throw new Error('A walletClient is required for signing and writes.');
    if(walletClient.chain&&walletClient.chain.id!==chainId) throw new Error('Wallet client chain differs from the configured chain.');
    if(await walletClient.getChainId()!==chainId) throw new Error('Wallet chain differs from the configured chain.');
    const addresses=await walletClient.getAddresses();
    const address=checkedAddress(addresses[0],'wallet account');
    if(walletClient.account&&walletClient.account.address.toLowerCase()!==address.toLowerCase()) throw new Error('Wallet account differs from its selected account.');
    return {wallet:walletClient,address,account:walletClient.account??address};
  }
  async function version():Promise<1|2> {
    await context();
    let result:bigint;
    try {result=await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'version'});} catch(error) {if(absentVersion(error)) return 1;throw error;}
    if(result!==2n) throw new Error(`Unsupported CovaVault protocol version ${result}.`);
    const domain=await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'eip712Domain'});
    if(domain[0]!=='0x0f'||domain[1]!=='CovaVault'||domain[2]!=='2'||domain[3]!==BigInt(chainId)||domain[4].toLowerCase()!==vault.toLowerCase()||!/^0x0{64}$/i.test(domain[5])||domain[6].length!==0) throw new Error('Vault EIP712 domain does not match CovaVault version 2 on this chain and vault.');
    return 2;
  }
  async function v2() {if(await version()!==2) throw new Error('Signed authorizations require CovaVault version 2.');}
  async function write(functionName:WriteFunction,args:readonly unknown[]):Promise<Hash> {
    await context();
    const actor=await caller();
    // The deployed vault is the authority for EOA/ERC1271 validity and permissions.
    const simulation=await publicClient.simulateContract({address:vault,abi:vaultAbi as Abi,functionName,args,account:actor.address});
    return actor.wallet.writeContract({...simulation.request,account:actor.account,chain:actor.wallet.chain});
  }
  async function signingMessage(input:Omit<HoldAuthorization,'nonce'>):Promise<HoldAuthorization> {
    const customer=checkedAddress(input.customer,'customer');
    const blockNumber=await publicClient.getBlockNumber({cacheTime:0});
    const [nonce,available,block]=await Promise.all([
      publicClient.readContract({address:vault,abi:vaultAbi,functionName:'nonces',args:[customer],blockNumber}),
      publicClient.readContract({address:vault,abi:vaultAbi,functionName:'availableBalance',args:[customer],blockNumber}),
      publicClient.getBlock({blockNumber})
    ]);
    if(nonce===maxNonce) throw new Error('Authorization nonce is exhausted.');
    const message=checkedAuthorization({...input,customer,nonce});
    if(message.merchant.toLowerCase()===vault.toLowerCase()) throw new Error('merchant cannot be the vault.');
    if(message.expiresAt<=block.timestamp) throw new Error('Authorization expiry must be in the future.');
    if(message.maxAmount>available) throw new Error('Insufficient available funds for this authorization.');
    return message;
  }
  const client={
    protocolVersion:()=>safeCall(version),
    balances:(owner:Address):Promise<CovaBalances>=>safeCall(async()=>{
      const address=checkedAddress(owner,'owner');await context();
      const blockNumber=await publicClient.getBlockNumber({cacheTime:0});
      const [available,held]=await Promise.all([
        publicClient.readContract({address:vault,abi:vaultAbi,functionName:'availableBalance',args:[address],blockNumber}),
        publicClient.readContract({address:vault,abi:vaultAbi,functionName:'heldBalance',args:[address],blockNumber})
      ]);return {available,held};
    }),
    hold:(id:Hash):Promise<CovaHold>=>safeCall(async()=>{
      checkedHash(id,'holdId');await context();
      const blockNumber=await publicClient.getBlockNumber({cacheTime:0});
      const h=await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'holds',args:[id],blockNumber});
      return {id,customer:h[0],merchant:h[1],authorizedAmount:h[2],capturedAmount:h[3],expiresAt:h[4],status:h[5] as 0|1|2|3,referenceId:h[6]};
    }),
    holdIds:(owner:Address,role:'customer'|'merchant'):Promise<Hash[]>=>safeCall(async()=>{
      const address=checkedAddress(owner,'owner');if(role!=='customer'&&role!=='merchant') throw new Error('role must be customer or merchant.');await context();
      const blockNumber=await publicClient.getBlockNumber({cacheTime:0});const result:Hash[]=[];
      for(let offset=0n;;offset+=100n) {
        const page=await publicClient.readContract({address:vault,abi:vaultAbi,functionName:role==='customer'?'getCustomerHoldIds':'getMerchantHoldIds',args:[address,offset,100n],blockNumber});
        result.push(...page);if(page.length<100) break;
      }return result;
    }),
    prepareAuthorization:(input:Omit<HoldAuthorization,'nonce'>):Promise<HoldAuthorization>=>safeCall(async()=>{
      await v2();return signingMessage(input);
    }),
    signAuthorization:(input:HoldAuthorization):Promise<SignedAuthorization>=>safeCall(async()=>{
      const message=checkedAuthorization(input);await v2();const actor=await caller();
      if(actor.address.toLowerCase()!==message.customer.toLowerCase()) throw new Error('The signing wallet account must equal the authorization customer.');
      const current=await signingMessage(message);
      if(current.nonce!==message.nonce) throw new Error('Authorization nonce is stale or exhausted.');
      const signature=await actor.wallet.signTypedData({...authorizationTypedData(chainId,vault,message),account:actor.account});
      await publicClient.simulateContract({address:vault,abi:vaultAbi,functionName:'authorizeHold',args:[message,signature],account:actor.address});
      return {schemaVersion:1,chainId,vault,authorization:message,signature};
    }),
    submitAuthorization:(input:SignedAuthorization):Promise<Hash>=>safeCall(async()=>{
      const envelope=decodeSignedAuthorization(encodeSignedAuthorization(input));
      if(envelope.chainId!==chainId) throw new Error('Envelope chain differs from the client chain.');
      if(envelope.vault.toLowerCase()!==vault.toLowerCase()) throw new Error('Envelope vault differs from the client vault.');
      await v2();return write('authorizeHold',[envelope.authorization,envelope.signature]);
    }),
    invalidateAuthorizations:(newNonce:bigint):Promise<Hash>=>safeCall(async()=>{
      checkedUint(newNonce,256,'newNonce');if(newNonce===maxNonce) throw new Error('newNonce cannot exhaust the authorization nonce.');
      await v2();const actor=await caller();const current=await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'nonces',args:[actor.address]});
      if(newNonce<=current) throw new Error('newNonce must exceed the current nonce.');
      return write('invalidateAuthorizations',[newNonce]);
    }),
    deposit:(amount:bigint)=>safeCall(()=>write('deposit',[checkedUint(amount,256,'amount',true)])),
    withdraw:(amount:bigint)=>safeCall(()=>write('withdraw',[checkedUint(amount,256,'amount',true)])),
    createHold:(input:Omit<HoldAuthorization,'nonce'|'customer'>)=>safeCall(()=>{
      const merchant=checkedAddress(input.merchant,'merchant');if(merchant.toLowerCase()===vault.toLowerCase()) throw new Error('merchant cannot be the vault.');
      return write('createHold',[merchant,checkedUint(input.maxAmount,128,'maxAmount',true),checkedUint(input.expiresAt,64,'expiresAt',true),checkedHash(input.referenceId,'referenceId')]);
    }),
    capture:(id:Hash,amount:bigint)=>safeCall(()=>write('capture',[checkedHash(id,'holdId'),checkedUint(amount,128,'amount',true)])),
    release:(id:Hash)=>safeCall(()=>write('release',[checkedHash(id,'holdId')])),
    releaseExpired:(id:Hash)=>safeCall(()=>write('releaseExpired',[checkedHash(id,'holdId')])),
    waitForReceipt:(hash:Hash,waitOptions:Omit<WaitForTransactionReceiptParameters,'hash'>={})=>safeCall(async()=>{
      checkedHash(hash,'transaction hash');await context();let changed:string|undefined;
      const receipt=await publicClient.waitForTransactionReceipt({...waitOptions,hash,onReplaced:replacement=>{
        if(replacement.reason!=='repriced') changed=replacement.reason;
        waitOptions.onReplaced?.(replacement);
      }});
      if(changed) throw new Error(`Cova transaction was ${changed}.`);
      if(receipt.status!=='success') throw new Error('Cova transaction reverted.');
      return receipt;
    }),
    readHoldHistory:(holdIds:Hash[],historyOptions:HoldHistoryOptions)=>safeCall(async()=>{
      await context();return readHoldHistory(publicClient,vault,holdIds,historyOptions);
    })
  };
  return client;
}
export type CovaClient=ReturnType<typeof createCovaClient>;
