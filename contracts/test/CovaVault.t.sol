// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CovaVault} from "../src/CovaVault.sol";
import {MockUSDG} from "./fixtures/MockUSDG.sol";

contract CovaVaultTest is Test {
    MockUSDG internal token;
    CovaVault internal vault;
    address internal customer = makeAddr("customer");
    address internal merchant = makeAddr("merchant");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant REFERENCE = keccak256("court booking");
    event Deposited(address indexed customer, uint256 amount);
    event Withdrawn(address indexed customer, uint256 amount);
    event HoldCaptured(bytes32 indexed holdId, uint256 amount);
    event HoldReleased(bytes32 indexed holdId, uint256 amount);

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockUSDG();
        vault = new CovaVault(address(token));
        token.mint(customer, 100e6);
        vm.prank(customer);
        token.approve(address(vault), type(uint256).max);
    }

    function testConstructorRejectsZeroToken() public {
        vm.expectRevert(_error("InvalidToken()"));
        new CovaVault(address(0));
    }

    function testConstructorRejectsAddressWithoutCode() public {
        vm.expectRevert(_error("InvalidToken()"));
        new CovaVault(customer);
    }

    function testDepositCreditsOnlyTransferredFunds() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit Deposited(customer, 100e6);
        _deposit(100e6);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(vault.totalLiability(), 100e6);
        assertEq(token.balanceOf(address(vault)), 100e6);
        assertEq(token.balanceOf(customer), 0);
    }

    function testDepositRejectsZero() public {
        vm.expectRevert(_error("InvalidAmount()"));
        vm.prank(customer);
        vault.deposit(0);
    }

    function testDepositWithoutApprovalCannotCreateCredit() public {
        token.mint(stranger, 1e6);
        vm.expectRevert();
        vm.prank(stranger);
        vault.deposit(1e6);
        assertEq(vault.availableBalance(stranger), 0);
        assertEq(vault.totalLiability(), 0);
    }

    function testDonationsDoNotCreateCustomerCredit() public {
        token.mint(address(vault), 10e6);
        _deposit(20e6);
        assertEq(vault.availableBalance(customer), 20e6);
        assertEq(vault.totalLiability(), 20e6);
        assertEq(token.balanceOf(address(vault)), 30e6);
    }

    function testWithdrawAvailableFunds() public {
        _deposit(100e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit Withdrawn(customer, 25e6);
        vm.prank(customer);
        vault.withdraw(25e6);
        assertEq(vault.availableBalance(customer), 75e6);
        assertEq(vault.totalLiability(), 75e6);
        assertEq(token.balanceOf(customer), 25e6);
        assertEq(token.balanceOf(address(vault)), 75e6);
    }

    function testWithdrawRejectsZero() public {
        vm.expectRevert(_error("InvalidAmount()"));
        vm.prank(customer);
        vault.withdraw(0);
    }

    function testWithdrawCannotUseReservedFunds() public {
        _hold(20e6);
        vm.expectRevert(_error("InsufficientAvailableBalance()"));
        vm.prank(customer);
        vault.withdraw(81e6);
        assertEq(vault.availableBalance(customer), 80e6);
        assertEq(vault.heldBalance(customer), 20e6);
        assertEq(vault.totalLiability(), 100e6);
    }

    function testWithdrawCannotUseAnotherCustomersFunds() public {
        _deposit(100e6);
        vm.expectRevert(_error("InsufficientAvailableBalance()"));
        vm.prank(stranger);
        vault.withdraw(1);
    }

    function testCreateHoldReservesAndIndexesAuthorization() public {
        bytes32 id = _hold(20e6);
        (
            address c,
            address m,
            uint128 authorized,
            uint128 captured,
            uint64 expiry,
            CovaVault.HoldStatus status,
            bytes32 ref
        ) = vault.holds(id);
        assertTrue(id != bytes32(0));
        assertEq(c, customer);
        assertEq(m, merchant);
        assertEq(authorized, 20e6);
        assertEq(captured, 0);
        assertEq(expiry, 1_003_600);
        assertEq(uint8(status), 1);
        assertEq(ref, REFERENCE);
        assertEq(vault.availableBalance(customer), 80e6);
        assertEq(vault.heldBalance(customer), 20e6);
        assertEq(vault.totalLiability(), 100e6);
        bytes32[] memory customerIds = vault.getCustomerHoldIds(customer, 0, 100);
        bytes32[] memory merchantIds = vault.getMerchantHoldIds(merchant, 0, 100);
        assertEq(customerIds.length, 1);
        assertEq(customerIds[0], id);
        assertEq(merchantIds[0], id);
    }

    function testCreateHoldEmitsReceiptEventWithReference() public {
        _deposit(100e6);
        vm.recordLogs();
        vm.prank(customer);
        bytes32 id = vault.createHold(merchant, 20e6, 1_003_600, REFERENCE);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].emitter, address(vault));
        assertEq(logs[0].topics[0], keccak256("HoldCreated(bytes32,address,address,uint256,uint64,bytes32)"));
        assertEq(logs[0].topics[1], id);
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(customer))));
        assertEq(logs[0].topics[3], bytes32(uint256(uint160(merchant))));
        assertEq(logs[0].data, abi.encode(uint256(20e6), uint64(1_003_600), REFERENCE));
    }

    function testCreateHoldRejectsZeroAmount() public {
        _expectCreateRevert(merchant, 0, 1_003_600, "InvalidAmount()");
    }

    function testCreateHoldRejectsAmountAboveUint128() public {
        _expectCreateRevert(merchant, uint256(type(uint128).max) + 1, 1_003_600, "AmountTooLarge()");
    }

    function testCreateHoldAcceptsMaximumUint128() public {
        uint256 amount = type(uint128).max;
        token.mint(customer, amount);
        _deposit(amount);
        vm.prank(customer);
        bytes32 id = vault.createHold(merchant, amount, 1_003_600, bytes32(0));
        (,, uint128 authorized,,,,) = vault.holds(id);
        assertEq(authorized, amount);
        assertEq(vault.heldBalance(customer), amount);
    }

    function testCreateHoldRejectsZeroMerchant() public {
        _expectCreateRevert(address(0), 1, 1_003_600, "InvalidMerchant()");
    }

    function testCreateHoldRejectsVaultAsMerchant() public {
        _expectCreateRevert(address(vault), 1, 1_003_600, "InvalidMerchant()");
    }

    function testCreateHoldRejectsCurrentTimestamp() public {
        _expectCreateRevert(merchant, 1, 1_000_000, "InvalidExpiry()");
    }

    function testCreateHoldRejectsPastTimestamp() public {
        _expectCreateRevert(merchant, 1, 999_999, "InvalidExpiry()");
    }

    function testCreateHoldRejectsInsufficientBalance() public {
        _expectCreateRevert(merchant, 101e6, 1_003_600, "InsufficientAvailableBalance()");
    }

    function testMultipleHoldsUniqueEvenWithSameReference() public {
        _deposit(100e6);
        vm.startPrank(customer);
        bytes32 first = vault.createHold(merchant, 10e6, 1_003_600, REFERENCE);
        bytes32 second = vault.createHold(merchant, 20e6, 1_003_600, REFERENCE);
        vm.stopPrank();
        assertTrue(first != second);
        assertEq(vault.heldBalance(customer), 30e6);
        assertEq(vault.availableBalance(customer), 70e6);
        assertEq(vault.getCustomerHoldIds(customer, 0, 100)[0], first);
        assertEq(vault.getCustomerHoldIds(customer, 0, 100)[1], second);
    }

    function testPartialCaptureSettlesDirectlyToMerchant() public {
        bytes32 id = _hold(20e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoldCaptured(id, 14e6);
        vm.prank(merchant);
        vault.capture(id, 14e6);
        _assertHold(id, 14e6, 1);
        assertEq(vault.availableBalance(customer), 80e6);
        assertEq(vault.heldBalance(customer), 6e6);
        assertEq(vault.totalLiability(), 86e6);
        assertEq(token.balanceOf(merchant), 14e6);
        assertEq(token.balanceOf(address(vault)), 86e6);
    }

    function testFullCaptureClosesHold() public {
        bytes32 id = _hold(20e6);
        vm.prank(merchant);
        vault.capture(id, 20e6);
        _assertHold(id, 20e6, 2);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(vault.totalLiability(), 80e6);
        assertEq(token.balanceOf(merchant), 20e6);
    }

    function testMultiplePartialCapturesCannotExceedAuthorization() public {
        bytes32 id = _hold(20e6);
        vm.startPrank(merchant);
        vault.capture(id, 8e6);
        vault.capture(id, 11e6);
        vm.expectRevert(_error("InvalidAmount()"));
        vault.capture(id, 2e6);
        vault.capture(id, 1e6);
        vm.stopPrank();
        _assertHold(id, 20e6, 2);
        assertEq(token.balanceOf(merchant), 20e6);
    }

    function testCaptureRejectsZero() public {
        bytes32 id = _hold(20e6);
        vm.expectRevert(_error("InvalidAmount()"));
        vm.prank(merchant);
        vault.capture(id, 0);
    }

    function testCaptureRejectsOverAuthorization() public {
        bytes32 id = _hold(20e6);
        vm.expectRevert(_error("InvalidAmount()"));
        vm.prank(merchant);
        vault.capture(id, 21e6);
    }

    function testCaptureRejectsWrongMerchant() public {
        bytes32 id = _hold(20e6);
        vm.expectRevert(_error("UnauthorizedMerchant()"));
        vm.prank(stranger);
        vault.capture(id, 1e6);
    }

    function testCustomerCannotCapture() public {
        bytes32 id = _hold(20e6);
        vm.expectRevert(_error("UnauthorizedMerchant()"));
        vm.prank(customer);
        vault.capture(id, 1e6);
    }

    function testCaptureRejectsUnknownHold() public {
        vm.expectRevert(_error("HoldNotActive()"));
        vm.prank(merchant);
        vault.capture(bytes32(0), 1e6);
    }

    function testCaptureWorksOneSecondBeforeExpiry() public {
        bytes32 id = _hold(20e6);
        vm.warp(1_003_599);
        vm.prank(merchant);
        vault.capture(id, 1e6);
        _assertHold(id, 1e6, 1);
    }

    function testCaptureRejectsExactlyAtExpiry() public {
        bytes32 id = _hold(20e6);
        vm.warp(1_003_600);
        vm.expectRevert(_error("HoldExpired()"));
        vm.prank(merchant);
        vault.capture(id, 1e6);
    }

    function testCaptureRejectsAfterExpiry() public {
        bytes32 id = _hold(20e6);
        vm.warp(1_003_601);
        vm.expectRevert(_error("HoldExpired()"));
        vm.prank(merchant);
        vault.capture(id, 1e6);
    }

    function testFullyCapturedHoldCannotBeReplayed() public {
        bytes32 id = _hold(20e6);
        vm.startPrank(merchant);
        vault.capture(id, 20e6);
        vm.expectRevert(_error("HoldNotActive()"));
        vault.capture(id, 1);
        vm.expectRevert(_error("HoldNotActive()"));
        vault.release(id);
        vm.stopPrank();
    }

    function testMerchantReleaseRestoresAvailable() public {
        bytes32 id = _hold(20e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoldReleased(id, 20e6);
        vm.prank(merchant);
        vault.release(id);
        _assertHold(id, 0, 3);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(vault.totalLiability(), 100e6);
        assertEq(token.balanceOf(address(vault)), 100e6);
    }

    function testReleaseAfterPartialCapturePreservesSettlement() public {
        bytes32 id = _hold(20e6);
        vm.startPrank(merchant);
        vault.capture(id, 14e6);
        vault.release(id);
        vm.stopPrank();
        _assertHold(id, 14e6, 3);
        assertEq(vault.availableBalance(customer), 86e6);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(vault.totalLiability(), 86e6);
        assertEq(token.balanceOf(merchant), 14e6);
    }

    function testCustomerCannotCancelActiveGuarantee() public {
        bytes32 id = _hold(20e6);
        vm.expectRevert(_error("UnauthorizedMerchant()"));
        vm.prank(customer);
        vault.release(id);
    }

    function testStrangerCannotReleaseBeforeExpiry() public {
        bytes32 id = _hold(20e6);
        vm.expectRevert(_error("UnauthorizedMerchant()"));
        vm.prank(stranger);
        vault.release(id);
    }

    function testReleasedHoldCannotBeReused() public {
        bytes32 id = _hold(20e6);
        vm.startPrank(merchant);
        vault.release(id);
        vm.expectRevert(_error("HoldNotActive()"));
        vault.release(id);
        vm.expectRevert(_error("HoldNotActive()"));
        vault.capture(id, 1);
        vm.stopPrank();
        vm.warp(1_003_600);
        vm.expectRevert(_error("HoldNotActive()"));
        vault.releaseExpired(id);
    }

    function testReleaseRejectsUnknownHold() public {
        vm.expectRevert(_error("HoldNotActive()"));
        vm.prank(merchant);
        vault.release(bytes32(0));
    }

    function testExpiredReleaseRejectsUnexpiredHold() public {
        bytes32 id = _hold(20e6);
        vm.warp(1_003_599);
        vm.expectRevert(_error("HoldNotExpired()"));
        vm.prank(customer);
        vault.releaseExpired(id);
    }

    function testAnyoneCanReleaseAtExactExpiry() public {
        bytes32 id = _hold(20e6);
        vm.warp(1_003_600);
        vm.prank(stranger);
        vault.releaseExpired(id);
        _assertHold(id, 0, 3);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(vault.availableBalance(stranger), 0);
        assertEq(vault.heldBalance(customer), 0);
    }

    function testCustomerCanReleaseExpiredPartialRemainder() public {
        bytes32 id = _hold(20e6);
        vm.prank(merchant);
        vault.capture(id, 14e6);
        vm.warp(1_003_700);
        vm.prank(customer);
        vault.releaseExpired(id);
        _assertHold(id, 14e6, 3);
        assertEq(vault.availableBalance(customer), 86e6);
        assertEq(token.balanceOf(merchant), 14e6);
    }

    function testExpiredReleaseRejectsUnknownHold() public {
        vm.expectRevert(_error("HoldNotActive()"));
        vault.releaseExpired(bytes32(0));
    }

    function testDiscoveryPaginatesClosedHistory() public {
        _deposit(100e6);
        bytes32[] memory ids = new bytes32[](5);
        vm.startPrank(customer);
        for (uint256 i; i < 5; ++i) {
            ids[i] = vault.createHold(merchant, 1e6, 1_003_600, bytes32(i));
        }
        vm.stopPrank();
        vm.prank(merchant);
        vault.release(ids[1]);
        bytes32[] memory page = vault.getCustomerHoldIds(customer, 1, 3);
        assertEq(page.length, 3);
        assertEq(page[0], ids[1]);
        assertEq(page[2], ids[3]);
        bytes32[] memory last = vault.getMerchantHoldIds(merchant, 4, 100);
        assertEq(last.length, 1);
        assertEq(last[0], ids[4]);
    }

    function testDiscoveryHandlesEmptyAndOverflowingOffsets() public {
        assertEq(vault.getCustomerHoldIds(customer, 0, 100).length, 0);
        _hold(1e6);
        assertEq(vault.getCustomerHoldIds(customer, 0, 0).length, 0);
        assertEq(vault.getCustomerHoldIds(customer, type(uint256).max, 100).length, 0);
        assertEq(vault.getMerchantHoldIds(merchant, 1, 100).length, 0);
        assertEq(vault.getMerchantHoldIds(stranger, 0, 100).length, 0);
    }

    function testDiscoveryCapsPages() public {
        vm.expectRevert(_error("PageSizeTooLarge()"));
        vault.getCustomerHoldIds(customer, 0, 101);
        vm.expectRevert(_error("PageSizeTooLarge()"));
        vault.getMerchantHoldIds(merchant, 0, type(uint256).max);
    }

    function testFuzzLifecycleConservesFunds(uint128 rawAmount, uint128 rawCapture, uint32 duration) public {
        uint256 amount = bound(rawAmount, 1, 100e6);
        uint256 captured = bound(rawCapture, 0, amount);
        uint64 expiry = uint64(block.timestamp + bound(duration, 1, 365 days));
        _deposit(100e6);
        vm.prank(customer);
        bytes32 id = vault.createHold(merchant, amount, expiry, REFERENCE);
        vm.startPrank(merchant);
        if (captured != 0) vault.capture(id, captured);
        if (captured < amount) vault.release(id);
        vm.stopPrank();
        assertEq(vault.availableBalance(customer), 100e6 - captured);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(token.balanceOf(merchant), captured);
        assertEq(vault.totalLiability(), 100e6 - captured);
        assertEq(token.balanceOf(address(vault)), vault.totalLiability());
        _assertHold(id, captured, captured == amount ? 2 : 3);
    }

    function testFuzzExpiryBoundary(uint32 duration, uint128 rawAmount) public {
        uint64 expiry = uint64(block.timestamp + bound(duration, 1, 365 days));
        uint256 amount = bound(rawAmount, 1, 100e6);
        _deposit(amount);
        vm.prank(customer);
        bytes32 id = vault.createHold(merchant, amount, expiry, bytes32(0));
        vm.warp(expiry);
        vm.expectRevert(_error("HoldExpired()"));
        vm.prank(merchant);
        vault.capture(id, 1);
        vm.prank(stranger);
        vault.releaseExpired(id);
        assertEq(vault.availableBalance(customer), amount);
        assertEq(vault.heldBalance(customer), 0);
    }

    function _deposit(uint256 amount) internal {
        vm.prank(customer);
        vault.deposit(amount);
    }

    function _hold(uint256 amount) internal returns (bytes32) {
        _deposit(100e6);
        vm.prank(customer);
        return vault.createHold(merchant, amount, 1_003_600, REFERENCE);
    }

    function _expectCreateRevert(address m, uint256 amount, uint64 expiry, string memory errorSignature)
        internal
    {
        _deposit(100e6);
        vm.expectRevert(_error(errorSignature));
        vm.prank(customer);
        vault.createHold(m, amount, expiry, REFERENCE);
    }

    function _assertHold(bytes32 id, uint256 expectedCaptured, uint8 expectedStatus) internal view {
        (,,, uint128 captured,, CovaVault.HoldStatus status,) = vault.holds(id);
        assertEq(captured, expectedCaptured);
        assertEq(uint8(status), expectedStatus);
    }

    function _error(string memory signature) internal pure returns (bytes4) {
        return bytes4(keccak256(bytes(signature)));
    }
}
