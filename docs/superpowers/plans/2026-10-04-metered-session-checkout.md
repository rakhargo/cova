# Cova Metered Session Checkout Implementation Plan

> **For agentic workers:** Implement in the existing isolated worktree on `feature/metered-session-checkout`. The user requested GPT-6-luna for execution; use that model if the session runner exposes it. Do not put the deployment/development key in argv, browser bundles, test fixtures for live code, or logs.

**Goal:** Give a provider a reusable, verified reservation before a USDG-priced timed service begins, then capture exactly the agreed rate for onchain session time and return the unused reserve.

**Architecture:** Add an immutable `CovaSessionRouter` in front of the deployed immutable `CovaVault v2`. Providers sign EIP-712 quotes and customers sign a quote-bound v2 vault hold authorization; the router is the vault's assigned merchant and enforces the rate/duration formula at settlement. A small server-only session API relays customer-approved start/end actions and supplies the provider quote; the contract remains the state and accounting authority. The app presents the session checkout inside the existing product and keeps exact price, provider, budget, expiry, funding and recovery visible.

**Tech Stack:** Solidity 0.8.30, Foundry, OpenZeppelin 5.x, Next.js 16 App Router, TypeScript, viem, wagmi, existing Cova SDK, and the existing Node runtime. No new production dependency is planned.

**Spec:** `docs/superpowers/specs/2026-10-04-metered-session-checkout-design.md`

## Global Constraints

- Use Arbitrum Sepolia chain ID 421614 and the official USDG token `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` for the public integration; local Anvil uses only clearly labeled MockUSDG.
- Keep CovaVault v2 immutable, no-admin, and authoritative for available/held balances; reserve through its existing EIP-712/SignatureChecker path.
- Router must have no privileged withdrawal, arbitrary recipient, post-quote fee change, or path that settles over the customer's signed maximum.
- USDG has six decimals. `ratePerMinute` and amounts are unsigned token base units; session seconds use block timestamps.
- Rate formula is `floor(ratePerMinute * billableSeconds / 60)` in checked/mulDiv-safe arithmetic. Display rounding exactly as enforced.
- Require the quote-bound full-duration charge to fit `maxAmount`; bind customer, provider, price, duration, start window, capture expiry, service ID and unique session ID in the provider signature.
- Cova hold merchant is the Router. Only its settlement path captures; it forwards exactly the computed charge to the quote-bound provider, then releases the remainder.
- Use checks-effects-interactions and ReentrancyGuard for external transfers. Failed starts/settlements roll back Router state and Cova nonce/balance updates atomically.
- UI calls a session started only after a confirmed onchain start and reads balances/session status from deployed contracts. No successful-looking local/demo/faucet placeholders for Arbitrum.
- Session UI and copy follow `docs/DESIGN.md` and `AGENTS.md`; preserve the existing Arya redesign and existing direct-hold customer/merchant flow.
- All service/session signing and relay secrets are server-only. Never place a private key in `NEXT_PUBLIC_*`, a repository file, command argv, browser bundle, error output or PR.
- Keep the faucet as a link to Paxos' official Testnet Faucet. Do not bypass CAPTCHA or geo/access controls, mint a Cova token, or claim that Indonesia access was fixed without verifying it.

## Review Focus

- Rounding/dust: zero/one-second sessions, 59/60/61-second boundaries and maximum duration. Captured base units must never exceed the signed cap.
- Deadline edges: quote exactly at `startBy`, stop at session end, finalizer at the max duration, and stop/finalizer at or after Cova hold expiry.
- Signed-field substitution/replay: wrong customer/provider/router/chain, changed rate/budget/duration/service ID, used session ID, reused Cova nonce, and stop signature reused for another session.
- Contract wallet signatures: valid ERC1271 customer and provider, malformed/revoked/short/wrong signatures; all rejected starts leave Cova nonce, available balance and Router session unchanged.
- Concurrent settlement/expiry: duplicate stop requests, relayer retry/replacement, provider/customer stop races and permissionless expiry cleanup must yield no double capture or false “settled” UI.

---

### Task 1: Add the session quote types and settlement router

