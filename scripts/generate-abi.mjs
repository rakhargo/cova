import { readFileSync, writeFileSync } from 'node:fs';
const artifact=JSON.parse(readFileSync(new URL('../contracts/out/CovaVault.sol/CovaVault.json',import.meta.url),'utf8'));
writeFileSync(new URL('../sdk/src/abi.ts',import.meta.url),'// Generated from CovaVault.sol. Run forge build --root contracts && npm run abi.\nexport const vaultAbi = '+JSON.stringify(artifact.abi,null,2)+' as const;\n');
console.log('Generated ABI from compiled CovaVault artifact.');

const routerArtifact=JSON.parse(readFileSync(new URL('../contracts/out/CovaSessionRouter.sol/CovaSessionRouter.json',import.meta.url),'utf8'));
writeFileSync(new URL('../sdk/src/session-abi.ts',import.meta.url),'// Generated from CovaSessionRouter.sol. Run forge build --root contracts && npm run abi.\nexport const sessionRouterAbi = '+JSON.stringify(routerArtifact.abi,null,2)+' as const;\n');
console.log('Generated ABI from compiled CovaSessionRouter artifact.');

writeFileSync(new URL('../lib/abi.ts',import.meta.url),"export { vaultAbi } from '../sdk/dist/index.js';\n");
