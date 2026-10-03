# Cova — team handoff and next steps

Updated 2026-10-03. **Arya's first assigned task is frontend redesign only. Other remaining work has no assigned owner yet.**

## Current state

- Public repository: https://github.com/rakhargo/cova
- Arbitrum Sepolia vault: `0xeb008dd97b0d17200055A3c7b5c60aB8b31CE428`
- Official USDG: `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`, six decimals
- Deployment is confirmed and matches the compiled contract. Sourcify and Blockscout source verification passed; see `deployments/arbitrum-sepolia.json`.
- Available/reserved accounting, deposit/withdraw, partial/full/multiple captures, release and expiry are implemented.
- 62 Foundry tests, two official USDG fork tests, eight domain/transaction tests and six browser tests passed. GitHub CI covers the local two-wallet flow.
- Production frontend builds and reads the deployed vault. Its read-only production check showed zero USDG/available funds for the deployer; no public payment lifecycle was signed during that check.
- The full signed, funded customer/merchant flow on Arbitrum Sepolia remains pending. Frontend hosting at a shared URL is also pending.

## Assigned task: Arya — frontend redesign

Scope: visual design, layout, hierarchy, responsive behavior and clarity of the existing payment flow. Use the supplied `Cova logo.png` as a brand reference. Keep the product an infrastructure playground with the three existing presets.

Likely files: `app/page.tsx`, `app/globals.css`, `components/cova-playground.tsx`, `components/hold-card.tsx`, `public/`. `app/layout.tsx` can change for presentation metadata/fonts. Read `AGENTS.md` and the relevant installed Next.js documentation before editing.

Preserve these behaviors:

- Real injected-wallet connection and chain switching
- Exact-amount USDG approval followed by deposit
- Real available/reserved balances and readable loading/error states
- Customer/merchant separation; selecting Merchant never changes wallet permissions
- Maximum authorization and expiry review before submission
- Partial capture, remaining release and chain-time expiry cleanup
- Settlement summary with captured/released amounts and actual transaction links
- Explicit Demo Mode and local MockUSDG labels
- Usable mobile layout, keyboard access, form labels and transaction feedback

Do not change contracts, accounting, permission checks, deployment addresses, or wallet transaction logic as part of the redesign. If a presentation change needs a controller change, describe that separately for review.

Acceptance: the existing Court 20/14/6 and EV 30/17.42/12.58 flows still work, mobile has no horizontal overflow, and the interface clearly distinguishes a reservation from a payment. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and the browser suite against Anvil. Keep UI commits separate and open a PR from a branch such as `feature/redesign-frontend`.

## Remaining work — ownership undecided

| Priority | Work | Completion evidence |
| --- | --- | --- |
| P0 | Fund customer with official USDG and both wallets with Arbitrum Sepolia ETH | Live token/gas balances; two distinct wallet addresses |
| P0 | Run and record the full signed public-network payment lifecycle | Authorization/capture/release receipts, reconciled balances and Arbiscan links |
| P0 | Check public-network expiry and permission failures | Expired capture rejected; expired remainder recovered; wrong merchant rejected |
| P0 | Host a shared frontend demo after the redesign | Public URL, correct public environment variables, successful wallet flow |
| P0 | Record the short hackathon demo | One coherent 1–2 minute authorize/reserve/capture/release recording |
| P1 | Share receipt/reference history across browsers | Customer can see merchant action receipts in a different browser; state remains authoritative |
| P1 | Optional direct Arbiscan source verification | Explorer reports verified source; current Sourcify/Blockscout proofs already exist |
| P2 | EIP-712 authorizations and a merchant SDK | Domain/nonce/replay tests and a minimal integration example |

Core protocol features are implemented. EIP-712/SDK/indexing are extensions; they do not block the core live demo. Reentrancy and financial-accounting coverage already exist. The outstanding development-tool dependency advisory and an independent security audit matter before production use.

## Live E2E checklist

Use fresh, separate customer and merchant test wallets; do not reuse or share the deployment key. Both need ETH on chain 421614. The customer needs official test USDG from the [Paxos test crypto guide](https://docs.paxos.com/guides/developer/fund-sandbox-with-test-crypto). Configure the merchant's public wallet address in the form or the optional `NEXT_PUBLIC_DEMO_MERCHANT_ADDRESS` default.

- [ ] Customer connects an injected wallet and switches to Arbitrum Sepolia.
- [ ] Wallet reads actual USDG and Cova balances without an RPC/configuration error.
- [ ] Customer approves exactly 100 USDG, then deposits 100 USDG; both receipts confirm.
- [ ] Customer authorizes a 20 USDG Court Booking hold for the separate merchant wallet.
- [ ] Available decreases by 20 and reserved increases by 20.
- [ ] Customer's wallet cannot capture by merely selecting Merchant view.
- [ ] Merchant connects its actual wallet and sees its assigned hold.
- [ ] Merchant captures 14 USDG; token balance increases by 14 and remaining reserved becomes 6.
- [ ] Merchant releases 6; reserved returns to 0 and customer available becomes 86 for a fresh 100 deposit.
- [ ] Hold is terminal, captured 14/released 6, and cannot be captured/released again.
- [ ] Customer can withdraw available funds; reserved funds cannot be withdrawn.
- [ ] Actual authorization, capture and release hashes open on Arbiscan.
- [ ] Refresh/reconnect preserves onchain hold state; no simulated balances appear.
- [ ] A separate short-expiry hold rejects capture at/after expiry and returns its remainder through `releaseExpired`.

If starting with existing funds/holds, verify the same deltas instead of assuming fixed totals. Record the actual hold ID, wallet addresses, transaction hashes, ledger block numbers and before/after balances in `deployments/e2e-arbitrum-sepolia.json` only after executing the flow. The deployment receipt alone does not prove these payment steps.

## Local workflow for Arya

```bash
git clone https://github.com/rakhargo/cova.git
cd cova
npm ci
cp .env.example .env.local
git switch -c feature/redesign-frontend
npm run dev
```

For a visual simulation, clear `NEXT_PUBLIC_COVA_VAULT_ADDRESS` in `.env.local` and restart. To validate actual local transactions, start Anvil in another terminal:

```bash
anvil --host 127.0.0.1 --port 8545 --chain-id 31337
```

Then:

```bash
forge build --root contracts
npm run local:deploy
npm run test:integration
npm run test:e2e
```

To run the local Anvil UI interactively, load the generated `.env.anvil` before starting Next.js, as described in README. The generated MockUSDG is a local test fixture.

## Ready-to-use redesign prompt

> Redesign the existing Cova frontend in this repository. Your first task is frontend redesign only. Read AGENTS.md, PRD.md, README.md, docs/DESIGN.md, docs/TEAM-NEXT-STEPS.md, and the relevant Next.js guides in node_modules/next/dist/docs before editing. Improve visual hierarchy, spacing, typography, mobile usability and clarity of the reserve/capture/release lifecycle. Use Cova's supplied logo/brand reference. Preserve all existing wallet, chain, approval, deposit, authorization, partial capture, release, expiry, transaction and settlement behavior. Keep real and simulated modes explicit. Do not alter contracts, accounting, permissions, deployed addresses or wallet transaction logic. Validate typecheck, lint, unit tests, production build and the existing Anvil/browser flow. Commit UI work in focused parts and prepare a PR with screenshots and validation evidence. Other features are outside this first task.
