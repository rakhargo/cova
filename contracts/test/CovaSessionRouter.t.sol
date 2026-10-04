// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {CovaVault} from "../src/CovaVault.sol";
import {CovaSessionRouter} from "../src/CovaSessionRouter.sol";
import {MockUSDG} from "./fixtures/MockUSDG.sol";

contract CovaSessionRouterTest is Test {
    MockUSDG internal token;
    CovaVault internal vault;
    CovaSessionRouter internal router;
    uint256 internal customerKey = 0xC057;
    uint256 internal providerKey = 0xBEEF;
    address internal customer;
    address internal provider;

    function setUp() public {
        vm.warp(1_000_000);
        customer = vm.addr(customerKey);
        provider = vm.addr(providerKey);
        token = new MockUSDG();
        vault = new CovaVault(address(token));
        router = new CovaSessionRouter(address(vault), address(token));
        token.mint(customer, 100e6);
        vm.startPrank(customer);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(100e6);
        vm.stopPrank();
    }

    function testSignedQuoteStartsAndReservesTwentyUSDG() public {
        CovaSessionRouter.SessionQuote memory quote = _quote();
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        vm.recordLogs();
        vm.prank(makeAddr("relayer"));
        bytes32 holdId = router.startSession(quote, providerSig, auth, customerSig);
        assertTrue(holdId != bytes32(0));
        assertEq(vault.availableBalance(customer), 80e6);
        assertEq(vault.heldBalance(customer), 20e6);
        assertEq(vault.nonces(customer), 1);
        assertEq(router.activeSessionCount(customer), 1);
        (CovaSessionRouter.SessionStatus status,,,,,,,,,,,) = router.sessions(quote.sessionId);
        assertEq(uint8(status), uint8(CovaSessionRouter.SessionStatus.Active));
        (, address holdMerchant,,,,,) = vault.holds(holdId);
        assertEq(holdMerchant, address(router));
    }

    function testQuoteTamperingAndReplayAreRejected() public {
        CovaSessionRouter.SessionQuote memory quote = _quote();
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        quote.provider = vm.addr(0xBAD);
        vm.expectRevert(CovaSessionRouter.InvalidProviderSignature.selector);
        router.startSession(quote, providerSig, auth, customerSig);
        quote.provider = provider;
        router.startSession(quote, providerSig, auth, customerSig);
        vm.expectRevert(CovaSessionRouter.SessionAlreadyExists.selector);
        router.startSession(quote, providerSig, auth, customerSig);
    }

    function testStopBillsFloorAndReturnsRemainder() public {
        CovaSessionRouter.SessionQuote memory quote = _quote();
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        router.startSession(quote, providerSig, auth, customerSig);
        vm.warp(block.timestamp + 28 minutes);
        vm.prank(customer);
        router.stopSession(quote.sessionId);
        assertEq(token.balanceOf(provider), 14e6);
        assertEq(vault.availableBalance(customer), 86e6);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(router.activeSessionCount(customer), 0);
    }

    function testOneSecondChargeRoundsDownAndZeroChargeReleases() public {
        CovaSessionRouter.SessionQuote memory quote = _quote();
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        router.startSession(quote, providerSig, auth, customerSig);
        vm.warp(block.timestamp + 1);
        vm.prank(provider);
        router.stopSession(quote.sessionId);
        (,,,,,,, uint128 charged, uint128 returnedAmount,,,) = router.sessions(quote.sessionId);
        assertEq(charged, 8_333);
        assertEq(returnedAmount, 20e6 - 8_333);
        assertEq(token.balanceOf(provider), 8_333);
        assertEq(vault.availableBalance(customer), 100e6 - 8_333);

        quote.sessionId = keccak256("zero session");
        (providerSig, auth, customerSig) = _signStart(quote);
        auth.nonce = 1;
        customerSig = _signDigest(customerKey, vault.authorizationDigest(auth));
        router.startSession(quote, providerSig, auth, customerSig);
        vm.prank(customer);
        router.stopSession(quote.sessionId);
        assertEq(token.balanceOf(provider), 8_333);
        assertEq(vault.availableBalance(customer), 100e6 - 8_333);
    }

    function testWrongReferenceAndCustomerNonceReplayRollback() public {
        CovaSessionRouter.SessionQuote memory quote = _quote();
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        auth.referenceId = bytes32(uint256(1));
        vm.expectRevert(CovaSessionRouter.InvalidAuthorization.selector);
        router.startSession(quote, providerSig, auth, customerSig);
        auth.referenceId = router.quoteDigest(quote);
        auth.nonce = 1;
        customerSig = _signDigest(customerKey, vault.authorizationDigest(auth));
        vm.expectRevert(CovaVault.InvalidNonce.selector);
        router.startSession(quote, providerSig, auth, customerSig);
        assertEq(vault.nonces(customer), 0);
        assertEq(vault.availableBalance(customer), 100e6);
    }

    function testSignedStopIsScopedToCustomerSessionAndDeadline() public {
        CovaSessionRouter.SessionQuote memory quote = _quote();
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        router.startSession(quote, providerSig, auth, customerSig);
        CovaSessionRouter.SessionQuote memory another = _quote();
        another.sessionId = keccak256("another active session");
        (providerSig, auth, customerSig) = _signStart(another);
        auth.nonce = 1;
        customerSig = _signDigest(customerKey, vault.authorizationDigest(auth));
        router.startSession(another, providerSig, auth, customerSig);
        uint64 validUntil = uint64(block.timestamp + 60);
        bytes memory signedStop = _signDigest(customerKey, _stopDigest(quote.sessionId, validUntil));

        vm.expectRevert(CovaSessionRouter.InvalidStopSignature.selector);
        router.stopSessionWithSignature(another.sessionId, validUntil, signedStop);
        vm.expectRevert(CovaSessionRouter.InvalidStopSignature.selector);
        router.stopSessionWithSignature(
            quote.sessionId, validUntil, _signDigest(providerKey, _stopDigest(quote.sessionId, validUntil))
        );

        vm.prank(makeAddr("relayer"));
        router.stopSessionWithSignature(quote.sessionId, validUntil, signedStop);
        assertEq(token.balanceOf(provider), 0);
        assertEq(vault.availableBalance(customer), 80e6);
        assertEq(router.activeSessionCount(customer), 1);

        quote.sessionId = keccak256("expired signature session");
        quote.startBy = uint64(block.timestamp + 300);
        quote.holdExpiresAt = uint64(uint256(quote.startBy) + quote.maxDurationSeconds + 1);
        (providerSig, auth, customerSig) = _signStart(quote);
        auth.nonce = 2;
        customerSig = _signDigest(customerKey, vault.authorizationDigest(auth));
        router.startSession(quote, providerSig, auth, customerSig);
        validUntil = uint64(block.timestamp + 10);
        signedStop = _signDigest(customerKey, _stopDigest(quote.sessionId, validUntil));
        vm.warp(validUntil + 1);
        vm.expectRevert(CovaSessionRouter.StopSignatureExpired.selector);
        router.stopSessionWithSignature(quote.sessionId, validUntil, signedStop);
    }

    function testMaxDurationAndExpiryFinalizersRejectEarlyCalls() public {
        CovaSessionRouter.SessionQuote memory quote = _quote();
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        router.startSession(quote, providerSig, auth, customerSig);
        vm.expectRevert(CovaSessionRouter.MaxDurationNotReached.selector);
        router.settleAtMaxDuration(quote.sessionId);
        vm.expectRevert(CovaSessionRouter.HoldNotExpired.selector);
        router.expireSession(quote.sessionId);
        assertEq(vault.heldBalance(customer), 20e6);
        assertEq(router.activeSessionCount(customer), 1);
    }

    function testFuzzDurationSettlementNeverExceedsQuote(
        uint32 rawDuration,
        uint32 rawElapsed,
        uint96 rawRate
    ) public {
        uint32 duration = uint32(bound(rawDuration, 60, 3600));
        uint32 elapsed = uint32(bound(rawElapsed, 0, duration));
        uint128 rate = uint128(bound(rawRate, 1, 1_000_000));
        uint128 cap = uint128(uint256(rate) * duration / 60);
        if (cap == 0) cap = 1;
        CovaSessionRouter.SessionQuote memory quote = _quote();
        quote.sessionId = keccak256(abi.encode("fuzz", rawDuration, rawElapsed, rawRate));
        quote.ratePerMinute = rate;
        quote.maxAmount = cap;
        quote.maxDurationSeconds = duration;
        quote.startBy = uint64(block.timestamp + 300);
        quote.holdExpiresAt = uint64(uint256(quote.startBy) + duration + 1);
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        router.startSession(quote, providerSig, auth, customerSig);
        vm.warp(block.timestamp + elapsed);
        vm.prank(customer);
        router.stopSession(quote.sessionId);
        uint256 expected = uint256(rate) * elapsed / 60;
        assertLe(expected, cap);
        assertEq(token.balanceOf(provider), expected);
        assertEq(vault.availableBalance(customer), 100e6 - expected);
        (,,,,,,, uint128 charged, uint128 returnedAmount,,,) = router.sessions(quote.sessionId);
        assertEq(charged, expected);
        assertEq(returnedAmount, uint256(cap) - expected);
    }

    function testPermissionlessCapFinalizationAndExpiredZeroCharge() public {
        CovaSessionRouter.SessionQuote memory quote = _quote();
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        router.startSession(quote, providerSig, auth, customerSig);
        vm.warp(block.timestamp + quote.maxDurationSeconds);
        router.settleAtMaxDuration(quote.sessionId);
        assertEq(token.balanceOf(provider), 20e6);
        assertEq(vault.availableBalance(customer), 80e6);

        quote.sessionId = keccak256("expired session");
        quote.startBy = uint64(block.timestamp + 30);
        quote.holdExpiresAt = uint64(uint256(quote.startBy) + quote.maxDurationSeconds + 1);
        (providerSig, auth, customerSig) = _signStart(quote);
        auth.nonce = 1;
        customerSig = _signDigest(customerKey, vault.authorizationDigest(auth));
        router.startSession(quote, providerSig, auth, customerSig);
        vm.warp(quote.holdExpiresAt);
        router.expireSession(quote.sessionId);
        assertEq(token.balanceOf(provider), 20e6);
        assertEq(vault.availableBalance(customer), 80e6);
    }

    function testExternalVaultExpiredReleaseStillAllowsRouterCleanup() public {
        CovaSessionRouter.SessionQuote memory quote = _quote();
        (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig) =
            _signStart(quote);
        bytes32 holdId = router.startSession(quote, providerSig, auth, customerSig);
        vm.warp(quote.holdExpiresAt);
        vm.prank(makeAddr("vault-cleanup-keeper"));
        vault.releaseExpired(holdId);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(router.activeSessionCount(customer), 1);

        vm.prank(makeAddr("router-cleanup-keeper"));
        router.expireSession(quote.sessionId);
        (CovaSessionRouter.SessionStatus status,,,,,,,, uint128 returnedAmount,,,) =
            router.sessions(quote.sessionId);
        assertEq(uint8(status), uint8(CovaSessionRouter.SessionStatus.Expired));
        assertEq(returnedAmount, 20e6);
        assertEq(router.activeSessionCount(customer), 0);
        assertEq(vault.availableBalance(customer), 100e6);

        vm.expectRevert(CovaSessionRouter.SessionNotActive.selector);
        router.expireSession(quote.sessionId);
    }

    function _quote() internal view returns (CovaSessionRouter.SessionQuote memory) {
        return CovaSessionRouter.SessionQuote({
            sessionId: keccak256("session-1"),
            customer: customer,
            provider: provider,
            serviceId: keccak256("service"),
            ratePerMinute: 500_000,
            maxAmount: 20e6,
            maxDurationSeconds: 2400,
            startBy: uint64(block.timestamp + 5 minutes),
            holdExpiresAt: uint64(block.timestamp + 2 hours)
        });
    }

    function _signStart(CovaSessionRouter.SessionQuote memory quote)
        internal
        returns (bytes memory providerSig, CovaVault.HoldAuthorization memory auth, bytes memory customerSig)
    {
        bytes32 qd = router.quoteDigest(quote);
        providerSig = _signDigest(providerKey, qd);
        auth = CovaVault.HoldAuthorization({
            customer: customer,
            merchant: address(router),
            maxAmount: quote.maxAmount,
            expiresAt: quote.holdExpiresAt,
            nonce: vault.nonces(customer),
            referenceId: qd
        });
        customerSig = _signDigest(customerKey, vault.authorizationDigest(auth));
    }

    function _signDigest(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _stopDigest(bytes32 sessionId, uint64 validUntil) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("CovaSessionRouter"),
                keccak256("1"),
                block.chainid,
                address(router)
            )
        );
        bytes32 body = keccak256(
            abi.encode(keccak256("SessionStop(bytes32 sessionId,uint64 validUntil)"), sessionId, validUntil)
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }
}
