# Cova implementation plan

**Goal:** Run the full Cova funds lifecycle with real ERC-20 transfers and a usable wallet UI.
**Spec:** PRD.md, docs/DESIGN.md; user prompt overrides staged approval gates and authorizes complete implementation.

- [x] Contract: Foundry setup, test-first vault implementation, malicious-token/permission/expiry checks, fuzz and invariant suite, deployment script. Contract worker owns contracts/ only.
- [x] Frontend shell: landing, responsive playground, separated roles, balance and hold panels, clear simulation and transaction states. UI worker owns app/, components/ and public/ only; consumes lib/types.ts and useCova().
- [x] Integration: configuration, generated ABI, wallet provider, live state reads, validated writes and exact approvals, simulation reducer and tests. Lead owns lib/, scripts/, tests/ and root configuration.
- [x] Verification: run Anvil with distinct customer/merchant, approve/deposit/reserve/capture/release/withdraw and verify accounting. Inspect official USDG via Arbitrum RPC, fork test if available. Run browser demo scenarios, typecheck, lint, build and Foundry suite.
- [x] Handoff: README, reproducible commands, local/deploy environments, actual evidence, limitations and next steps.

## Review focus

Reserved funds must never be withdrawable or cancelled by the customer before expiry. Rejected token transfers revert accounting. Decimals come from the token rather than assumptions. Wrong wallet/chain/configuration disables writes. Chain data errors must remain visible rather than become fake zero balances. Demo state and real transaction links never mix.

## Execution log

Repository contains PRD.md only and a protected placeholder .git directory; it is not an initialized Git repository. Implement directly in the authorized workspace and preserve PRD.md. No deployment secret detected. Official Paxos token verified at https://docs.paxos.com/guides/stablecoin/usdg/testnet on 2026-10-03.

Final verification: 62 default contract tests + 2 official USDG fork tests, 8 domain/transaction tests, 6 browser tests, real Anvil lifecycle, TypeScript, lint and production build passed. No public deployment credentials; README and docs/VALIDATION.md record the exact external setup.