**Files:**
- Create: `contracts/src/CovaSessionRouter.sol`
- Create: `contracts/test/CovaSessionRouter.t.sol`
- Create or extend only the needed fixtures under `contracts/test/fixtures/`
- Modify: `contracts/foundry.toml` only if Foundry does not discover the new source automatically.

**Interfaces:**
- Consumes: `CovaVault.version()`, `token()`, `nonces()`, `availableBalance()`, `authorizeHold()`, `capture()`, `release()`, and `releaseExpired()`.
- Produces: `quoteDigest(SessionQuote)`, `startSession(SessionQuote,bytes providerSignature,HoldAuthorization,bytes customerSignature)`, `stopSession(bytes32 sessionId)`, `stopSessionWithSignature(bytes32 sessionId,uint64 validUntil,bytes customerSignature)`, `settleAtMaxDuration(bytes32 sessionId)`, `expireSession(bytes32 sessionId)`, `sessions(bytes32)`, `getCustomerSessionIds(address,uint256,uint256)`, and `getProviderSessionIds(address,uint256,uint256)`.
- `SessionQuote`: `bytes32 sessionId`, `address customer`, `address provider`, `bytes32 serviceId`, `uint128 ratePerMinute`, `uint128 maxAmount`, `uint32 maxDurationSeconds`, `uint64 startBy`, `uint64 holdExpiresAt`.
- Router state: `None → Active → Settled | Expired`. Session record retains the quote digest, underlying Cova hold ID, start/stop times, charged amount and returned amount.
- Provider EIP-712 domain: `CovaSessionRouter`, version `1`, current chain ID and router address. Cova authorization reference ID must exactly equal this quote digest.
- Stop EIP-712 message: `SessionStop(bytes32 sessionId,uint64 validUntil)`, validated against the stored session customer; final session status consumes it once.

- [ ] **Step 1: Write a failing quote/start test.** In `CovaSessionRouterTest`, sign a provider quote and the matching `CovaVault.HoldAuthorization`; assert one start event and a real 20 USDG hold. Use distinct Anvil customer/provider accounts and pin time/rate.
- [ ] **Step 2: Run the focused test.** Run `forge test --root contracts --match-contract CovaSessionRouterTest -vv`. Expected: it fails because the quote type and router do not exist.
- [ ] **Step 3: Add constructor and immutable configuration.** Implement `CovaSessionRouter(address vault,address token)` with no admin. Check code exists, vault version is 2 and `vault.token()==token`; allow MockUSDG only when an Anvil test injects it. Add provider quote EIP-712 domain `CovaSessionRouter/1` bound to chain and router.
- [ ] **Step 4: Test and implement quote validation.** Add `quoteDigest(SessionQuote)` and SignatureChecker validation. Pin unique session ID, service ID, provider, customer, rate, cap, max duration, start deadline and hold expiry. Reject zero fields, quote tampering, repeated session IDs, stale startBy, duration/rate cost over cap and insufficient capture grace.
- [ ] **Step 5: Test customer quote binding.** A test must fail if the Cova authorization has a different customer, amount, expiry, merchant or `referenceId`. Then verify `referenceId==quoteDigest` starts once and the submitter cannot substitute itself as customer/provider.
- [ ] **Step 6: Implement the atomic start.** Make `startSession(...)` record Active and call v2 `authorizeHold()` inside the same guarded transaction. Confirm invalid provider/customer signatures or insufficient available balance roll back Router state and Cova nonce/reservation.
- [ ] **Step 7: Test rate math before settlement code.** Pin 0 seconds → 0, 1 second → 8,333 base units, 28 minutes at 500,000 units/min → 14,000,000 units, 40 minutes →20,000,000, and one unit beyond duration → still capped. Check rounding remainder goes to customer.
- [ ] **Step 8: Implement direct and signed session stop.** Only the stored customer/provider may call direct `stopSession`. `stopSessionWithSignature` verifies a quote-session-specific customer EIP-712 signature and deadline. A settled session cannot stop or settle again. Tests cover valid, expired, other-session, wrong-customer and replayed signatures.
- [ ] **Step 9: Implement atomic capture, payout and release.** Record terminal state before token interactions under `nonReentrant`; capture the computed amount to Router only; measure and forward exactly to provider; release the balance remainder through CovaVault. Zero bill skips capture. Hostile/reentrant/fee-on-transfer token behavior must revert without changing final session or vault state.
- [ ] **Step 10: Implement deterministic max-duration/expiry cleanup.** Any caller can finalize the signed maximum only after the signed max duration has elapsed, when the reference provider stops the job at its deadline. After Cova hold expiry, only `releaseExpired` applies and provider charge is zero. Test exact deadline boundaries and both Cova hold statuses.
- [ ] **Step 11: Add current session reads and receipts.** Add customer/provider paginated session IDs and storage-authoritative session records plus started/stopped/settled/expired events. Test that a new client can read the provider, rate, duration, exact billed amount and returned balance from contract state.
- [ ] **Step 12: Run full contracts and commit.** Run `forge test --root contracts` and `forge fmt --root contracts --check`. Commit Router/tests/fixtures only as `feat(router): add quote-bound session settlement`.

