# Cova — MVP PRD

## 1. Product Summary

Cova is an onchain payment authorization layer for stablecoins.

It enables a customer to authorize a merchant to reserve up to a predefined amount of USDG, then allows the merchant to capture only the final amount owed and release the remainder.

The MVP will run on **Arbitrum Sepolia** and use **USDG**.

---

# 2. Product Objective

Demonstrate that card-style authorization holds can work as a composable stablecoin payment primitive.

The MVP must prove this complete flow:

```text
Customer funds Cova
       ↓
Merchant receives authorization
       ↓
USDG becomes reserved
       ↓
Service completes
       ↓
Merchant captures actual amount
       ↓
Unused USDG is released
```

Success means a judge can understand the product and complete this flow within a few minutes.

---

# 3. Target User

## Primary

Developers or platforms building stablecoin-enabled:

- bookings;
- rentals;
- hospitality;
- mobility;
- appointments;
- usage-based services.

## Secondary

Merchants who need to guarantee customer funds before final settlement.

---

# 4. User Problem

Stablecoin transfers are optimized for immediate final settlement.

Many merchant workflows instead require:

1. financial commitment before service;
2. unknown final price;
3. partial settlement;
4. unused funds returned automatically.

Without authorization holds, developers often need to create custom escrow/refund logic.

Cova exposes this as reusable infrastructure.

---

# 5. Jobs To Be Done

### Merchant

> When a customer books or starts a service, I want to reserve enough money to cover the expected charge so I know payment is available when the service ends.

### Customer

> When a merchant needs a payment guarantee, I want to commit only a maximum amount while ensuring the merchant cannot take more than I authorized.

### Developer

> When I build stablecoin payments, I want a simple authorization/capture primitive so I do not need to implement escrow logic myself.

---

# 6. MVP Scope

## Required

- wallet connection;
- Arbitrum Sepolia network handling;
- USDG integration;
- customer balance;
- available vs reserved balance;
- create authorization;
- merchant capture;
- partial capture;
- release remaining amount;
- expiry;
- transaction status;
- contract events;
- clear demo scenarios;
- Foundry tests.

## Optional

Only implement if required features are complete:

- merchant SDK helper;
- EIP-712 gas-light authorization flow;
- merchant history;
- multiple simultaneous holds;
- automatic expiry action UI.

---

# 7. Out of Scope

- fiat;
- production KYC;
- disputes;
- chargebacks;
- token issuance;
- yield;
- cross-chain settlement;
- production merchant accounts;
- oracle-based billing;
- subscriptions;
- multi-currency support;
- arbitration;
- complex role management.

---

# 8. Core User Stories

## Customer Wallet Connection

As a customer, I can connect an EVM wallet.

Acceptance criteria:

- wallet state visible;
- incorrect chain detected;
- user can switch to Arbitrum Sepolia;
- rejected wallet actions do not crash UI.

---

## Deposit USDG

As a customer, I can fund my Cova balance.

Acceptance criteria:

- approve USDG if required;
- deposit amount validated;
- available balance updates after confirmation;
- transaction link displayed.

---

## Withdraw Available USDG

As a customer, I can withdraw funds that are not currently reserved.

Acceptance criteria:

- cannot withdraw more than available;
- held funds remain locked;
- balance updates correctly.

---

## Create Hold

As a customer, I can authorize a merchant to reserve a maximum amount.

Inputs:

- merchant;
- max amount;
- expiration;
- optional reference ID.

Acceptance criteria:

- amount must be > 0;
- sufficient available balance required;
- authorization expiry must be future timestamp;
- funds move from available to reserved;
- HoldCreated event emitted.

---

## View Hold

Customer and merchant can see:

- hold ID;
- customer;
- merchant;
- authorized amount;
- captured amount;
- remaining amount;
- expiry;
- status.

---

## Partial Capture

As the authorized merchant, I can capture an amount smaller than or equal to the remaining authorization.

Acceptance criteria:

- only merchant can capture;
- cannot exceed remaining held amount;
- merchant receives captured USDG or receives withdrawable merchant balance;
- customer held amount decreases;
- event emitted.

---

## Full Capture

Merchant can capture the full remaining authorization.

Result:

hold becomes fully settled.

---

## Release Hold

Unused funds can be released.

Acceptance criteria:

- allowed actor rules explicitly defined;
- released funds become customer available balance;
- already captured funds remain settled;
- released hold cannot be reused.

Recommended MVP rule:

merchant can release any active remaining balance;

customer can release only after expiry.

---

## Expired Authorization

After expiry:

- merchant cannot perform new captures;
- customer or anyone through permissionless cleanup can release the remainder;
- expired authorization cannot be revived.

---

# 9. Demo Scenarios

The frontend should provide preset scenarios.

## Court Booking

Maximum authorization:
20 USDG

Suggested final charge:
14 USDG

Expected:

14 captured  
6 released

---

## Camera Rental

Maximum authorization:
100 USDG

Demonstrate:

- active reserved amount;
- partial settlement;
- release.

---

## EV Charging

Maximum authorization:
30 USDG

Example:

estimated amount:
30 USDG

usage-based final charge:
17.42 USDG

remainder:
12.58 USDG

This scenario most clearly illustrates why final amounts may differ.

---

# 10. Smart Contract Requirements

Primary contract:

`CovaVault.sol`

Suggested data model:

```solidity
enum HoldStatus {
    None,
    Active,
    Released,
    Captured
}

struct Hold {
    address customer;
    address merchant;
    uint128 authorizedAmount;
    uint128 capturedAmount;
    uint64 expiresAt;
    HoldStatus status;
}
```

Implementation may refine this structure.

---

# 11. Suggested Contract Interface

