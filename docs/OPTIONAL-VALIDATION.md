# Cova optional-feature delivery — 2026-10-04

## Implemented
- Vault v2 adds EIP-712 domain CovaVault/2, EOA/ERC1271 verification, exact per-customer nonces, atomic relayed reservation, and pending-signature invalidation. Existing financial accounting and merchant permissions remain unchanged.
- @cova/sdk 0.2.0 is independently packable ESM with TypeScript declarations and viem as its only peer. It prepares/signs/submits authorizations, provides direct vault operations, and validates chain/token/wallet context.
- Receipt history is reconstructed from actual hold events, survives empty localStorage/different browsers, preserves every capture, handles partial scans/provider limits and shallow reorgs. Balances and statuses still come from contract storage.
- The UI signs an actual wallet authorization and lets the assigned merchant import/submit it. Signing itself reserves nothing. Pending packet display/invalidation is scoped to its customer, chain and vault. Wallet rejection and stale signatures have readable errors.
- The supplied Cova logo.png is used unchanged at public/cova-logo.png through a reusable header/footer component. Arya's landing/playground redesign is integrated while retaining signed authorizations, shared receipts and safe expiry formatting.

## Validation
- Foundry:97 passed, 0 failed, 3 opt-in fork tests skipped without RPC. Four invariants each run 128×64 calls.
- Official Paxos USDG read-only fork:3 tests passed, including signed 20 reserve →14 capture →6 release →86 withdrawal. These are local fork transactions, not public broadcasts.
- JavaScript/domain/SDK/history/UI regressions:32 passed after review fixes.
- Browser:9 passed, including wallet rejection, wrong chain, real local signatures, merchant submission, capture/release, nonce invalidation, account-scoped signatures, independent browser receipt recovery and actual v1 compatibility.
- TypeScript, lint, SDK build, production frontend build passed.
- SDK package/import smoke passed (ESM + declarations, viem peer only).
- Actual localhost SDK integration uses different customer/merchant/relayer accounts and verifies SDK/onchain digest equality, sign-without-reservation, multiple capture 10+4, release 6, cancellation/replay rejection and fresh receipt recovery.

## Public deployment distinction
V2 is deployed at `0xC5E8bd21b3691815e9F0CD7e4F80C656A56C1eD5`, creation block315667402. Transaction `0x3043d8144f3b41c5524eb8e4f25567d09e9c37f4f44aca1d2601929e3123c25b` is confirmed. Arbiscan returned `Pass - Verified`. Receipt, creation bytecode, runtime outside consistent immutable slots, USDG identity, v2/EIP-712 domain, viem/onchain authorization digest and zero initial liability were independently checked. Public evidence is in `deployments/arbitrum-sepolia.json`, bound to source commit `7bbb751`.
The prior immutable v1 deployment and its original source evidence remain in `deployments/arbitrum-sepolia-v1.json`; old funds/holds are not migrated. SDK/direct flow/shared receipts support v1, while signed actions require detected v2 and are unavailable in simulation.
The signed v2 payment flow is exercised on Anvil and an official USDG fork. A funded public two-wallet E2E remains pending and requires separate customer/merchant wallets, USDG and ETH. The deployer had zero USDG during the v2 deployment, so no funded public payment lifecycle is claimed.

## Review fixes
Independent review found and fixed wrong-chain SDK history scans, hidden overlap errors, orphan receipts after a lower head, signature leakage between wallet contexts, and valid uint64 expiries outside JavaScript Date range. Focused regressions cover these boundaries. SDK receipt handling rejects cancellation/changed replacement while accepting repricing.

## Commands
```bash
npm ci
npm run build:sdk
npm test
forge test --root contracts
npm run typecheck
npm run lint
npm run build
# Separate terminal: anvil --host 127.0.0.1 --port 8545 --chain-id 31337
npm run local:deploy
npm run test:integration
npm run test:sdk:integration
npm run test:e2e
npm pack ./sdk
```
The local fixture includes a renamed baseline v1 vault solely for browser compatibility tests. MockUSDG and the unlocked test wallet provider are test-only infrastructure; the live app does not supply fake USDG or signatures.

## Known boundaries
Custom plaintext references remain browser-local unless shared explicitly in the signed envelope; only reference hashes are onchain. Receipt scans are bounded and can report incomplete history rather than invent results. Deep reorganization/indexing at large scale remains future work. No hosted relayer/API, AA system, dispute mechanism or multi-token protocol was added. Npm publication and frontend hosting remain pending.
