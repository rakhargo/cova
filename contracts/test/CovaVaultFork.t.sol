// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {CovaVault} from "../src/CovaVault.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Optional read-only fork integration against the official Paxos Arbitrum Sepolia USDG deployment.
/// @dev The deal cheatcode changes only the local fork; this suite never signs or broadcasts public transactions.
contract CovaVaultForkTest is Test {
    address internal constant OFFICIAL_USDG = 0xFFC95faa3d63Cde504a05B567C600B78C0b41892;
    IERC20Metadata internal token;
    CovaVault internal vault;
    address internal customer = makeAddr("fork customer");
    address internal merchant = makeAddr("fork merchant");
    bool internal forkEnabled;

    function setUp() public {
        string memory rpc = vm.envOr("ARB_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 421614);
        assertGt(OFFICIAL_USDG.code.length, 0);
        token = IERC20Metadata(OFFICIAL_USDG);
        assertEq(token.decimals(), 6);
        assertEq(token.symbol(), "USDG");
        vault = new CovaVault(OFFICIAL_USDG);
        deal(OFFICIAL_USDG, customer, 100e6);
        assertEq(token.balanceOf(customer), 100e6);
        vm.startPrank(customer);
        token.approve(address(vault), 100e6);
        vault.deposit(100e6);
        vm.stopPrank();
        forkEnabled = true;
    }

    function testOfficialUSDGPartialCaptureReleaseAndWithdrawal() public {
        vm.skip(!forkEnabled);
        vm.prank(customer);
        bytes32 id = vault.createHold(merchant, 20e6, uint64(block.timestamp + 1 hours), keccak256("court"));
        vm.startPrank(merchant);
        vault.capture(id, 14e6);
        vault.release(id);
        vm.stopPrank();
        assertEq(token.balanceOf(merchant), 14e6);
        assertEq(vault.availableBalance(customer), 86e6);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(token.balanceOf(address(vault)), vault.totalLiability());
        vm.prank(customer);
        vault.withdraw(86e6);
        assertEq(token.balanceOf(customer), 86e6);
        assertEq(vault.totalLiability(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function testOfficialUSDGFullCaptureAndExpiry() public {
        vm.skip(!forkEnabled);
        vm.startPrank(customer);
        bytes32 fullyCaptured =
            vault.createHold(merchant, 30e6, uint64(block.timestamp + 1 hours), bytes32(0));
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes32 expired = vault.createHold(merchant, 20e6, expiry, bytes32(0));
        vm.stopPrank();
        vm.prank(merchant);
        vault.capture(fullyCaptured, 30e6);
        vm.warp(expiry);
        vm.expectRevert(CovaVault.HoldExpired.selector);
        vm.prank(merchant);
        vault.capture(expired, 1);
        vault.releaseExpired(expired);
        assertEq(token.balanceOf(merchant), 30e6);
        assertEq(vault.availableBalance(customer), 70e6);
        assertEq(vault.heldBalance(customer), 0);
        assertEq(token.balanceOf(address(vault)), 70e6);
    }
}
