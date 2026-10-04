# Cova timed session checkout

Cova's original direct hold playground remains available. The timed session section is one reference use case for a digital service billed by duration. A 20 USDG budget at 0.50 USDG per minute covers up to 40 minutes. After a 28 minute confirmed session, the Router sends 14 USDG to the provider and releases 6 USDG to the customer's available Cova balance.

## Customer and provider flow

1. The provider API signs a quote for one customer, service, rate, budget, duration, start deadline and hold expiry.
2. The checkout displays those fields, network and testnet status before the customer signs a CovaVault v2 hold authorization. The customer signs once; the signature authorizes a reserve, not an immediate charge.
3. The API relayer simulates and submits the Router start. The provider adapter may start its work only after it reads the confirmed active session onchain.
4. The customer signs a one-use stop authorization. The relay submits it and the Router uses its onchain start/stop timestamps to calculate the charge, transfers exactly that amount to the signed provider, and releases the remainder.
5. The customer may withdraw returned Cova available balance separately. At the maximum duration a permissionless keeper can settle the full quoted duration. After hold expiry, anybody can recover the reservation with zero provider payment.

The Cova vault remains authoritative for funds and balances. The immutable Router is the vault merchant and captures only the signed rate multiplied by onchain seconds, rounded down in USDG base units. The quote must cover the full duration and has a cleanup interval after the last possible session end.

The chain proves the signed rate, session boundaries, reserve, payout and release. It does not prove CPU work or service quality. The sample provider runs a deterministic local hash loop after a confirmed session starts; it is an integration adapter, not evidence that Cova metered useful work. Do not advertise measured CPU time, energy, downloads or service completion from the chain timer alone.

## Local Anvil

After starting Anvil, run:

```bash
forge build --root contracts
npm run abi
npm run local:deploy
```

The ignored `.env.anvil` configures local MockUSDG, the local CovaVault, Router, and deterministic Anvil accounts for the session API. Those provider and relayer keys are public test fixtures. Never point them to a public network or reuse them as secrets.

In separate terminals, load that file and start the app and provider adapter:

```bash
set -a
source .env.anvil
set +a
npm run dev -- --port 3102
```

```bash
set -a
source .env.anvil
set +a
npm run session:provider
```

Connect Anvil account 0, approve and deposit MockUSDG into Cova, then start and stop a session. The checkout and page label this chain Local Anvil; no explorer transaction link is shown.

## Server configuration

The timed-session API is disabled unless a Router, vault, USDG, RPC, and distinct server-only provider and relayer keys are configured. Use dedicated low-balance backend accounts for Arbitrum Sepolia. Never reuse the deployer key or place any session key in a `NEXT_PUBLIC_*` variable. The API checks chain ID, code, Router configuration/domain, CovaVault v2 and token symbol/decimals before signing quotes or relaying. It bounds quote duration, active sessions per customer, JSON bodies and in-memory requests per minute. `COVA_SESSION_PER_PROCESS_RELAY_LIMIT` is a best-effort counter in one process for one UTC day. It resets on process restart, and replicas do not share it. It is not a global transaction or spend limit and is not a security boundary. A hosted multi-instance service needs a durable shared quota, idempotency and operations monitoring.

Required server variables are listed in `.env.example` with secret values blank. No backend provider or relayer account is supplied by this repository. Without them the UI explains that timed checkout is unavailable while the existing direct hold flow remains usable.

## Test USDG

The funding panel links directly to the [Paxos Testnet Faucet](https://faucet.paxos.com/), names Arbitrum Sepolia and gives a copyable official USDG address. Faucet network support and access from Indonesia remain unverified. The faucet may impose eligibility, CAPTCHA or regional checks; Cova does not bypass them. Arbitrum Sepolia ETH is also needed for wallet transactions.

## Public pilot gate

Router deployed on Arbitrum Sepolia: [`0xe8ba68458e932921f5401f48eb36ed881255db5a`](https://sepolia.arbiscan.io/address/0xe8ba68458e932921f5401f48eb36ed881255db5a#code). The source is verified on Arbiscan. Receipt, block, vault/token checks and EIP-712 checks are recorded in `deployments/arbitrum-sepolia-session.json`.

To deploy a new Router using the Foundry script, load an ignored environment file containing `ARB_SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `COVA_SESSION_VAULT_ADDRESS` and `USDG_ADDRESS`, then run:

```bash
forge script contracts/script/DeploySessionRouter.s.sol:DeploySessionRouter \
  --root contracts --rpc-url "$ARB_SEPOLIA_RPC_URL" --broadcast
```

The provider adapter is a separate process. For this demo it runs locally against the public Router; Vercel hosts the checkout and quote/start/stop APIs. Start the adapter with the server-only configuration loaded and `npm run session:provider`. It runs an illustrative hash workload and permissionlessly finalizes sessions at their signed time cap. It is not a permanently hosted compute provider.

Validation on 2026-10-04: 107 Foundry tests passed (3 opt-in fork tests skipped), 48 unit tests passed, and the entire 11-test browser suite passed. An actual local API/SDK/Anvil flow deposited 100 MockUSDG, reserved 20, billed 122 seconds at 0.50/minute, paid 1.016666 to the provider, and released 18.983334. Customer available balance ended at 98.983334. The public demo customer wallet had zero USDG and zero Cova available balance at verification time; public funded settlement still requires official test USDG from Paxos and wallet deposit.

The Router constructor only accepts CovaVault v2, its configured USDG, and chain IDs 421614 or local Anvil. Testnet deployment must record the actual receipt, address and block and verify runtime, constructor configuration, EIP-712 domain and source. A funded public E2E requires separate customer, provider and relayer accounts plus official test USDG and gas. Record chain receipts and resulting balances before claiming the pilot worked. A test-wallet session is not customer traction or product-market fit.
