# Cova MVP validation — 2026-10-03

| Check | Result |
| --- | --- |
| Dependency installation | Completed; reproducible package-lock.json |
| TypeScript / lint / production build | Passed; Next.js prerenders `/` and `/_not-found` |
| Domain and transaction tests | 8 passed, 0 failed |
| Foundry default suite | 62 passed, 0 failed; 2 optional fork tests skipped without RPC |
| Official USDG fork | Both opt-in tests passed separately with Arbitrum Sepolia RPC |
| Contract formatting | Passed |
| Local Anvil transaction integration | Passed, distinct customer and merchant signers |
| Browser suite | 6 passed, 0 failed, including 3 real local wallet tests |
| Independent code review | No remaining critical/important findings after fixes |

## Money and security evidence

The local integration runs actual ERC-20 transactions: approve/deposit100 → reserve20 (available80/reserved20) → merchant receives14 → release6 (available86/reserved0) → withdraw86. Wrong-customer capture/release, excessive withdrawal and terminal capture are rejected. Final vault token balance equals total liability.

Each Foundry invariant runs 128 sequences of64 calls (8,192 calls per invariant), zero handler reverts. Fuzz tests use256 runs. Unit/security coverage includes permissions, partial/full/multiple captures, exact expiry boundaries, overflow, history pagination, donations, fees, false/no-return tokens and cross-function reentrancy. See `contracts/VALIDATION.md` for details.

Browser checks exercise Court20/14/6, EV30/17.42/12.58, approval/deposit, invalid precision, mobile390px overflow, wrong-chain switching, rejected wallet approval, actual local deposits/withdrawals, merchant account switching, permission separation, chain-time expiry and RPC Retry. The injected browser test provider uses unlocked Anvil accounts only and is excluded from production code.

Review found and fixed cancellation/replacement handling, deployment Retry recovery and wall-clock expiry controls. Repricing updates the hash; cancelled/different transactions never confirm the original payment. Live controls use chain time. Local metadata cannot override contract accounting/status.

Official USDG `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` was checked against Paxos docs and RPC: deployed code, symbol USDG, six decimals, chain421614. Two independent fork runs passed actual token approval/transfer flows. Fork customers are funded only in the local fork through a cheatcode; no public transaction or faucet acquisition is claimed.

## Deployment status

No Arbitrum Sepolia deployment credentials were available. No public CovaVault address is claimed. Local deployment used Anvil chain31337 and the clearly labelled **MockUSDG test fixture**. Generated addresses are in ignored `local-deployment.json`, not public deployments. README contains exact live deployment and two-wallet demo commands.

## Dependency audit

Final `npm audit --omit=dev`: **0 vulnerabilities**. Full audit: **5 high entries**, propagated from one unresolved `braces` advisory through `micromatch`, `fast-glob`, `@next/eslint-plugin-next` and `eslint-config-next`. These belong to development tooling. Registry braces3.0.3 remains current and in the advisory range. The suggested forced major downgrade of Next's ESLint config was not applied.

Source: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

Compatible overrides update WebSocket, URL decoding and UUID dependencies. The app imports the injected connector from `@wagmi/core` to avoid unrelated wallet SDK bundling. Installation emits a legacy React peer warning from an unused inherited connector dependency. Typecheck, lint, build and browser flows pass on React19.3.0.

## Runner and product limits

Next's detached TypeScript child process produced empty output inside the restricted process sandbox; the production build passed with normal local process permission. Foundry's global signature-cache write warning did not affect successful test/format exit codes. Coverage has a supplementary Solar/source-anchor tooling issue documented in `contracts/VALIDATION.md`.

Public deployment, funded Arbitrum wallet testing and public Arbiscan receipts remain external setup. No EIP-712, relayer, cleanup scheduler, shared reference/receipt index, disputes or production audit. UI loads all pages of a wallet's onchain history. USDG issuer restrictions remain external dependencies; token donation surplus has no rescue path.

Original PRD and provided logo asset are preserved. During the initial build, the sandbox exposed a protected placeholder `.git` and no Git repository was initialized. The follow-up publication request authorizes Git initialization, separate commits and publishing to `rakhargo/cova`. Deployment credentials remain outside version control.
