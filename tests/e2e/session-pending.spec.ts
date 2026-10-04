import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { injectedWallet, LIVE_URL } from './wallet';

const info = existsSync('local-deployment.json')
  ? JSON.parse(readFileSync('local-deployment.json', 'utf8')) as { customer: Address; merchant: Address }
  : undefined;

test.skip(!info, 'Run local:deploy against Anvil to enable session checkout browser tests.');

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
