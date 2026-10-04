import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { injectedWallet, LOCAL_RPC } from './wallet';
import { createPublicClient, createWalletClient, erc20Abi, http } from 'viem';
import { foundry } from 'viem/chains';
import { mnemonicToAccount } from 'viem/accounts';
import { vaultAbi } from '../../lib/abi';
const LIVE_URL=process.env.COVA_E2E_SESSION_URL || 'http://127.0.0.1:3104';

const info = existsSync('local-deployment.json')
  ? JSON.parse(readFileSync('local-deployment.json', 'utf8')) as { customer: Address; merchant: Address; vault: Address; token: Address }
  : undefined;

test.skip(!info, 'Run local:deploy against Anvil to enable session checkout browser tests.');
test.beforeAll(async()=>{
  if(!info)return;
  const client=createPublicClient({chain:foundry,transport:http(LOCAL_RPC)});
  if(await client.getChainId()!==31337)throw new Error('Session E2E funding requires local Anvil.');
  if(await client.readContract({address:info.vault,abi:vaultAbi,functionName:'availableBalance',args:[info.customer]})>=20_000_000n)return;
  const account=mnemonicToAccount('test test test test test test test test test test test junk');
  const wallet=createWalletClient({account,chain:foundry,transport:http(LOCAL_RPC)});
  await client.waitForTransactionReceipt({hash:await wallet.writeContract({address:info.token,abi:erc20Abi,functionName:'approve',args:[info.vault,20_000_000n]})});
  await client.waitForTransactionReceipt({hash:await wallet.writeContract({address:info.vault,abi:vaultAbi,functionName:'deposit',args:[20_000_000n]})});
});

test('pending start retains its session and waits for Router confirmation', async ({ page }) => {
  const duplicateKeys: string[] = [];
  page.on('console', message => {
    if ((message.type() === 'warning' || message.type() === 'error') && /same key/i.test(message.text())) duplicateKeys.push(message.text());
  });
  await injectedWallet(page, info!);
  await page.route('**/api/sessions/start', async route => {
    const body = route.request().postDataJSON() as { quote: { sessionId: string } };
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Session start was submitted; waiting for chain confirmation.',
        code: 'START_PENDING',
        status: 'pending',
        sessionId: body.quote.sessionId,
        transactionHash: `0x${'ab'.repeat(32)}`,
      }),
    });
  });
  await page.goto(`${LIVE_URL}/#metered-session`);
  const checkout = page.locator('#metered-session');
  await checkout.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await checkout.getByRole('button', { name: 'Switch network', exact: true }).click();
  await checkout.getByRole('button', { name: 'Review session quote', exact: true }).click();
  await expect(checkout.getByText('PROVIDER QUOTE · REVIEW BEFORE SIGNING')).toBeVisible();
  await checkout.getByRole('button', { name: 'Authorize up to 20 USDG and start', exact: true }).click();
  await expect(checkout.getByRole('heading', { name: 'Waiting for session confirmation' })).toBeVisible();
  await expect(checkout.getByText('The session has not appeared as active in Router storage. The provider must wait for confirmation.')).toBeVisible();
  await expect(checkout.getByRole('button', { name: 'Stop and settle session', exact: true })).toHaveCount(0);
  expect(duplicateKeys).toEqual([]);
});

test('a pending start whose transaction reverts clears the pending session and allows a retry', async ({ page }) => {
  const rpc = await page.request.post(LOCAL_RPC, { data: {
    jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction',
    params: [{ from: info!.customer, to: info!.vault, data: '0xdeadbeef', gas: '0x186a0' }],
  } });
  const sent = await rpc.json() as { result?: `0x${string}`; error?: { message: string } };
  expect(sent.result, sent.error?.message).toBeDefined();
  const failedHash = sent.result!;
  await expect.poll(async () => {
    const response = await page.request.post(LOCAL_RPC, { data: {
      jsonrpc: '2.0', id: 2, method: 'eth_getTransactionReceipt', params: [failedHash],
    } });
    const body = await response.json() as { result?: { status: string } };
    return body.result?.status;
  }).toBe('0x0');

  await injectedWallet(page, info!);
  await page.route('**/api/sessions/start', async route => {
    const body = route.request().postDataJSON() as { quote: { sessionId: string } };
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Session start was submitted; waiting for chain confirmation.',
        code: 'START_PENDING', status: 'pending', sessionId: body.quote.sessionId,
        transactionHash: failedHash,
      }),
    });
  });
  await page.goto(`${LIVE_URL}/#metered-session`);
  const checkout = page.locator('#metered-session');
  await checkout.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await checkout.getByRole('button', { name: 'Switch network', exact: true }).click();
  await checkout.getByRole('button', { name: 'Review session quote', exact: true }).click();
  await expect(checkout.getByText('PROVIDER QUOTE · REVIEW BEFORE SIGNING')).toBeVisible();
  await checkout.getByRole('button', { name: 'Authorize up to 20 USDG and start', exact: true }).click();
  await expect(checkout.getByText(/start transaction reverted/i)).toBeVisible({ timeout: 15_000 });
  await expect(checkout.getByRole('button', { name: 'Review session quote', exact: true })).toBeVisible();
  await expect(checkout.getByRole('button', { name: 'Stop and settle session', exact: true })).toHaveCount(0);
});