### Task 2: Extend the SDK for sessions

**Files:**
- Create: `sdk/src/sessions.ts`
- Create: `tests/sessions.test.ts`
- Modify: `sdk/src/index.ts`, `sdk/src/abi.ts`, `scripts/generate-abi.mjs`, and `package.json` only for a build script required by the existing convention.

**Interfaces:**
- Exports `SessionQuote`, `SessionRecord`, `SessionSettlement`, `sessionQuoteDigest(...)`, `sessionQuoteTypedData(...)`, `createCovaSessionClient({publicClient,walletClient,router,vault,token,chainId})`, and `readSessionHistory(publicClient,router,owner,role,{fromBlock,toBlock,chunkSize?,maxRequests?})`.
- Client methods: `protocolVersion()`, `quote(input)`, `start(input)`, `stop(sessionId)`, `signStop(sessionId,validUntil)`, `submitStop(sessionId,validUntil,signature)`, `settleAtMaxDuration(sessionId)`, `expireSession(sessionId)`, and `session(sessionId)`.
- Existing amount conventions apply: all monetary values are base-unit `bigint`; JSON amounts and times use decimal strings. Quote encoding validates field widths, chain/router domain and service/session hashes.

- [ ] **Step 1: Write failing quote and schema tests.** Assert quote digest matches viem EIP-712 typed data; reject zero provider/customer, blank IDs, overflowing widths, expired deadlines, wrong router/chain and mismatched Cova reference ID.
- [ ] **Step 2: Implement quote codec and typed-data generation.** Reuse existing SDK helpers for checked addresses, uint widths, EIP-712 domains and safe errors. Do not introduce a second typed-data schema in the frontend.
- [ ] **Step 3: Implement the session client.** Pin reads/writes to the client chain. Use the configured provider `WalletClient` only for provider-side development operations. A customer signs only its Cova start/stop authorization. Any relay submission checks the Router simulation before broadcast.
- [ ] **Step 4: Implement bounded session history.** Read session IDs and current contract records; chunk event scans, bound requests, report incomplete scans and never infer financial status from browser storage.
- [ ] **Step 5: Test retry/state transitions and package types.** Cover invalid signatures, wallet replacement, stale stop, repeat requests, capture/expiry status and independent browser receipt recovery. Run `npm run build:sdk`, `npm run typecheck`, `npm test`, then commit only SDK/tests/generator files as `feat(sdk): add session quote and settlement client`.

### Task 3: Add server-side quote and transaction relay

**Files:**
- Create: `app/api/sessions/quote/route.ts`
- Create: `app/api/sessions/start/route.ts`
- Create: `app/api/sessions/[sessionId]/stop/route.ts`
- Create: `lib/server/session-service.ts`
- Create: `tests/session-routes.test.ts`
- Modify: `.env.example`, `.gitignore`, `next.config.ts` only for protected server config/no-store headers, and CI only if it needs the Node version already specified by package engines.

