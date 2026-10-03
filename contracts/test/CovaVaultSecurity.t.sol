// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {CovaVault} from "../src/CovaVault.sol";
import {AdversarialUSDG, NoReturnUSDG} from "./fixtures/AdversarialUSDG.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CovaVaultTokenSecurityTest is Test {
    AdversarialUSDG internal token;
    CovaVault internal vault;
    address internal customer = makeAddr("customer");
    address internal merchant = makeAddr("merchant");

    function setUp() public {
        vm.warp(1_000_000);
        token = new AdversarialUSDG();
        vault = new CovaVault(address(token));
        token.mint(customer, 100e6);
        vm.prank(customer);
        token.approve(address(vault), type(uint256).max);
    }

    function testFeeOnTransferDepositRevertsEverything() public {
        token.setFee(100);
        vm.expectRevert(bytes4(keccak256("UnsupportedTokenTransfer()")));
        vm.prank(customer);
        vault.deposit(100e6);
        assertEq(vault.availableBalance(customer), 0);
        assertEq(vault.totalLiability(), 0);
        assertEq(token.balanceOf(customer), 100e6);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function testFalseReturnDepositDoesNotCreateLiability() public {
        token.configureFailures(false, true);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        vm.prank(customer);
        vault.deposit(100e6);
        assertEq(vault.totalLiability(), 0);
    }

    function testWithdrawalTransferFailureRestoresBalances() public {
        _deposit();
        token.configureFailures(true, false);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        vm.prank(customer);
        vault.withdraw(20e6);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(vault.totalLiability(), 100e6);
        assertEq(token.balanceOf(address(vault)), 100e6);
    }

    function testCaptureTransferFailureRestoresActiveAuthorization() public {
        bytes32 id = _hold();
        token.configureFailures(true, false);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        vm.prank(merchant);
        vault.capture(id, 20e6);
        (,,, uint128 captured,, CovaVault.HoldStatus status,) = vault.holds(id);
        assertEq(captured, 0);
        assertEq(uint8(status), 1);
        assertEq(vault.heldBalance(customer), 20e6);
        assertEq(vault.totalLiability(), 100e6);
        assertEq(token.balanceOf(merchant), 0);
    }

    function testFeeIntroducedAfterDepositCannotShortPayWithdrawal() public {
        _deposit();
        token.setFee(100);
        vm.expectRevert(bytes4(keccak256("UnsupportedTokenTransfer()")));
        vm.prank(customer);
        vault.withdraw(20e6);
        assertEq(vault.availableBalance(customer), 100e6);
        assertEq(token.balanceOf(customer), 0);
        assertEq(vault.totalLiability(), 100e6);
    }

    function testFeeIntroducedAfterDepositCannotShortPayMerchant() public {
        bytes32 id = _hold();
        token.setFee(100);
        vm.expectRevert(bytes4(keccak256("UnsupportedTokenTransfer()")));
        vm.prank(merchant);
        vault.capture(id, 20e6);
        assertEq(vault.heldBalance(customer), 20e6);
        assertEq(token.balanceOf(merchant), 0);
        assertEq(vault.totalLiability(), 100e6);
    }

    function testSafeERC20SupportsNoReturnToken() public {
        NoReturnUSDG noReturn = new NoReturnUSDG();
        CovaVault other = new CovaVault(address(noReturn));
        noReturn.mint(customer, 100e6);
        vm.startPrank(customer);
        noReturn.approve(address(other), 100e6);
        other.deposit(100e6);
        other.withdraw(20e6);
        bytes32 id = other.createHold(merchant, 20e6, uint64(block.timestamp + 1 hours), bytes32(0));
        vm.stopPrank();
        vm.prank(merchant);
        other.capture(id, 20e6);
        assertEq(other.availableBalance(customer), 60e6);
        assertEq(noReturn.balanceOf(customer), 20e6);
        assertEq(noReturn.balanceOf(merchant), 20e6);
        assertEq(other.totalLiability(), 60e6);
    }

    function testDepositReentrancyBlockedAcrossAllMutators() public {
        _assertAllCallbacksBlocked(true);
    }

    function testWithdrawalReentrancyBlockedAcrossAllMutators() public {
        _assertAllCallbacksBlocked(false);
    }

    function testCaptureReentrancyCannotReleaseRemainingGuarantee() public {
        _deposit();
        vm.prank(customer);
        bytes32 id = vault.createHold(address(token), 20e6, uint64(block.timestamp + 1 hours), bytes32(0));
        token.configureCallback(address(vault), abi.encodeCall(CovaVault.release, (id)), true, false, false);
        vm.prank(address(token));
        vault.capture(id, 14e6);
        assertFalse(token.callbackSuccess());
        assertEq(
            token.callbackResult(),
            abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
        );
        assertEq(vault.heldBalance(customer), 6e6);
        assertEq(vault.availableBalance(customer), 80e6);
        assertEq(token.balanceOf(address(token)), 14e6);
    }

    function testBubbledReentrantCallbackRollsBackDeposit() public {
        token.configureCallback(
            address(vault), abi.encodeCall(CovaVault.deposit, (uint256(1))), false, true, true
        );
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(customer);
        vault.deposit(100e6);
        assertEq(vault.totalLiability(), 0);
        assertEq(token.balanceOf(customer), 100e6);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function _assertAllCallbacksBlocked(bool inbound) internal {
        bytes[] memory calls = new bytes[](6);
        calls[0] = abi.encodeCall(CovaVault.deposit, (uint256(1)));
        calls[1] = abi.encodeCall(CovaVault.withdraw, (uint256(1)));
        calls[2] = abi.encodeCall(
            CovaVault.createHold, (merchant, uint256(1), uint64(block.timestamp + 1), bytes32(0))
        );
        calls[3] = abi.encodeCall(CovaVault.capture, (bytes32(0), uint256(1)));
        calls[4] = abi.encodeCall(CovaVault.release, (bytes32(0)));
        calls[5] = abi.encodeCall(CovaVault.releaseExpired, (bytes32(0)));
        if (!inbound) _deposit();
        for (uint256 i; i < calls.length; ++i) {
            token.configureCallback(address(vault), calls[i], !inbound, inbound, false);
            vm.prank(customer);
            if (inbound) vault.deposit(1e6);
            else vault.withdraw(1e6);
            assertFalse(token.callbackSuccess());
            assertEq(
                token.callbackResult(),
                abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
            );
        }
        assertEq(vault.totalLiability(), inbound ? 6e6 : 94e6);
        assertEq(token.balanceOf(address(vault)), vault.totalLiability());
    }

    function _deposit() internal {
        vm.prank(customer);
        vault.deposit(100e6);
    }

    function _hold() internal returns (bytes32) {
        _deposit();
        vm.prank(customer);
        return vault.createHold(merchant, 20e6, uint64(block.timestamp + 1 hours), bytes32(0));
    }
}
