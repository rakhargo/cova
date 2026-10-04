# Cova v2 optional capabilities
User authorization: implement the previously deferred EIP-712, SDK, and shared receipts now; deployment is explicitly deferred. Preserve Arya's frontend redesign scope. Work in codex/signed-authorizations; never use/copy the retired deployment secret.

## Contract interface
CovaVault remains immutable, no admin, same direct USDG settlement/accounting and hold statuses. Add OpenZeppelin EIP712("CovaVault","2") and SignatureChecker.
`version() view returns(uint256)` returns2.
`struct HoldAuthorization {address customer;address merchant;uint128 maxAmount;uint64 expiresAt;uint256 nonce;bytes32 referenceId;}`
Exact type hash string: `HoldAuthorization(address customer,address merchant,uint128 maxAmount,uint64 expiresAt,uint256 nonce,bytes32 referenceId)`.
`nonces(address) view returns(uint256)`.
`authorizationDigest(HoldAuthorization) view returns(bytes32)`.
`authorizeHold(HoldAuthorization,bytes signature) returns(bytes32)`: any relayer may submit; validate customer/signature, exact nonce, future expiry, valid merchant/amount and available funds. Consume nonce atomically exactly once; reserve from signed customer, never submitter. Existing HoldCreated event includes signed customer. Signature validation supports EOA/deployed ERC1271. Existing direct createHold remains supported and does not consume signed nonces.
`invalidateAuthorizations(uint256 newNonce)`: caller only invalidates its own pending signatures; newNonce > current; checked arithmetic must never wrap. Does not cancel active holds.
Keep all current methods and tests working. A customer signature creates no reservation until authorizeHold confirms. No merchant permission bypass; capture and release unchanged. Domain binds chain and vault.

## SDK
Small independently packable sdk/ package named @cova/sdk, peer dependency viem only; no new runtime libraries or backend. Generate its ABI from actual Foundry artifact, lib/abi.ts reexports it. Root script builds declarations/ESM with existing TypeScript; SDK imports use .js extensions for Node ESM compatibility.
Exports: authorizationTypes, authorizationDomain(chainId,vault), authorizationTypedData(chainId,vault,message), encodeSignedAuthorization(envelope), decodeSignedAuthorization(json), createCovaClient({publicClient,walletClient?,vault,chainId,token?}).
Envelope includes schemaVersion1, chainId, vault, authorization(base-unit numeric fields serialized as decimal strings), signature, optional description. Validate exact widths/nonzero addresses/domain/hex; description hash must match referenceId when provided.
Client operations: protocolVersion(), balances(address), hold(id), holdIds(address,role), prepareAuthorization({customer,merchant,maxAmount,expiresAt,referenceId}), signAuthorization(message), submitAuthorization(envelope), invalidateAuthorizations(newNonce), deposit/withdraw/createHold/capture/release/releaseExpired. Write operations simulate with actual caller then return hash; optional receipt wait helper. RPC chain/token and wallet chain/account consistency checked. Contract simulation is authoritative for EOA/ERC1271 validity; do not assume viem's broader ERC6492 verification is supported by the vault.
SDK history: readHoldHistory(holdIds,{fromBlock,toBlock,chunkSize?}) returns per-ID creation/capture/release hashes plus events; bounded chunked getLogs, deduplicate, never derive balances/status from logs. Surface scan errors. Caller supplies deployment block; history works against v1 as well.

## Frontend integration
Preserve existing layouts; add separate signed-authorization customer/merchant panel. Controller exposes protocolVersion/supportsSignedAuthorizations, signedAuthorization JSON, signAuthorization(input), submitAuthorization(json), invalidateAuthorizations(); transaction kind distinguishes signature from confirmed transaction. No simulated signature/relayer. Disable/hide signed flow on v1 or Demo Mode; explain signatures reserve only after merchant submission. Merchant UI validates its wallet equals assigned merchant (SDK allows any relayer); real contract remains authority.
History uses SDK scanner with deployment block config and incremental cached cursor, bounded lookback at confirmation depth. State reads remain authoritative; local references cannot override balances/status/verified hashes. Shared receipts survive empty localStorage/different browser. Recognize existing preset reference hashes; custom human descriptions remain private/browser-local or in the explicitly shared signed envelope.
Add NEXT_PUBLIC_COVA_DEPLOYMENT_BLOCK; map existing verified v1 record as default for that address, local deploy writes its actual block. Current public v1 remains configured until an explicit future v2 deployment. No fake public v2 address.
Use supplied Cova logo.png unchanged in public/brand; minimal reusable logo component, preserve Arya's design ownership. Demo/MockUSDG stay clearly labelled testing fixtures; no claimed public transactions from simulation.

## Required validation
Contract red/green, full baseline, signed happy path, any relayer, tamper each field, signer/nonce/replay/invalidation/expiry/chain/domain/other vault/funds atomic rollback, ERC1271 valid/invalid, fuzz; accounting invariants stay green.
SDK codec/chain validation tests; actual Anvil signed integration with different customer/merchant/relayer, compare SDK digest against onchain digest, 20 reserve ->14 capture ->6 release; package build and npm pack/import smoke.
Browser sign->copy/import->merchant submit->capture->release; rejection, cancellation/invalidation, separate browser receipt recovery, v1 feature gating. Typecheck/lint/production build/all existing tests/official USDG read-only fork.
No deployment now. Report implementation evidence separately from publicly deployed v1 and unfunded live E2E.
