import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, http, type Address } from 'viem';
import { foundry } from 'viem/chains';
import { vaultAbi } from '../../lib/abi';
import { formatAmount } from '../../lib/format';
const info=existsSync('local-deployment.json')?JSON.parse(readFileSync('local-deployment.json','utf8')) as {customer:Address;merchant:Address;vault:Address}:undefined;
const client=createPublicClient({chain:foundry,transport:http('http://127.0.0.1:8545')});
test.skip(!info,'Run local:deploy against Anvil to enable real local wallet UI tests.');
async function injectedWallet(page:Page) {
  await page.addInitScript(({customer,merchant})=>{
    let active=customer;let chain='0x1';let rejectNext=false;
    const listeners=new Map<string,Set<(value:unknown)=>void>>();
    const emit=(event:string,value:unknown)=>listeners.get(event)?.forEach(fn=>fn(value));
    const target=window as unknown as Record<string,unknown>;
    target.ethereum={
      isMetaMask:true,
      on:(event:string,fn:(value:unknown)=>void)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn);},
      removeListener:(event:string,fn:(value:unknown)=>void)=>listeners.get(event)?.delete(fn),
      request:async({method,params=[]}:{method:string;params:unknown[]})=>{
        if(method==='eth_accounts' || method==='eth_requestAccounts') return [active];
        if(method==='eth_chainId') return chain;
        if(method==='wallet_switchEthereumChain' || method==='wallet_addEthereumChain') {chain='0x7a69';emit('chainChanged',chain);return null;}
        if(method==='eth_sendTransaction') {
          if(rejectNext) {rejectNext=false;throw Object.assign(new Error('User rejected request'),{code:4001});}
          const transaction=params[0] as {from:string};
          if(transaction.from.toLowerCase()!==active.toLowerCase()) throw new Error('Unauthorized local signer');
        }
        const response=await fetch('http://127.0.0.1:8545',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
        const result=await response.json();if(result.error) throw Object.assign(new Error(result.error.message),{code:result.error.code});return result.result;
      }
    };
    target.covaSetWallet=(role:'customer'|'merchant')=>{active=role==='customer'?customer:merchant;emit('accountsChanged',[active]);};
    target.covaRejectNext=()=>{rejectNext=true;};
  },{customer:info!.customer,merchant:info!.merchant});
}
test('real local wallet: wrong chain, rejected approval, deposit, reserve, merchant capture, release, withdraw',async({page})=>{
  const baseline=await client.readContract({address:info!.vault,abi:vaultAbi,functionName:'availableBalance',args:[info!.customer]});
  await injectedWallet(page);await page.goto('http://127.0.0.1:3101/#playground');
  await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Switch network',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Switch network',exact:true}).click();
  const available=page.locator('.balance-metric').first().locator('strong');
  await expect(available).toHaveText(`${formatAmount(baseline)}USDG`);
  await page.evaluate(()=>{(window as unknown as {covaRejectNext:()=>void}).covaRejectNext();});
  await page.getByRole('button',{name:'Approve 100 USDG',exact:true}).click();
  await expect(page.locator('.transaction-notice.failed')).toContainText('Wallet request rejected');
  await page.getByRole('button',{name:'Approve 100 USDG',exact:true}).click();
  await expect(page.getByRole('button',{name:'Deposit USDG',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Deposit USDG',exact:true}).click();
  await expect(available).toHaveText(`${formatAmount(baseline+100_000_000n)}USDG`);
  await page.getByRole('button',{name:'Authorize hold',exact:true}).click();
  await expect(available).toHaveText(`${formatAmount(baseline+80_000_000n)}USDG`);
  await expect(page.locator('.active-hold .remaining-amount')).toContainText('20');
  // Selecting Merchant cannot grant the customer permission.
  await page.getByRole('button',{name:'Merchant',exact:true}).click();
  await expect(page.locator('.active-hold')).toHaveCount(0);
  await page.evaluate(()=>{(window as unknown as {covaSetWallet:(role:string)=>void}).covaSetWallet('merchant');});
  await expect(page.getByRole('button',{name:'Capture 14 USDG',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Capture 14 USDG',exact:true}).click();
  await expect(page.locator('.active-hold .remaining-amount')).toContainText('6');
  await page.getByRole('button',{name:'Release remaining',exact:true}).click();
  await expect(page.locator('.settled-hold').first()).toContainText('14 USDG settled to the merchant. 6 USDG returned to the customer.');
  await page.evaluate(()=>{(window as unknown as {covaSetWallet:(role:string)=>void}).covaSetWallet('customer');});
  await page.getByRole('button',{name:'Customer',exact:true}).click();
  await expect(available).toHaveText(`${formatAmount(baseline+86_000_000n)}USDG`);
  await page.locator('#withdraw-amount').fill('86');
  await page.getByRole('button',{name:'Withdraw USDG',exact:true}).click();
  await expect(available).toHaveText(`${formatAmount(baseline)}USDG`);
  await expect(page.locator('a[href*="arbiscan.io/tx/"]')).toHaveCount(0);
});
test('expiry UI follows chain time and permissionlessly recovers the remainder',async({page})=>{
  await injectedWallet(page);await page.goto('http://127.0.0.1:3101/#playground');
  await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Switch network',exact:true}).click();
  await page.locator('#deposit-amount').fill('20');
  await page.getByRole('button',{name:'Approve 20 USDG',exact:true}).click();
  await expect(page.getByRole('button',{name:'Deposit USDG',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Deposit USDG',exact:true}).click();
  await expect(page.getByRole('button',{name:'Authorize hold',exact:true})).toBeEnabled();
  await page.locator('#expiry-minutes').selectOption('1');await page.getByRole('button',{name:'Authorize hold',exact:true}).click();
  await expect(page.locator('.active-hold')).toBeVisible();
  await client.request({method:'evm_increaseTime' as never,params:[120] as never});await client.request({method:'evm_mine' as never,params:[] as never});
  await page.getByRole('button',{name:'Refresh balances and holds',exact:true}).click();
  await expect(page.getByRole('button',{name:'Release expired hold',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Release expired hold',exact:true}).click();await expect(page.locator('.active-hold')).toHaveCount(0);
});
test('Retry recovers an initial RPC deployment verification failure',async({page})=>{
  test.setTimeout(90_000);await injectedWallet(page);
  await page.route('http://127.0.0.1:8545/',route=>route.abort());
  await page.goto('http://127.0.0.1:3101/#playground');
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible({timeout:60_000});
  await page.unroute('http://127.0.0.1:8545/');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Switch network',exact:true}).click();
  await expect(page.locator('.balance-metric').first()).not.toContainText('—');
});
