# Cova MVP design

The user supplied PRD.md and an explicit instruction to implement and validate autonomously. Scope is the actual authorize/reserve/capture/release lifecycle, without optional EIP-712 or backend services.

## Accounting and permissions

Use an immutable ERC-20 token and direct merchant transfer on capture. Customer balances are `availableBalance` and `heldBalance`. `totalLiability` equals the sum of both across customers. Deposit increases liabilities; withdrawal and capture reduce them; reservation and release preserve them. Vault token balance must cover liabilities. Donated tokens do not create credit. Net lifetime deposits = available + held + settled + withdrawals. Before expiry only the assigned merchant may release. At or after expiry any caller may release to the customer. Customer cannot unilaterally cancel an active merchant guarantee. Capture can repeat until the maximum is reached; a final release closes a partially captured hold.

## Interface contract

`deposit(uint256)`, `withdraw(uint256)`, `createHold(address,uint256,uint64,bytes32) returns(bytes32)`, `capture(bytes32,uint256)`, `release(bytes32)`, `releaseExpired(bytes32)`.
Reads: `token()`, `availableBalance(address)`, `heldBalance(address)`, `holds(bytes32)` returns customer,merchant,uint128 authorizedAmount,uint128 capturedAmount,uint64 expiresAt,uint8 status,bytes32 referenceId.
Enums: None=0, Active=1, Captured=2, Released=3.
`getCustomerHoldIds(address,uint256 offset,uint256 limit)` and `getMerchantHoldIds(address,uint256 offset,uint256 limit)` return bytes32[]; max page size 100. State reads are authoritative, including discovery. Events supplement receipts.

## Product and visual direction

Next.js app + wagmi injected connector + viem. Public configuration permits Arbitrum Sepolia or explicitly labelled local Anvil. Validate deployed bytecode, token identity, and decimals before enabling writes. Exact amount approval is a separate step. Wallet receipt confirmation precedes refreshed balances. Separate customer and merchant views; changing views never changes wallet permissions. Simulation uses a shared bigint state engine and is labelled Demo Mode, without fabricated explorer links.

Palette: paper white #F7F9FB, ink #172B45, muted #61728A, blue #2458D3, reserve amber #B77D19, release green #267457. IBM Plex Sans, tabular monetary numerals. A horizontal money movement rail is the main visual device; left aligned product copy and a responsive playground. Presets configure one primitive.

## Validation

Contract unit, fuzz, and invariant coverage; live Anvil two-account transaction integration; official USDG fork integration if RPC available; frontend validation and demo reducer tests; browser scenario checks, mobile overflow, lint, TypeScript and production build. Missing external credentials affect only public deployment and signed browser transactions; record exact evidence and limitations.
