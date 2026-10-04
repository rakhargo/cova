# @cova/sdk

An ESM TypeScript SDK for CovaVault. `viem` is the only peer dependency. All amounts are token base units, all times are Unix seconds, and numeric authorization fields use `bigint` in memory and canonical decimal strings in shared JSON.

```ts
import { createCovaClient, encodeSignedAuthorization, decodeSignedAuthorization } from '@cova/sdk';
const customer = createCovaClient({ publicClient, walletClient, vault, chainId, token });
const message = await customer.prepareAuthorization({ customer: customerAddress, merchant, maxAmount: 20_000_000n, expiresAt, referenceId });
const signed = await customer.signAuthorization(message);
const json = encodeSignedAuthorization(signed);
// Any relayer can submit. The vault checks the signature, nonce, funds and expiry.
const txHash = await relayer.submitAuthorization(decodeSignedAuthorization(json));
await relayer.waitForReceipt(txHash);
```

Signing creates no reservation. Only a confirmed `authorizeHold` transaction reserves customer funds. The assigned merchant alone can capture or release an active hold; anyone can release an expired hold. Simulations use the actual wallet account and the deployed vault's EOA/ERC1271 SignatureChecker; the SDK does not substitute offchain or ERC6492 verification. `signAuthorization` checks current chain expiry and funds before requesting the customer's wallet signature, then simulates `authorizeHold` by eth_call without reserving real funds. Deployed contract wallets can supply their own arbitrary-length ERC1271 signature in an envelope for submission.

Optional descriptions are shared explicitly in JSON and must hash to the signed `referenceId`. Descriptions are limited to 120 characters and portable JSON to 65536 characters. The codec validates widths, addresses, chain/vault domain and hex syntax. Decoding a signature proves its structure, not its validity.

`protocolVersion()` supports v1 only when calling the absent `version` method causes an empty contract revert. Transport/RPC failures throw. Version2 also requires the exact ERC5267 domain. V1 balances, holds, direct writes and event receipts remain supported.

`readHoldHistory(publicClient, vault, holdIds, { fromBlock, toBlock, chunkSize?, maxRequests? })` scans a caller-supplied deployment block through a fixed end block. It returns `{ receipts, events, scannedThrough, complete, error? }`. Capture hashes include all capture transactions. Logs are sorted, deduplicated, and removed logs are ignored. Provider range-limit errors shrink chunks. A failure or request budget exhaustion preserves completed chunks and returns `complete:false`; resume at `scannedThrough + 1n`. When no chunk completes, `scannedThrough` is `fromBlock - 1n`. The default request budget is 40 and chunk size is 2000 blocks. Keep an overlap for confirmation-depth/reorganization recovery and merge canonical events before calling `receiptsFromEvents`; events never determine balances or status.

Build with `npm run build --prefix sdk` from the repository. `npm pack` inside `sdk/` includes ESM and declarations. The repository's `scripts/sdk-integration.ts` uses a fresh local test fixture, three distinct test accounts, and loopback RPC chain31337 only. It never deploys to a public network.
