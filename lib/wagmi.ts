import { createConfig, http } from 'wagmi';
import { injected } from '@wagmi/core';
import { arbitrumSepolia, foundry } from 'wagmi/chains';
import { covaConfig } from './config';
export const walletConfig=createConfig({
  chains:[arbitrumSepolia,foundry],connectors:[injected()],ssr:true,
  transports:{[arbitrumSepolia.id]:http(covaConfig.local?undefined:covaConfig.rpc),[foundry.id]:http(covaConfig.local?covaConfig.rpc:'http://127.0.0.1:8545')}
});
