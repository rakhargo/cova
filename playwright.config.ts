import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
const local=existsSync('local-deployment.json')?JSON.parse(readFileSync('local-deployment.json','utf8')):undefined;
export default defineConfig({
  testDir:'./tests/e2e',timeout:45_000,expect:{timeout:15_000},fullyParallel:false,workers:1,
  use:{baseURL:'http://127.0.0.1:3100',trace:'retain-on-failure',headless:true},
  webServer:[
    {command:'npm run dev -- --port 3100',url:'http://127.0.0.1:3100',reuseExistingServer:!process.env.CI,timeout:120_000,
      env:{NEXT_PUBLIC_COVA_VAULT_ADDRESS:'',NEXT_PUBLIC_CHAIN_ID:'421614',NEXT_PUBLIC_USDG_ADDRESS:'0xFFC95faa3d63Cde504a05B567C600B78C0b41892',NEXT_PUBLIC_DEMO_MERCHANT_ADDRESS:'',NEXT_DIST_DIR:'.next-demo'}},
    ...(local?[{command:'npm run dev -- --port 3101',url:'http://127.0.0.1:3101',reuseExistingServer:!process.env.CI,timeout:120_000,
      env:{NEXT_PUBLIC_COVA_VAULT_ADDRESS:local.vault,NEXT_PUBLIC_USDG_ADDRESS:local.token,NEXT_PUBLIC_DEMO_MERCHANT_ADDRESS:local.merchant,NEXT_PUBLIC_CHAIN_ID:'31337',NEXT_PUBLIC_RPC_URL:'http://127.0.0.1:8545',NEXT_DIST_DIR:'.next-anvil'}}]:[])
  ]
});
