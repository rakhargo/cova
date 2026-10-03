# Cova contracts

`CovaVault` holds customer USDG and transfers captured funds directly to the authorized merchant. Release moves an active hold's remaining funds back to the customer's available vault balance. A separate withdrawal returns available funds to the wallet.

## Build and test

Install the root npm dependencies first (`npm ci` from the Cova root), then run:

```bash
cd contracts
forge build
forge test
forge fmt --check
```

Solidity is pinned to 0.8.30, the EVM target is Cancun, and optimization uses 200 runs. OpenZeppelin Contracts is resolved from the root npm lockfile (currently 5.6.1). The Foundry test library is vendored at forge-std v1.9.7; provenance and archive checksum are in `lib/forge-std/VENDORED.md`.

The offline suite includes unit, fuzz, hostile-token, and sequence-based invariant tests. Fuzz runs are configured to 256; each of three invariants runs 128 sequences of 64 handler operations across three customers and two merchants, including donations and expiry.

## Official USDG fork tests

```bash
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc \
  forge test --match-contract CovaVaultForkTest -vv
```

Without `ARB_SEPOLIA_RPC_URL`, these two tests are explicitly skipped. They verify chain 421614, token code, symbol USDG and six decimals; use a local fork balance cheatcode; then call the actual USDG token contract for approval and transfers. They never broadcast transactions or use private keys.

Official token source: [Paxos USDG testnet documentation](https://docs.paxos.com/guides/stablecoin/usdg/testnet). Arbitrum Sepolia USDG: `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`.

## Deploy to Arbitrum Sepolia

Provide `ARB_SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, and `USDG_ADDRESS` through an untracked environment file or secure shell environment. Set `USDG_ADDRESS` to the official token above. Preview the deployment without broadcasting:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url arbitrum_sepolia
```

After reviewing the preview, the explicit broadcast command is:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url arbitrum_sepolia --broadcast
```

The script rejects another chain, another token address, missing token code, incorrect decimals or symbol, and a zero deployer key. Deployment requires funded testnet gas and the user's deployment key. No public deployment is claimed by the tests.

`test/fixtures/MockUSDG.sol` is only a local Anvil/test fixture. It has `constructor()`, `decimals() = 6`, and unrestricted `mint(address,uint256)`. Its compiled artifact is `out/MockUSDG.sol/MockUSDG.json`. It must never be presented as official USDG or deployed by the public deployment script.

## Exact behavior

All amounts use token base units (one USDG is 1,000,000 units). Every mutator is guarded against reentrancy. Zero deposits, withdrawals, holds, and captures revert.

| Call | Behavior |
| --- | --- |
| `deposit(uint256)` | Requires caller approval; credits exactly the tokens received. Rejects transfer fees or false-return transfers. |
| `withdraw(uint256)` | Caller can withdraw only available funds. Failed transfers roll back all accounting. |
| `createHold(address,uint256,uint64,bytes32)` | Caller reserves available funds for a nonzero merchant other than the vault. Amount cannot exceed uint128. Expiry must be strictly future. Returns a unique ID; duplicate references are permitted metadata. |
| `capture(bytes32,uint256)` | Assigned merchant only, while `block.timestamp < expiresAt`. Amount cannot exceed the remaining authorization. Transfers directly to merchant. Repeated partial captures are supported. Full capture closes the hold. |
| `release(bytes32)` | Assigned merchant only; closes the active hold and releases all remaining funds, including after expiry. |
| `releaseExpired(bytes32)` | Anyone can close an active hold at `block.timestamp >= expiresAt`, crediting only the customer. |
| `getCustomerHoldIds(address,uint256,uint256)` | History in creation order, including closed holds. |
| `getMerchantHoldIds(address,uint256,uint256)` | History in creation order, including closed holds. |

Page limits above 100 revert. A zero limit or an offset at/past history length returns an empty array, including `uint256.max` offsets.

`holds(bytes32)` returns these fields in order:

```text
address customer
address merchant
uint128 authorizedAmount
uint128 capturedAmount
uint64 expiresAt
uint8 status
bytes32 referenceId
```

Status values are `None=0`, `Active=1`, `Captured=2`, `Released=3`. Time passing does not mutate storage: an expired active hold remains reserved until release. For active holds, the reserved remainder is `authorizedAmount - capturedAmount`; closed holds reserve zero. The captured amount stays visible after release.

`token()` returns the immutable token address. `availableBalance(address)`, `heldBalance(address)`, and `totalLiability()` expose accounting. `MAX_PAGE_SIZE()` is 100. There is no owner, upgrade, arbitrary transfer, or administrative withdrawal path.

Events are `Deposited(address indexed customer,uint256 amount)`, `Withdrawn(address indexed customer,uint256 amount)`, `HoldCreated(bytes32 indexed holdId,address indexed customer,address indexed merchant,uint256 amount,uint64 expiresAt,bytes32 referenceId)`, `HoldCaptured(bytes32 indexed holdId,uint256 amount)`, and `HoldReleased(bytes32 indexed holdId,uint256 amount)`.

## Accounting and limits

`totalLiability = sum(availableBalance + heldBalance)`. Deposit increases liability; withdrawal and capture decrease it; reservation and release preserve it. Transfers must change the vault and recipient token balances by the exact amount, and outgoing transfers must leave the remaining liabilities covered. Direct donations create no credit and have no rescue path in this MVP.

The vault is designed for the configured standard, non-rebasing token. The vault cannot prevent an external token administrator from freezing, upgrading, or removing token balances. Token transfer restrictions can block deposits, capture, or withdrawals; failures revert atomically. Release itself makes no external transfer.

EIP-712 authorizations, fees, disputes, refunds after settlement, and token issuance are outside this implementation. Replay coverage concerns terminal hold reuse; no signed authorization endpoint exists.
