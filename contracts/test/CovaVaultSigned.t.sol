// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {CovaVault} from "../src/CovaVault.sol";
import {MockUSDG} from "./fixtures/MockUSDG.sol";
import {SignatureWallet} from "./fixtures/SignatureWallet.sol";
import {Vm} from "forge-std/Vm.sol";

/// @dev Independent consumer interface permits behavioral red tests before the implementation exists.
interface ISignedVault {
    struct HoldAuthorization {
        address customer;
        address merchant;
        uint128 maxAmount;
        uint64 expiresAt;
        uint256 nonce;
        bytes32 referenceId;
    }
    function version() external view returns (uint256);
    function nonces(address customer) external view returns (uint256);
    function authorizationDigest(HoldAuthorization calldata authorization) external view returns (bytes32);
    function authorizeHold(HoldAuthorization calldata authorization, bytes calldata signature)
        external
        returns (bytes32);
    function invalidateAuthorizations(uint256 newNonce) external;
}

contract CovaVaultSignedTest is Test {
    MockUSDG internal token;
    CovaVault internal vault;
    uint256 internal constant CUSTOMER_KEY = 0xC057;
    address internal customer;
    address internal merchant = makeAddr("signed merchant");
    address internal relayer = makeAddr("public relayer");
    bytes32 internal constant REFERENCE = keccak256("signed court booking");
    bytes32 internal constant TYPE_HASH = keccak256(
        "HoldAuthorization(address customer,address merchant,uint128 maxAmount,uint64 expiresAt,uint256 nonce,bytes32 referenceId)"
    );

    function setUp() public {
        vm.warp(1_000_000);
        customer = vm.addr(CUSTOMER_KEY);
        token = new MockUSDG();
        vault = new CovaVault(address(token));
        token.mint(customer, 100e6);
        vm.startPrank(customer);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(100e6);
        vm.stopPrank();
    }

    /// @dev Low-level entry makes the missing feature fail at the behavior assertion before its API exists.
    function testSignedAuthorizationReservesCustomerFundsFromPublicRelayer() public {
        uint64 expiry = 1_003_600;
        bytes32 structHash = keccak256(
            abi.encode(TYPE_HASH, customer, merchant, uint128(20e6), expiry, uint256(0), REFERENCE)
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("CovaVault"),
                keccak256("2"),
                block.chainid,
                address(vault)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CUSTOMER_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        vm.prank(relayer);
        (bool success, bytes memory result) = address(vault)
            .call(
                abi.encodeWithSignature(
                    "authorizeHold((address,address,uint128,uint64,uint256,bytes32),bytes)",
                    customer,
                    merchant,
                    uint128(20e6),
                    expiry,
                    uint256(0),
                    REFERENCE,
                    signature
                )
            );
        assertTrue(success, "valid customer signature must create a hold via any relayer");
        bytes32 id = abi.decode(result, (bytes32));
        (address owner, address assigned, uint128 authorized,,,,) = vault.holds(id);
        assertEq(owner, customer);
        assertEq(assigned, merchant);
        assertEq(authorized, 20e6);
        assertEq(vault.availableBalance(customer), 80e6);
        assertEq(vault.heldBalance(customer), 20e6);
        assertEq(vault.availableBalance(relayer), 0);
        assertEq(vault.heldBalance(relayer), 0);
        assertEq(vault.totalLiability(), 100e6);
    }

    function testDigestMatchesIndependentEIP712Encoding() public view {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        assertEq(_signed().version(), 2);
        assertEq(_signed().nonces(customer), 0);
        assertEq(
            _signed().authorizationDigest(authorization),
            _digest(authorization, "CovaVault", "2", block.chainid, address(vault))
        );
    }

    function testSigningAloneDoesNotReserveFunds() public view {
        _sign(_authorization(), CUSTOMER_KEY);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(_signed().nonces(customer), 0);
        assertEq(vault.getCustomerHoldIds(customer, 0, 100).length, 0);
    }

    function testSignedHoldPreservesReceiptAndIndexes() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        vm.recordLogs();
        vm.prank(relayer);
        bytes32 id = _signed().authorizeHold(authorization, signature);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], keccak256("HoldCreated(bytes32,address,address,uint256,uint64,bytes32)"));
        assertEq(logs[0].topics[1], id);
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(customer))));
        assertEq(logs[0].topics[3], bytes32(uint256(uint160(merchant))));
        assertEq(logs[0].data, abi.encode(uint256(20e6), uint64(1_003_600), REFERENCE));
        assertEq(_signed().nonces(customer), 1);
        assertEq(_signed().nonces(relayer), 0);
        assertEq(vault.getCustomerHoldIds(customer, 0, 100)[0], id);
        assertEq(vault.getMerchantHoldIds(merchant, 0, 100)[0], id);
        assertEq(vault.getCustomerHoldIds(relayer, 0, 100).length, 0);
    }

    function testSignedHoldSettlesOnlyToAssignedMerchant() public {
        bytes32 id = _submit(_authorization());
        vm.expectRevert(CovaVault.UnauthorizedMerchant.selector);
        vm.prank(relayer);
        vault.capture(id, 1);
        vm.expectRevert(CovaVault.UnauthorizedMerchant.selector);
        vm.prank(customer);
        vault.release(id);
        vm.startPrank(merchant);
        vault.capture(id, 14e6);
        vault.release(id);
        vm.stopPrank();
        assertEq(token.balanceOf(merchant), 14e6);
        assertEq(vault.availableBalance(customer), 86e6);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(vault.totalLiability(), 86e6);
        assertEq(_signed().nonces(customer), 1);
    }

    function testReplayRejectedAfterSubmissionAndRelease() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        bytes32 id = _signed().authorizeHold(authorization, signature);
        _expectRejected(authorization, signature, "InvalidNonce()");
        vm.prank(merchant);
        vault.release(id);
        _expectRejected(authorization, signature, "InvalidNonce()");
        assertEq(_signed().nonces(customer), 1);
        assertEq(vault.getCustomerHoldIds(customer, 0, 100).length, 1);
    }

    function testCustomerFieldTamperingRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        authorization.customer = vm.addr(0xBAD);
        _expectRejected(authorization, signature, "InvalidSignature()");
    }

    function testMerchantFieldTamperingRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        authorization.merchant = relayer;
        _expectRejected(authorization, signature, "InvalidSignature()");
    }

    function testAmountFieldTamperingRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        authorization.maxAmount += 1;
        _expectRejected(authorization, signature, "InvalidSignature()");
    }

    function testExpiryFieldTamperingRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        authorization.expiresAt += 1;
        _expectRejected(authorization, signature, "InvalidSignature()");
    }

    function testNonceFieldTamperingRejectedEvenAtCurrentNonce() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        vm.prank(customer);
        _signed().invalidateAuthorizations(1);
        authorization.nonce = 1;
        _expectRejected(authorization, signature, "InvalidSignature()");
        assertEq(_signed().nonces(customer), 1);
    }

    function testReferenceFieldTamperingRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        authorization.referenceId = bytes32(uint256(1));
        _expectRejected(authorization, signature, "InvalidSignature()");
    }

    function testWrongSignerRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        _expectRejected(authorization, _sign(authorization, 0xBAD), "InvalidSignature()");
    }

    function testMalformedSignaturesRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        _expectRejected(authorization, hex"", "InvalidSignature()");
        _expectRejected(authorization, hex"010203", "InvalidSignature()");
        _expectRejected(authorization, new bytes(65), "InvalidSignature()");
    }

    function testHighSSignatureRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes32 digest = _digest(authorization, "CovaVault", "2", block.chainid, address(vault));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CUSTOMER_KEY, digest);
        uint256 curveOrder = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory malleable =
            abi.encodePacked(r, bytes32(curveOrder - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        _expectRejected(authorization, malleable, "InvalidSignature()");
    }

    function testZeroCustomerRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.customer = address(0);
        _expectRejected(authorization, hex"", "InvalidCustomer()");
    }

    function testWrongChainRejectedAndDomainTracksChainChange() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        bytes32 digestBefore = _signed().authorizationDigest(authorization);
        vm.chainId(block.chainid + 1);
        assertTrue(digestBefore != _signed().authorizationDigest(authorization));
        _expectRejected(authorization, signature, "InvalidSignature()");
        _submit(authorization);
    }

    function testWrongVaultRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        CovaVault other = new CovaVault(address(token));
        vm.expectRevert(_error("InvalidSignature()"));
        ISignedVault(address(other)).authorizeHold(authorization, signature);
        assertEq(ISignedVault(address(other)).nonces(customer), 0);
        assertEq(other.heldBalance(customer), 0);
    }

    function testWrongDomainNameAndVersionRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes32 wrongName = _digest(authorization, "OtherVault", "2", block.chainid, address(vault));
        bytes32 wrongVersion = _digest(authorization, "CovaVault", "1", block.chainid, address(vault));
        _expectRejected(authorization, _signDigest(wrongName, CUSTOMER_KEY), "InvalidSignature()");
        _expectRejected(authorization, _signDigest(wrongVersion, CUSTOMER_KEY), "InvalidSignature()");
    }

    function testFutureNonceRejected() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.nonce = 1;
        _expectRejected(authorization, _sign(authorization, CUSTOMER_KEY), "InvalidNonce()");
        assertEq(_signed().nonces(customer), 0);
    }

    function testInvalidationCancelsPendingSignatureAndOnlyAffectsCaller() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        vm.prank(relayer);
        _signed().invalidateAuthorizations(50);
        assertEq(_signed().nonces(customer), 0);
        assertEq(_signed().nonces(relayer), 50);
        vm.recordLogs();
        vm.prank(customer);
        _signed().invalidateAuthorizations(7);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], keccak256("AuthorizationsInvalidated(address,uint256)"));
        assertEq(logs[0].topics[1], bytes32(uint256(uint160(customer))));
        assertEq(logs[0].data, abi.encode(uint256(7)));
        _expectRejected(authorization, signature, "InvalidNonce()");
        authorization.nonce = 7;
        _submit(authorization);
        assertEq(_signed().nonces(customer), 8);
    }

    function testInvalidationDoesNotCancelActiveHold() public {
        bytes32 id = _submit(_authorization());
        vm.prank(customer);
        _signed().invalidateAuthorizations(10);
        (,,,,, CovaVault.HoldStatus status,) = vault.holds(id);
        assertEq(uint8(status), uint8(CovaVault.HoldStatus.Active));
        assertEq(vault.heldBalance(customer), 20e6);
        vm.prank(merchant);
        vault.capture(id, 20e6);
        assertEq(token.balanceOf(merchant), 20e6);
    }

    function testInvalidationRequiresStrictIncreaseAndRejectsMaximum() public {
        vm.startPrank(customer);
        vm.expectRevert(_error("InvalidNewNonce()"));
        _signed().invalidateAuthorizations(0);
        _signed().invalidateAuthorizations(7);
        vm.expectRevert(_error("InvalidNewNonce()"));
        _signed().invalidateAuthorizations(7);
        vm.expectRevert(_error("InvalidNewNonce()"));
        _signed().invalidateAuthorizations(6);
        vm.expectRevert(_error("InvalidNewNonce()"));
        _signed().invalidateAuthorizations(type(uint256).max);
        vm.stopPrank();
        assertEq(_signed().nonces(customer), 7);
    }

    function testMaximumNonceNeverWrapsOrReservesOnOverflow() public {
        vm.prank(customer);
        _signed().invalidateAuthorizations(type(uint256).max - 1);
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.nonce = type(uint256).max - 1;
        _submit(authorization);
        assertEq(_signed().nonces(customer), type(uint256).max);
        authorization.nonce = type(uint256).max;
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        _signed().authorizeHold(authorization, signature);
        assertEq(_signed().nonces(customer), type(uint256).max);
        assertEq(vault.availableBalance(customer), 80e6);
        assertEq(vault.heldBalance(customer), 20e6);
        assertEq(vault.getCustomerHoldIds(customer, 0, 100).length, 1);
    }

    function testDirectHoldsDoNotConsumeSignedNonceAndIdsRemainUnique() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        vm.prank(customer);
        bytes32 directId = vault.createHold(merchant, 20e6, authorization.expiresAt, REFERENCE);
        assertEq(_signed().nonces(customer), 0);
        bytes32 signedId = _signed().authorizeHold(authorization, signature);
        assertTrue(directId != signedId);
        assertEq(_signed().nonces(customer), 1);
        assertEq(vault.heldBalance(customer), 40e6);
        assertEq(vault.getCustomerHoldIds(customer, 0, 100).length, 2);
    }

    function testExpiredAuthorizationRejectedAtAndAfterExpiry() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        vm.warp(authorization.expiresAt);
        _expectRejected(authorization, signature, "InvalidExpiry()");
        vm.warp(uint256(authorization.expiresAt) + 1);
        _expectRejected(authorization, signature, "InvalidExpiry()");
        assertEq(_signed().nonces(customer), 0);
    }

    function testInsufficientFundsRollsBackNonceAndMayRetryAfterFunding() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.maxAmount = 101e6;
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        _expectRejected(authorization, signature, "InsufficientAvailableBalance()");
        assertEq(_signed().nonces(customer), 0);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(vault.getCustomerHoldIds(customer, 0, 100).length, 0);
        token.mint(customer, 1e6);
        vm.prank(customer);
        vault.deposit(1e6);
        _signed().authorizeHold(authorization, signature);
        assertEq(_signed().nonces(customer), 1);
        assertEq(vault.heldBalance(customer), 101e6);
    }

    function testSignedValidationUsesExistingMerchantAndAmountRules() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.merchant = address(0);
        _expectRejected(authorization, _sign(authorization, CUSTOMER_KEY), "InvalidMerchant()");
        authorization.merchant = address(vault);
        _expectRejected(authorization, _sign(authorization, CUSTOMER_KEY), "InvalidMerchant()");
        authorization.merchant = merchant;
        authorization.maxAmount = 0;
        _expectRejected(authorization, _sign(authorization, CUSTOMER_KEY), "InvalidAmount()");
        assertEq(_signed().nonces(customer), 0);
    }

    function testMaximumSignedAmountSupported() public {
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.maxAmount = type(uint128).max;
        token.mint(customer, type(uint128).max);
        vm.prank(customer);
        vault.deposit(type(uint128).max);
        _submit(authorization);
        assertEq(vault.heldBalance(customer), type(uint128).max);
        assertEq(vault.availableBalance(customer), 100e6);
    }

    function testERC1271CustomerSignatureReservesWalletFunds() public {
        SignatureWallet wallet = _wallet();
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.customer = address(wallet);
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        vm.prank(relayer);
        bytes32 id = _signed().authorizeHold(authorization, signature);
        (address owner,,,,,,) = vault.holds(id);
        assertEq(owner, address(wallet));
        assertEq(vault.availableBalance(address(wallet)), 80e6);
        assertEq(vault.heldBalance(address(wallet)), 20e6);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(_signed().nonces(address(wallet)), 1);
    }

    function testERC1271WrongSignerRevokedRevertingAndShortResponsesRejected() public {
        SignatureWallet wallet = _wallet();
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.customer = address(wallet);
        _expectRejected(authorization, _sign(authorization, 0xBAD), "InvalidSignature()");
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        for (uint8 mode = 1; mode <= 3; ++mode) {
            wallet.configure(mode, address(0), hex"");
            _expectRejected(authorization, signature, "InvalidSignature()");
        }
        assertEq(_signed().nonces(address(wallet)), 0);
        assertEq(vault.heldBalance(address(wallet)), 0);
        wallet.configure(0, address(0), hex"");
        _signed().authorizeHold(authorization, signature);
    }

    function testERC1271ValidationCannotReenterNewMutators() public {
        SignatureWallet wallet = _wallet();
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.customer = address(wallet);
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        wallet.configure(
            4, address(vault), abi.encodeCall(ISignedVault.invalidateAuthorizations, (uint256(99)))
        );
        _signed().authorizeHold(authorization, signature);
        authorization.nonce = 1;
        signature = _sign(authorization, CUSTOMER_KEY);
        wallet.configure(
            4, address(vault), abi.encodeCall(ISignedVault.authorizeHold, (authorization, signature))
        );
        _signed().authorizeHold(authorization, signature);
        assertEq(_signed().nonces(address(wallet)), 2);
        assertEq(vault.heldBalance(address(wallet)), 40e6);
    }

    function testFuzzSignedLifecycleConservesFunds(
        uint128 rawAmount,
        uint128 rawCapture,
        uint32 duration,
        uint256 nextNonce
    ) public {
        nextNonce = bound(nextNonce, 1, type(uint256).max - 1);
        vm.prank(customer);
        _signed().invalidateAuthorizations(nextNonce);
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        authorization.nonce = nextNonce;
        authorization.maxAmount = uint128(bound(rawAmount, 1, 100e6));
        authorization.expiresAt = uint64(block.timestamp + bound(duration, 1, 365 days));
        uint256 captured = bound(rawCapture, 0, authorization.maxAmount);
        bytes32 id = _submit(authorization);
        vm.startPrank(merchant);
        if (captured != 0) vault.capture(id, captured);
        if (captured < authorization.maxAmount) vault.release(id);
        vm.stopPrank();
        assertEq(_signed().nonces(customer), nextNonce + 1);
        assertEq(vault.availableBalance(customer), 100e6 - captured);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(token.balanceOf(merchant), captured);
        assertEq(vault.totalLiability(), 100e6 - captured);
        assertEq(token.balanceOf(address(vault)), vault.totalLiability());
    }

    function testFuzzReferenceTamperingCannotReserve(bytes32 alteredReference) public {
        vm.assume(alteredReference != REFERENCE);
        ISignedVault.HoldAuthorization memory authorization = _authorization();
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        authorization.referenceId = alteredReference;
        _expectRejected(authorization, signature, "InvalidSignature()");
        assertEq(_signed().nonces(customer), 0);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(vault.heldBalance(customer), 0);
    }

    function _signed() internal view returns (ISignedVault) {
        return ISignedVault(address(vault));
    }

    function _authorization() internal view returns (ISignedVault.HoldAuthorization memory) {
        return ISignedVault.HoldAuthorization(customer, merchant, 20e6, 1_003_600, 0, REFERENCE);
    }

    function _submit(ISignedVault.HoldAuthorization memory authorization) internal returns (bytes32) {
        bytes memory signature = _sign(authorization, CUSTOMER_KEY);
        vm.prank(relayer);
        return _signed().authorizeHold(authorization, signature);
    }

    function _sign(ISignedVault.HoldAuthorization memory authorization, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        return _signDigest(_digest(authorization, "CovaVault", "2", block.chainid, address(vault)), key);
    }

    function _signDigest(bytes32 digest, uint256 key) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _digest(
        ISignedVault.HoldAuthorization memory authorization,
        string memory name,
        string memory domainVersion,
        uint256 chainId,
        address target
    ) internal pure returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(name)),
                keccak256(bytes(domainVersion)),
                chainId,
                target
            )
        );
        bytes32 message = keccak256(
            abi.encode(
                TYPE_HASH,
                authorization.customer,
                authorization.merchant,
                authorization.maxAmount,
                authorization.expiresAt,
                authorization.nonce,
                authorization.referenceId
            )
        );
        return keccak256(abi.encodePacked(hex"1901", domain, message));
    }

    function _expectRejected(
        ISignedVault.HoldAuthorization memory authorization,
        bytes memory signature,
        string memory reason
    ) internal {
        vm.expectRevert(_error(reason));
        vm.prank(relayer);
        _signed().authorizeHold(authorization, signature);
    }

    function _wallet() internal returns (SignatureWallet wallet) {
        wallet = new SignatureWallet(customer);
        token.mint(address(wallet), 100e6);
        vm.startPrank(address(wallet));
        token.approve(address(vault), 100e6);
        vault.deposit(100e6);
        vm.stopPrank();
    }

    function _error(string memory signature) internal pure returns (bytes4) {
        return bytes4(keccak256(bytes(signature)));
    }
}
