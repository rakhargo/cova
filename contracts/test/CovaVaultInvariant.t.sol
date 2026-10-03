// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {CovaVault} from "../src/CovaVault.sol";
import {MockUSDG} from "./fixtures/MockUSDG.sol";

contract VaultHandler is Test {
    CovaVault public vault;
    MockUSDG public token;
    address[3] public customers;
    address[2] public merchants;
    bytes32[] public ids;
    uint256 public deposited;
    uint256 public withdrawn;
    uint256 public captured;
    uint256 public donated;
    mapping(address => uint256) public customerWithdrawals;

    constructor(CovaVault vault_, MockUSDG token_) {
        vault = vault_;
        token = token_;
        customers = [makeAddr("customer 0"), makeAddr("customer 1"), makeAddr("customer 2")];
        merchants = [makeAddr("merchant 0"), makeAddr("merchant 1")];
        for (uint256 i; i < customers.length; ++i) {
            vm.prank(customers[i]);
            token.approve(address(vault), type(uint256).max);
        }
    }

    function deposit(uint256 actor, uint256 rawAmount) external {
        address customer = customers[actor % 3];
        uint256 amount = bound(rawAmount, 1, 1_000e6);
        token.mint(customer, amount);
        vm.prank(customer);
        vault.deposit(amount);
        deposited += amount;
    }

    function withdraw(uint256 actor, uint256 rawAmount) external {
        address customer = customers[actor % 3];
        uint256 available = vault.availableBalance(customer);
        if (available == 0) return;
        uint256 amount = bound(rawAmount, 1, available);
        vm.prank(customer);
        vault.withdraw(amount);
        withdrawn += amount;
        customerWithdrawals[customer] += amount;
    }

    function createHold(uint256 actor, uint256 merchantIndex, uint256 rawAmount, uint32 rawDuration)
        external
    {
        address customer = customers[actor % 3];
        uint256 available = vault.availableBalance(customer);
        if (available == 0) return;
        uint256 amount = bound(rawAmount, 1, available);
        uint64 expiry = uint64(block.timestamp + bound(rawDuration, 1, 30 days));
        vm.prank(customer);
        ids.push(vault.createHold(merchants[merchantIndex % 2], amount, expiry, bytes32(ids.length)));
    }

    function capture(uint256 index, uint256 rawAmount) external {
        if (ids.length == 0) return;
        bytes32 id = ids[index % ids.length];
        (
            ,
            address merchant,
            uint128 authorized,
            uint128 alreadyCaptured,
            uint64 expiry,
            CovaVault.HoldStatus status,
        ) = vault.holds(id);
        if (status != CovaVault.HoldStatus.Active || block.timestamp >= expiry) return;
        uint256 amount = bound(rawAmount, 1, uint256(authorized) - alreadyCaptured);
        vm.prank(merchant);
        vault.capture(id, amount);
        captured += amount;
    }

    function release(uint256 index) external {
        if (ids.length == 0) return;
        bytes32 id = ids[index % ids.length];
        (, address merchant,,,, CovaVault.HoldStatus status,) = vault.holds(id);
        if (status != CovaVault.HoldStatus.Active) return;
        vm.prank(merchant);
        vault.release(id);
    }

    function releaseExpired(uint256 index) external {
        if (ids.length == 0) return;
        bytes32 id = ids[index % ids.length];
        (,,,, uint64 expiry, CovaVault.HoldStatus status,) = vault.holds(id);
        if (status != CovaVault.HoldStatus.Active || block.timestamp < expiry) return;
        vault.releaseExpired(id);
    }

    function advanceTime(uint32 rawTime) external {
        vm.warp(block.timestamp + bound(rawTime, 1, 30 days));
    }

    function donate(uint256 rawAmount) external {
        uint256 amount = bound(rawAmount, 1, 100e6);
        token.mint(address(vault), amount);
        donated += amount;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }
}

contract CovaVaultInvariantTest is StdInvariant, Test {
    CovaVault internal vault;
    MockUSDG internal token;
    VaultHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockUSDG();
        vault = new CovaVault(address(token));
        handler = new VaultHandler(vault, token);
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = VaultHandler.deposit.selector;
        selectors[1] = VaultHandler.withdraw.selector;
        selectors[2] = VaultHandler.createHold.selector;
        selectors[3] = VaultHandler.capture.selector;
        selectors[4] = VaultHandler.release.selector;
        selectors[5] = VaultHandler.releaseExpired.selector;
        selectors[6] = VaultHandler.advanceTime.selector;
        selectors[7] = VaultHandler.donate.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariantLiabilitiesAndLifetimeMoneyReconcile() public view {
        uint256 balances;
        for (uint256 i; i < 3; ++i) {
            address customer = handler.customers(i);
            balances += vault.availableBalance(customer) + vault.heldBalance(customer);
            assertEq(token.balanceOf(customer), handler.customerWithdrawals(customer));
        }
        assertEq(vault.totalLiability(), balances);
        assertEq(token.balanceOf(address(vault)), balances + handler.donated());
        assertEq(handler.deposited(), balances + handler.withdrawn() + handler.captured());
        assertEq(
            token.balanceOf(handler.merchants(0)) + token.balanceOf(handler.merchants(1)), handler.captured()
        );
    }

    function invariantReservationsEqualActiveHoldRemainders() public view {
        uint256[3] memory held;
        uint256 totalCaptured;
        for (uint256 i; i < handler.idCount(); ++i) {
            (address customer,, uint128 authorized, uint128 captured,, CovaVault.HoldStatus status,) =
                vault.holds(handler.ids(i));
            assertLe(captured, authorized);
            totalCaptured += captured;
            if (status == CovaVault.HoldStatus.Captured) assertEq(captured, authorized);
            if (status == CovaVault.HoldStatus.Active) {
                assertLt(captured, authorized);
                for (uint256 j; j < 3; ++j) {
                    if (customer == handler.customers(j)) held[j] += uint256(authorized) - captured;
                }
            }
        }
        for (uint256 j; j < 3; ++j) {
            assertEq(vault.heldBalance(handler.customers(j)), held[j]);
        }
        assertEq(totalCaptured, handler.captured());
    }

    function invariantHistoryIdsRemainDiscoverableAndUnique() public view {
        for (uint256 i; i < handler.idCount(); ++i) {
            bytes32 id = handler.ids(i);
            assertTrue(id != bytes32(0));
            (address customer, address merchant,,,, CovaVault.HoldStatus status,) = vault.holds(id);
            assertTrue(status != CovaVault.HoldStatus.None);
            assertTrue(_contains(vault.getCustomerHoldIds(customer, 0, 100), id));
            assertTrue(_contains(vault.getMerchantHoldIds(merchant, 0, 100), id));
            for (uint256 j; j < i; ++j) {
                assertTrue(id != handler.ids(j));
            }
        }
    }

    function _contains(bytes32[] memory list, bytes32 id) private pure returns (bool) {
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == id) return true;
        }
        return false;
    }
}
