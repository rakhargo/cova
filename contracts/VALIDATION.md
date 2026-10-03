# Contract validation — 2026-10-03

Verified using Foundry 1.5.1-stable, Solidity 0.8.30, OpenZeppelin Contracts 5.6.1, and vendored forge-std v1.9.7.

- `forge test --json`: 62 passed, 0 failed, 2 optional fork tests skipped without RPC. Machine-readable counts are in `verification/test-summary.json`.
- `ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc forge test --match-contract CovaVaultForkTest -vv`: both official USDG fork integration tests passed on Arbitrum Sepolia, block 315371623. Actual token approval/transfer methods exercised; local balance cheatcode only; no public transactions.
- `forge fmt --check`: passed.
- `forge build --sizes`: passed; vault runtime is 5,442 bytes. Production artifact metadata confirms optimizer enabled, 200 runs, and Cancun EVM target.
- `forge inspect CovaVault abi --json`: confirmed hold tuple order/types, uint8 enum ABI, paginated ID getters, immutable token getter, and HoldCreated's trailing referenceId.

The test-first sequence began with a deposit test that failed (`0 != 100000000`), then passed after implementing transfer/accounting. Lifecycle tests failed against the interface scaffold before implementation; security tests reproduced missing fee checks, settlement rollback and cross-function guards. Sequence invariants reproduced missing hold discovery and withdrawal accounting before the completed implementation passed.

Coverage includes zero/invalid inputs, constructor address/code validation, uint128 maximum and overflow rejection, insufficient and reserved balance protection, multiple holds and repeated references, customer/merchant isolation, partial/full/multiple captures, zero/over/wrong-actor/expired captures, terminal hold reuse, merchant release, partial release, permissionless expiry cleanup at the exact boundary, events, pagination (including uint256.max offsets), donation accounting, no-return and false-return ERC-20s, introduced transfer fees, callbacks into all six mutators, and full rollback of a bubbled reentrant callback.

Three invariants each passed 128 sequences of 64 handler calls (8,192 calls per invariant, zero reverts). They verify lifetime money conservation and liabilities, active reserved sums and capture limits, and unique discoverable history across three customers and two merchants.

## Coverage tool limitation

The default relative OpenZeppelin remapping builds and tests correctly, but Foundry 1.5.1 coverage's Solar analysis rejects relative dependency imports outside `contracts/`. An absolute remapping allowed coverage to complete:

```bash
forge coverage --report summary --exclude-tests \
  --out /tmp/cova-coverage-artifacts --cache-path /tmp/cova-coverage-cache \
  -R '@openzeppelin/contracts/=/home/rakhargo/projects/cova/node_modules/@openzeppelin/contracts/'
```

It reported CovaVault coverage of 83/83 lines, 126/126 statements, 21/21 branches, and 13/13 functions. It also emitted source-anchor warnings, so this percentage is a qualified tool report, not a substitute for the unit/fuzz/invariant evidence. The deployment script was compiled but was not broadcast or executed in this contract subtask.

Foundry also warned that its global signature cache could not be written in the restricted environment. That warning did not affect compiler or test exit codes. Historical red-test invariant counterexamples in the generated cache were ignored after bytecode changed.

## Remaining external requirements

The follow-up deployment is confirmed on Arbitrum Sepolia at `0xeb008dd97b0d17200055A3c7b5c60aB8b31CE428`; see `../deployments/arbitrum-sepolia.json` for its transaction and exact source-verification evidence. A funded two-wallet public payment lifecycle remains to be exercised. The official token's external freeze/upgrade behavior remains an underlying token dependency. The vault supports a standard non-rebasing token; donations have no rescue path; EIP-712 and settlement reversal are outside this MVP.