```solidity
function deposit(uint256 amount) external;

function withdraw(uint256 amount) external;

function createHold(
    address merchant,
    uint256 amount,
    uint64 expiresAt,
    bytes32 referenceId
) external returns (bytes32 holdId);

function capture(
    bytes32 holdId,
    uint256 amount
) external;

function release(
    bytes32 holdId
) external;

function releaseExpired(
    bytes32 holdId
) external;

function availableBalance(
    address customer
) external view returns (uint256);

function heldBalance(
    address customer
) external view returns (uint256);
```

If EIP-712 is implemented:

```solidity
function authorizeHold(
    HoldAuthorization calldata authorization,
    bytes calldata signature
) external;
```

---

# 12. Events

At minimum:

```solidity
event Deposited(
    address indexed customer,
    uint256 amount
);

event Withdrawn(
    address indexed customer,
    uint256 amount
);

event HoldCreated(
    bytes32 indexed holdId,
    address indexed customer,
    address indexed merchant,
    uint256 amount,
    uint64 expiresAt
);

event HoldCaptured(
    bytes32 indexed holdId,
    uint256 amount
);

event HoldReleased(
    bytes32 indexed holdId,
    uint256 amount
);
```

---

# 13. Contract Invariants

At all times:

- customer held balance must correspond to active holds;
- a hold can never capture more than authorized;
- customer cannot withdraw held funds;
- released funds cannot later be captured;
- expired hold cannot accept new capture;
- total accounting must reconcile with token balance;
- replayed signed authorization must fail.

---

# 14. Smart Contract Testing

Required tests:

### Deposit

- valid deposit;
- zero deposit handling;
- accounting.

### Withdrawal

- available balance withdrawal;
- cannot withdraw held balance.

### Hold creation

- valid hold;
- insufficient balance;
- invalid expiry;
- invalid merchant;
- zero amount.

### Capture

- partial capture;
- full capture;
- multiple partial captures if supported;
- over-capture;
- wrong merchant;
- expired hold.

### Release

- normal release;
- release after partial capture;
- duplicate release;
- expired release.

### Security

- replay;
- unauthorized actor;
- accounting invariant;
- reentrancy paths if external transfers occur.

Use fuzz tests for:

- authorized amount;
- captured amount;
- expiry.

Add invariant testing if practical.

---

# 15. Frontend Requirements

Suggested pages/states:

## Landing

Headline:

**Stablecoin payments shouldn't always settle upfront.**

Subtext:

**Cova lets merchants reserve USDG now and capture only what is actually owed later.**

CTA:

**Try Cova**

---

## Playground

Show:

### Customer Balance

Available  
Reserved  
Total

### Scenario Selector

Court Booking  
Camera Rental  
EV Charging

### Authorization

Merchant  
Maximum amount  
Expiry

CTA:

**Authorize Hold**

---

## Active Hold

Example:

```text
COURT BOOKING

Reserved
20 USDG

Captured
0 USDG

Remaining
20 USDG

Expires
42 minutes
```

Merchant control:

```text
Actual charge
[ 14 ]

[ Capture 14 USDG ]

[ Release Remaining ]
```

---

## Completion

```text
SETTLED

Authorized
20 USDG

Captured
14 USDG

Released
6 USDG
```

Provide:

transaction link;
new available balance;
merchant settlement.

---

# 16. UX Principles

- stablecoin mechanics should be understandable without blockchain knowledge;
- do not overwhelm users with addresses;
- explain "Reserved" instead of protocol jargon;
- highlight money states clearly;
- wallet actions must expose pending/confirmed/rejected states;
- blockchain details should be available but secondary.

---

# 17. Design Direction

Cova should visually resemble modern payment infrastructure.

Keywords:

- minimal;
- trustworthy;
- precise;
- clean;
- financial;
- developer-oriented;
- neutral.

Avoid:

- DeFi casino aesthetics;
- neon gradients;
- NFT styling;
- oversized blockchain branding.

Suggested conceptual visual:

```text
AVAILABLE
$100

     ↓ reserve $30

AVAILABLE     RESERVED
$70           $30

                   ↓ capture $18

AVAILABLE     CAPTURED
$82           $18
```

The flow of money should be the visual identity.

---

# 18. Architecture

```text
Customer Wallet
      │
      │ USDG
      ▼
  CovaVault
   │     │
   │     └────────→ Merchant
   │                captured funds
   │
   └──────────────→ Customer
                    released funds

Frontend
   │
   ├── wagmi / viem
   │
   └── Arbitrum Sepolia
```

Optional EIP-712:

```text
Customer
   │
sign authorization
   ↓
Merchant / Relayer
   │
submit
   ↓
CovaVault
```

---

# 19. Tech Stack

Frontend:

- Next.js
- React
- TypeScript
- Tailwind CSS
- wagmi
- viem
- zod

Contracts:

- Solidity
- Foundry
- OpenZeppelin

Network:

- Arbitrum Sepolia

Settlement token:

- Paxos USDG on Arbitrum Sepolia

---

# 20. Metrics for Future PMF Validation

Not required for MVP implementation, but product assumptions should eventually be validated using:

- authorization count;
- repeat merchant usage;
- repeat customer usage;
- average authorization amount;
- percentage partially captured;
- percentage fully released;
- frequency of variable final settlement;
- number of merchant integrations.

Most important metric:

**repeat authorization volume.**

---

# 21. Definition of Done

The MVP is complete when:

1. contracts compile;
2. Foundry tests pass;
3. Cova is deployed to Arbitrum Sepolia;
4. frontend reads official USDG;
5. customer can fund the vault;
6. customer can create an authorization;
7. merchant can partially capture;
8. remainder can be released;
9. balances reconcile correctly;
10. transaction links work;
11. demo scenarios work;
12. production build succeeds;
13. README explains the product and setup.

Anything beyond this is optional.