**Interfaces/config:**
- Quote POST fields: `{customer,serviceId,maxAmount,maxDurationSeconds}`. Response includes `SessionQuote`, provider EIP-712 signature, and a customer-readable service label/rate/expiry.
- Start POST fields: `{quote,providerSignature,covaAuthorization,covaSignature}`. Response is `{sessionId,transactionHash,status}` after successful contract confirmation or a clear pending receipt response.
- Stop POST fields: `{sessionId,validUntil,customerSignature}`. It submits only the one-use customer authorization to the public Router.
- Server-only variables: `COVA_SESSION_ROUTER_ADDRESS`, `COVA_SESSION_RELAYER_PRIVATE_KEY`, `COVA_SESSION_PROVIDER_PRIVATE_KEY`, `COVA_SESSION_RATE_PER_MINUTE`, `COVA_SESSION_MAX_DURATION_SECONDS`, `COVA_SESSION_START_WINDOW_SECONDS`, and `COVA_SESSION_SETTLEMENT_GRACE_SECONDS`. None are `NEXT_PUBLIC_*`; absent config returns a disabled-feature response.

- [ ] **Step 1: Write route validation tests.** Reject malformed/oversized JSON, wrong chain/vault/Router, wrong session ID, reused/expired signature, insufficient available funds, missing server config and invalid service/rate bounds without returning stack traces or request signatures.
- [ ] **Step 2: Implement a server-only quote signer.** Confirm chain 421614, v2 vault, official six-decimal USDG and available customer funds. Generate a fresh unpredictable session ID, compute `holdExpiresAt >= startBy + maxDuration + grace`, sign only the provider quote, and return its exact financial terms.
- [ ] **Step 3: Implement start/stop simulations and submission.** Use a dedicated server relayer account, simulate the exact Router call first, verify provider/customer domains, submit once and wait for a confirmed receipt. Resolve repeat requests from Router session state; never accept a caller-supplied price or recipient override.
- [ ] **Step 4: Bound relay spend.** Enforce per-customer active-session and request limits plus a daily relay transaction budget. Return typed rate-limit/insufficient-balance errors; never log private keys or raw customer/provider signatures.
- [ ] **Step 5: Verify secret hygiene.** Audit `.env.example`, API bundles and errors. Confirm the two server private keys never enter browser source/maps, response JSON, command argv, console output or a Git-tracked file. Add placeholders only; do not add real credentials.
- [ ] **Step 6: Run route/SDK tests and commit server endpoints separately as `feat(api): relay authorized session lifecycle`.

### Task 4: Build the embedded customer and provider session experience

**Files:**
- Create: `components/session-checkout.tsx`, `components/session-receipt.tsx`, `lib/session-controller.ts`
- Modify: `app/page.tsx`, `components/cova-playground.tsx`, `components/hold-card.tsx` only for linking/reuse, `app/globals.css`, `tests/e2e/sessions.spec.ts`, and `tests/ui-safety.test.ts`.

- [ ] **Step 1: Add a checkout test with real service terms.** Customer must see provider, `0.50 USDG/min`, 20 USDG maximum, 40-minute cap, expiry, returned-balance rule, and testnet indicator before the wallet signs. Assert price terms match the quote hash submitted to Router.
- [ ] **Step 2: Render one embedded service flow.** Use the existing Cova type, balance, transaction status, explorer link and design tokens. A returning funded user reaches one customer start signature; the provider relay handles the start transaction. Fresh-wallet funding remains visible as an earlier approve/deposit sequence.
- [ ] **Step 3: Gate service start on a confirmed hold.** Show loading, wallet-rejected, low-balance, wrong-chain, pending-start, start-confirmed and stale-quote states. Never show an active service before an onchain start receipt. An expired CovaRouter configuration disables only the session checkout; the existing direct flow remains available.
- [ ] **Step 4: Add session end and settlement receipt.** Customer explicitly ends with a one-use signature; API relay ends it. Show chain-derived elapsed time, formula/rate, capped amount, returned Cova available balance, provider address and Arbiscan transaction link. Show “expired/recovery pending” until an expiry transaction is confirmed.
- [ ] **Step 5: Fix the test USDG path.** Point the test-token CTA to `https://faucet.paxos.com/`. Label the user network/token needed, include copyable official Arbitrum Sepolia USDG address and ETH-gas help. Explain access could not be confirmed from the user's Indonesian network. Do not claim bypass or faucet success.
- [ ] **Step 6: Verify the first-funding fallback.** Test a connected wallet with zero USDG and a funded Cova balance. A zero-USDG customer sees an exact approve/deposit path and the faucet helper; session start stays disabled until the contract confirms enough available balance.
- [ ] **Step 7: Browser-test the complete Anvil flow at desktop/mobile.** Use actual Anvil MockUSDG and test keys only in clearly labeled local tests. Verify approve/deposit, exact quote, start, 28-minute rate calculation via time warp, settlement 14/release 6, Cova available +6, merchant +14, receipts in another browser, invalid session, customer/provider stop and no mobile overflow.
- [ ] **Step 8: Run frontend validation and commit UI/E2E as `feat(ui): embed metered Cova sessions`.

