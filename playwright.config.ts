import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
const demoUrl=process.env.COVA_E2E_DEMO_URL || 'http://127.0.0.1:3100';
const liveUrl=process.env.COVA_E2E_LIVE_URL || 'http://127.0.0.1:3101';
const legacyUrl=process.env.COVA_E2E_LEGACY_URL || 'http://127.0.0.1:3103';
const local=existsSync('local-deployment.json')?JSON.parse(readFileSync('local-deployment.json','utf8')):undefined;
export default defineConfig({
  testDir:'./tests/e2e',timeout:45_000,expect:{timeout:15_000},fullyParallel:false,workers:1,
  use:{baseURL:demoUrl,trace:'retain-on-failure',headless:true},
  webServer:[
    {command:'npm run dev -- --port '+new URL(demoUrl).port,url:demoUrl,reuseExistingServer:!process.env.CI,timeout:120_000,
      env:{NEXT_PUBLIC_COVA_VAULT_ADDRESS:'',NEXT_PUBLIC_CHAIN_ID:'421614',NEXT_PUBLIC_USDG_ADDRESS:'0xFFC95faa3d63Cde504a05B567C600B78C0b41892',NEXT_PUBLIC_DEMO_MERCHANT_ADDRESS:'',NEXT_DIST_DIR:'.next-demo'}},
    ...(local?[{command:'npm run dev -- --port '+new URL(liveUrl).port,url:liveUrl,reuseExistingServer:!process.env.CI,timeout:120_000,
      env:{NEXT_PUBLIC_COVA_VAULT_ADDRESS:local.vault,NEXT_PUBLIC_USDG_ADDRESS:local.token,NEXT_PUBLIC_DEMO_MERCHANT_ADDRESS:local.merchant,NEXT_PUBLIC_CHAIN_ID:'31337',NEXT_PUBLIC_RPC_URL:local.rpc || 'http://127.0.0.1:8545',NEXT_PUBLIC_COVA_DEPLOYMENT_BLOCK:local.deploymentBlock || '0',NEXT_DIST_DIR:'.next-anvil'}}]:[])
    ,...(local?.legacyVault?[{command:'npm run dev -- --port '+new URL(legacyUrl).port,url:legacyUrl,reuseExistingServer:!process.env.CI,timeout:120_000,env:{NEXT_PUBLIC_COVA_VAULT_ADDRESS:local.legacyVault,NEXT_PUBLIC_USDG_ADDRESS:local.token,NEXT_PUBLIC_DEMO_MERCHANT_ADDRESS:local.merchant,NEXT_PUBLIC_CHAIN_ID:'31337',NEXT_PUBLIC_RPC_URL:local.rpc || 'http://127.0.0.1:8545',NEXT_PUBLIC_COVA_DEPLOYMENT_BLOCK:'0',NEXT_DIST_DIR:'.next-legacy'}}]:[])
  ]
});
