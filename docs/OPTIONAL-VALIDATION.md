# Cova optional-feature delivery — 2026-10-04

## Implemented
- Vault v2 adds EIP-712 domain CovaVault/2, EOA/ERC1271 verification, exact per-customer nonces, atomic relayed reservation, and pending-signature invalidation. Existing financial accounting and merchant permissions remain unchanged.
- @cova/sdk 0.2.0 is independently packable ESM with TypeScript declarations and viem as its only peer. It prepares/signs/submits authorizations, provides direct vault operations, and validates chain/token/wallet context.
- Receipt history is reconstructed from actual hold events, survives empty localStorage/different browsers, preserves every capture, handles partial scans/provider limits and shallow reorgs. Balances and statuses still come from contract storage.
- The UI signs an actual wallet authorization and lets the assigned merchant import/submit it. Signing itself reserves nothing. Pending packet display/invalidation is scoped to its customer, chain and vault. Wallet rejection and stale signatures have readable errors.
- The supplied Cova logo.png is used unchanged at public/brand/cova-logo.png. The header uses a small reusable component. Arya still owns the broader frontend redesign.

## Validation
- Foundry:97 passed, 0 failed, 3 opt-in fork tests skipped without RPC. Four invariants each run 128×64 calls.
- Official Paxos USDG read-only fork:3 tests passed, including signed 20 reserve →14 capture →6 release →86 withdrawal. These are local fork transactions, not public broadcasts.
- JavaScript/domain/SDK/history/UI regressions:32 passed after review fixes.
- Browser:9 passed, including wallet rejection, wrong chain, real local signatures, merchant submission, capture/release, nonce invalidation, account-scoped signatures, independent browser receipt recovery and actual v1 compatibility.
- TypeScript, lint, SDK build, production frontend build passed.
- SDK package/import smoke passed (ESM + declarations, viem peer only).
- Actual localhost SDK integration uses different customer/merchant/relayer accounts and verifies SDK/onchain digest equality, sign-without-reservation, multiple capture 10+4, release 6, cancellation/replay rejection and fresh receipt recovery.

## Public deployment distinction
The existing public deployment remains v1 at 0xeb008dd97b0d17200055A3c7b5c60aB8b31CE428. Its confirmed deployment/source evidence remains in deployments/arbitrum-sepolia.json, tied to the prior source commit.
**No v2 public deployment was attempted:** the user selected implementation first, deployment later. The public environment is not changed to a fabricated v2 address. SDK/direct flow/shared receipts support v1, while signed actions require detected v2 and are unavailable on v1/simulation.
The signed v2 flow is implemented and exercised on Anvil and an official USDG fork. A funded public two-wallet E2E remains pending and requires fresh customer/merchant wallets, USDG and ETH. A new immutable v2 deployment is required before offering signatures on Arbitrum Sepolia.

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
Custom plaintext references remain browser-local unless shared explicitly in the signed envelope; only reference hashes are onchain. Receipt scans are bounded and can report incomplete history rather than invent results. Deep reorganization/indexing at large scale remains future work. No hosted relayer/API, AA system, dispute mechanism or multi-token protocol was added. Npm publication and public deployment were not requested for this implementation pass.