### Task 5: Connect the sample provider to one real work session

**Files:**
- Create: `examples/session-provider/server.ts`, `examples/session-provider/README.md`, `tests/provider-session.test.ts`
- Modify: `.github/workflows/ci.yml` only to add the offline Anvil session-provider test.

- [ ] **Step 1: Define the work boundary.** The reference provider starts a deterministic local computation only after a confirmed `SessionStarted` receipt and stops immediately on signed stop or the quoted duration cap. It reports an itemized elapsed-session receipt; it does not claim to prove offchain CPU use from an onchain clock.
- [ ] **Step 2: Make provider callbacks idempotent.** Key start/stop handling by `sessionId` and tx hash. On duplicate callback, query Router state and return the same result without starting a second job or sending a second capture.
- [ ] **Step 3: Inject deterministic failure/retry tests.** Cover provider unavailable, start transaction pending/reverted, session stop relay duplicated, expiry cleanup, and RPC timeout. A failed start must never cause provider work to start.
- [ ] **Step 4: Exercise the two-account public-fork equivalent locally.** Use customer and provider/relayer Anvil accounts separate from deployer. Deposit and reserve real local MockUSDG, perform the real session workload, stop, settle the actual Router/CovaVault contracts, and assert provider/customer token balances and Cova available/held state.
- [ ] **Step 5: Write operator setup and commit as `feat(provider): add timed session reference service`.

### Task 6: Verify/fund the public testnet pilot and hand off

**Files:**
- Create: `deployments/arbitrum-sepolia-session-router.json` only after an actual confirmed Router deployment.
- Modify: `.env.example`, `README.md`, `docs/TEAM-NEXT-STEPS.md`, and `docs/OPTIONAL-VALIDATION.md` with actual confirmed addresses/status.

- [ ] **Step 1: Run full local checks and source verification.** Require contract unit/fuzz/invariant tests, SDK tests, typecheck, lint, build, CI, and full local two-wallet E2E to pass before a testnet transaction.
- [ ] **Step 2: Deploy the Router to Arbitrum Sepolia** using the existing CovaVault v2 and official USDG; obtain explicit local-wallet configuration already authorized for testnet deployment. Simulate and verify chain, contract addresses, constructor bytes and projected gas first. Never print or put a key in CLI argv.
- [ ] **Step 3: Confirm the live deployment.** Record the actual transaction/address/block, verify source, Router v2/chain/token, and EIP-712 digest against viem and onchain behavior. Update only actual public environment values.
- [ ] **Step 4: Obtain official test USDG and gas for separate wallets.** The Paxos faucet page/network selection must be exercised by a human if access control/CAPTCHA appears. Do not substitute MockUSDG on Arbitrum or claim a funded balance without reading it onchain.
- [ ] **Step 5: Run the public session E2E with customer/provider wallets.** Start after the hold confirms, run an actual timed session, stop, verify `rate × chain seconds`, provider token delta, reserved→available delta and explorer receipts from a fresh browser. Record observed addresses/session/receipt/block evidence without recording private keys.
- [ ] **Step 6: State the exact traction boundary.** A funded test-wallet session is an E2E success, not product-market fit. Keep external integrator interviews, repeat use and willingness-to-pay evidence in separate named PMF measurements.
- [ ] **Step 7: Commit deployment/docs evidence, create a reviewable `feature/metered-session-checkout` PR after CI, and leave root main and pre-existing dependency changes untouched.

**Out of scope in this plan:** full smart-wallet/passkey onboarding, a production gas sponsorship network, KYC/marketplace, refunds/disputes after capture, the physical EV meter/charging integration, onramps, multiple tokens, mainnet deployment, claiming market traction from testnet events, or changing any production fee.
