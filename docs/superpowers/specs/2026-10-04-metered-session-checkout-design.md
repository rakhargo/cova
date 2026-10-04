# Cova Metered Session Checkout — Design

> Status: review draft. No contract or application behavior is changed by this document.

## Goal

Let a customer start a time-bounded digital service with an agreed USDG rate and budget. A provider receives payment for the session time recorded onchain, while unused authorized funds return to the customer's available Cova balance. The customer sees the provider, rate, budget, and session boundary; vault and relayer steps happen in the background when the customer has already funded Cova.

## Intended user and problem

First target: a developer platform that already accepts stablecoins and sells short-lived, time-based digital access or jobs. A provider spends resources while a session runs. An unpaid invoice leaves the provider carrying that cost, while charging the maximum in advance asks the customer to pay for time they may not use. A flat-price service with a trusted prepaid invoice does not need Cova's hold lifecycle.

Start with duration-based access. The onchain clock provides an auditable billing input. Do not claim that elapsed time proves CPU usage, energy delivered, file processing, or any other external work. Those need a named data source and trust model. EV charging and physical rentals are not the first integration because their usage or damage evidence requires external attestations and operational rules.

## Product promise

“Set a rate and a spending limit before the session. The provider receives the agreed rate for the session time. Unused reserved USDG returns to the customer's available Cova balance.”

The cap is a limit on the customer's exposure. It is not the final invoice and cannot by itself justify what the provider charges. The session rate and onchain duration determine the amount.

## Proposed flow

1. A provider issues a quote bound to the customer, USDG, rate per minute, maximum amount, maximum duration, service identifier, quote identifier, start deadline, and hold expiry.
2. The app shows the rate, maximum spend, maximum session time, provider, and end policy. The customer signs the quote-bound CovaVault v2 hold authorization.
3. An authorized session relayer submits the authorization to a new immutable CovaSessionRouter. The router reserves the customer's existing Cova available balance through the deployed CovaVault v2. The provider starts service only after the onchain session-start event is confirmed.
4. The customer or provider ends the session. A customer may instead sign a one-use session-stop authorization which a relayer submits. The router calculates billable seconds from the onchain start time to the confirmed stop time, bounded by the quoted maximum duration.
5. In one onchain settlement transaction the router captures `floor(ratePerMinute × billableSeconds / 60)`, forwards exactly that amount to the provider, and releases the remainder through the vault. Six-decimal USDG is calculated in base units; fractional token dust rounds down and is shown in the receipt.
6. At the maximum duration the provider must stop the service. A permissionless finalizer can settle the full quoted duration inside the authorized capture window if no early stop arrives. After hold expiry, capture is rejected and permissionless expiry recovery returns the uncaptured amount.

Illustration only: at 0.50 USDG/minute, a 20 USDG cap allows up to 40 minutes. A confirmed 28-minute session charges 14 USDG and returns 6 to Cova available balance. The customer would need to withdraw separately to move that balance back to an external wallet.

## Contract and authorization design

Add `CovaSessionRouter.sol`; do not modify the immutable deployed CovaVault v2. The router constructor pins the known v2 vault and settlement token and rejects an unsupported network, non-USDG token, or vault without the expected v2/EIP-712 domain.

`SessionQuote` contains `sessionId`, `customer`, `provider`, `serviceId`, `ratePerMinute`, `maxAmount`, `maxDurationSeconds`, `startBy`, and `holdExpiresAt`. A provider EIP-712 signature binds all fields to the Router and chain. `sessionId` is single-use. Require a positive rate/duration, the full-duration formula to fit under the signed maximum, `startBy` in the future, and enough capture window after the latest allowed start and session duration.

At start, the customer CovaVault v2 authorization must match the quote's customer, Router-as-merchant, maximum, hold expiry, and quote digest as `referenceId`. The existing vault remains the authority for customer EOA/ERC1271 signature, available balance, nonce, and exact reserve. A failed start must roll back both the vault nonce and session state.

Only the router is set as merchant on the underlying hold. The router calculates the capped billable duration itself and performs capture and release atomically. Provider payout uses the quote-bound provider address, with exact token balance checks and reentrancy protection. No admin, arbitrary withdrawal, arbitrary recipient, fee override, refund, or price change is added.

Use the existing v2 EIP-712 primitives and OZ `SignatureChecker`. The Router's typed domain is `CovaSessionRouter` version `1`, bound to `block.chainid` and the router address. One end-session signature is scoped to one `sessionId`, caller, and deadline; finalized sessions cannot be settled twice. UI state comes from router/vault storage; receipt scans supplement it and remain bounded/error-visible.

## Invisible boundary and funding

For a returning customer with Cova USDG available, the UI can request a quote-bound authorization signature, submit it through a relayer, wait for confirmed start, and hide manual customer/merchant role switching and copy/paste authorization packets. Ending a session should use the customer/provider wallet or an explicit one-use customer signature; the backend must never receive the customer's key.

For a customer without Cova funds, the current approve/deposit funding steps still exist. Gas sponsorship for that first funding and smart-account onboarding are outside this initial vertical slice. The checkout always displays the agreed provider/rate/cap, and the customer approves it before start. Never describe “invisible” as consent-free or gas-free when another party actually pays gas.

The current app's “Get test USDG” link opens a long Paxos guide. Replace it with the Paxos Testnet Faucet link and a small in-app note naming the exact Arbitrum Sepolia network and official USDG token address. The faucet exposes network choices, but Arbitrum Sepolia availability and access from the user's Indonesian network were not verified in this session. Keep that uncertainty visible; provide the official address and a clear alternative for already-funded test wallets. Do not spoof faucet balances, mint a project token, bypass a CAPTCHA, or tell customers a VPN fixed production eligibility.

## Scope and exclusions

The vertical slice includes the immutable session router, typed provider quotes, customer-authorized start/stop, capped duration billing, one-transaction settlement/release, a small provider session adapter, SDK methods/types, an embedded customer checkout/session receipt, direct official faucet guidance, and a two-wallet local/testnet verification path.

It excludes metering CPU/kWh from external sensors, a physical EV/card/rental adapter, dispute resolution, arbitrary refunds after capture, NFT receipts, credit/lending, yield, marketplace discovery, AI, cross-chain support, automatic fiat onramps, a full AA/paymaster product, production compliance claims, and analytics that count test wallets as customers.

## Success and non-claims

Technical success means one local and one funded Arbitrum Sepolia session can start from a quote, stop before the duration cap, charge the exact rate formula, settle to the quoted provider, return the remainder, reject replay/over-cap/expired/invalid-provider paths, and show receipts. A fresh session must read balances/session state from contracts.

This does not establish PMF. The current public scan from vault v2's creation block found zero `HoldCreated` events through block 315682993 and zero Cova USDG liabilities at the observed read. Public test USDG has no financial value. Mainnet revenue, repeated third-party use, and production safety remain unproven.

## Validation gate

Before any public router deployment, pass contract/SDK unit, fuzz and invariant tests; production build, lint and E2E; creation/runtime/source verification; and local two-account settlement. Then verify a funded public two-wallet flow using the official test token and honest separate accounts. The merchant's test wallet, relayer and customer must not silently share the deployment secret. Do not claim public payment success until receipt, recipient transfer, customer balance, and returned remainder are observed.
