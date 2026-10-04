// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CovaVault
/// @notice Reserve customer USDG, settle actual charges to the authorized merchant, and release the remainder.
/// @dev Amounts are token base units. Designed for a standard, non-rebasing ERC-20 such as USDG.
///      Token balance changes must exactly match transfers. Direct donations do not create customer credit.
contract CovaVaultV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum HoldStatus {
        None,
        Active,
        Captured,
        Released
    }

    struct Hold {
        address customer;
        address merchant;
        uint128 authorizedAmount;
        uint128 capturedAmount;
        uint64 expiresAt;
        HoldStatus status;
        bytes32 referenceId;
    }

    error InvalidToken();
    error InvalidAmount();
    error InvalidMerchant();
    error InvalidExpiry();
    error AmountTooLarge();
    error InsufficientAvailableBalance();
    error HoldNotActive();
    error UnauthorizedMerchant();
    error HoldExpired();
    error HoldNotExpired();
    error UnsupportedTokenTransfer();
    error PageSizeTooLarge();

    event Deposited(address indexed customer, uint256 amount);
    event Withdrawn(address indexed customer, uint256 amount);
    event HoldCreated(
        bytes32 indexed holdId,
        address indexed customer,
        address indexed merchant,
        uint256 amount,
        uint64 expiresAt,
        bytes32 referenceId
    );
    event HoldCaptured(bytes32 indexed holdId, uint256 amount);
    event HoldReleased(bytes32 indexed holdId, uint256 amount);

    // Public lowercase name is part of the documented token() ABI.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    IERC20 public immutable token;
    uint256 public totalLiability;
    uint256 public constant MAX_PAGE_SIZE = 100;
    mapping(address => uint256) public availableBalance;
    mapping(address => uint256) public heldBalance;
    mapping(bytes32 => Hold) public holds;
    mapping(address => bytes32[]) private customerHoldIds;
    mapping(address => bytes32[]) private merchantHoldIds;
    uint256 private nextHoldNonce;

    constructor(address token_) {
        if (token_ == address(0) || token_.code.length == 0) revert InvalidToken();
        token = IERC20(token_);
    }

    /// @notice Fund the caller's available balance after a separate token approval.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = token.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert UnsupportedTokenTransfer();
        }
        availableBalance[msg.sender] += amount;
        totalLiability += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw only the caller's unreserved funds.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > availableBalance[msg.sender]) revert InsufficientAvailableBalance();
        availableBalance[msg.sender] -= amount;
        totalLiability -= amount;
        _transferOut(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Create a separate merchant guarantee. A reference is metadata and may be reused.
    function createHold(address merchant, uint256 amount, uint64 expiresAt, bytes32 referenceId)
        external
        nonReentrant
        returns (bytes32 holdId)
    {
        if (merchant == address(0) || merchant == address(this)) revert InvalidMerchant();
        if (amount == 0) revert InvalidAmount();
        if (amount > type(uint128).max) revert AmountTooLarge();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (amount > availableBalance[msg.sender]) revert InsufficientAvailableBalance();

        holdId = keccak256(abi.encode(address(this), block.chainid, msg.sender, ++nextHoldNonce));
        availableBalance[msg.sender] -= amount;
        heldBalance[msg.sender] += amount;
        holds[holdId] = Hold({
            customer: msg.sender,
            merchant: merchant,
            // Checked above against type(uint128).max.
            // forge-lint: disable-next-line(unsafe-typecast)
            authorizedAmount: uint128(amount),
            capturedAmount: 0,
            expiresAt: expiresAt,
            status: HoldStatus.Active,
            referenceId: referenceId
        });
        customerHoldIds[msg.sender].push(holdId);
        merchantHoldIds[merchant].push(holdId);
        emit HoldCreated(holdId, msg.sender, merchant, amount, expiresAt, referenceId);
    }

    /// @notice The assigned merchant can capture repeatedly strictly before expiry, up to the remaining amount.
    function capture(bytes32 holdId, uint256 amount) external nonReentrant {
        Hold storage hold = _activeHold(holdId);
        if (msg.sender != hold.merchant) revert UnauthorizedMerchant();
        if (block.timestamp >= hold.expiresAt) revert HoldExpired();
        uint256 remaining = uint256(hold.authorizedAmount) - hold.capturedAmount;
        if (amount == 0 || amount > remaining) revert InvalidAmount();

        // amount <= remaining <= authorizedAmount, which is already uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        hold.capturedAmount += uint128(amount);
        heldBalance[hold.customer] -= amount;
        totalLiability -= amount;
        if (amount == remaining) hold.status = HoldStatus.Captured;
        _transferOut(hold.merchant, amount);
        emit HoldCaptured(holdId, amount);
    }

    /// @notice The assigned merchant can close an active hold and release its entire remaining amount.
    function release(bytes32 holdId) external nonReentrant {
        Hold storage hold = _activeHold(holdId);
        if (msg.sender != hold.merchant) revert UnauthorizedMerchant();
        _release(holdId, hold);
    }

    /// @notice Anyone can return expired reserved funds to the customer's available balance, at or after expiry.
    /// @dev Time passing alone does not mutate storage; an expired active hold still reserves funds until released.
    function releaseExpired(bytes32 holdId) external nonReentrant {
        Hold storage hold = _activeHold(holdId);
        if (block.timestamp < hold.expiresAt) revert HoldNotExpired();
        _release(holdId, hold);
    }

    /// @notice Discover all customer holds in creation order, including terminal holds.
    function getCustomerHoldIds(address customer, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory)
    {
        return _page(customerHoldIds[customer], offset, limit);
    }

    /// @notice Discover all merchant holds in creation order, including terminal holds.
    function getMerchantHoldIds(address merchant, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory)
    {
        return _page(merchantHoldIds[merchant], offset, limit);
    }

    function _activeHold(bytes32 holdId) private view returns (Hold storage hold) {
        hold = holds[holdId];
        if (hold.status != HoldStatus.Active) revert HoldNotActive();
    }

    function _release(bytes32 holdId, Hold storage hold) private {
        uint256 remaining = uint256(hold.authorizedAmount) - hold.capturedAmount;
        hold.status = HoldStatus.Released;
        heldBalance[hold.customer] -= remaining;
        availableBalance[hold.customer] += remaining;
        emit HoldReleased(holdId, remaining);
    }

    function _transferOut(address recipient, uint256 amount) private {
        uint256 vaultBefore = token.balanceOf(address(this));
        uint256 recipientBefore = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        uint256 vaultAfter = token.balanceOf(address(this));
        uint256 recipientAfter = token.balanceOf(recipient);
        if (
            vaultAfter > vaultBefore || vaultBefore - vaultAfter != amount || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != amount || vaultAfter < totalLiability
        ) revert UnsupportedTokenTransfer();
    }

    function _page(bytes32[] storage ids, uint256 offset, uint256 limit)
        private
        view
        returns (bytes32[] memory result)
    {
        if (limit > MAX_PAGE_SIZE) revert PageSizeTooLarge();
        if (offset >= ids.length || limit == 0) return new bytes32[](0);
        uint256 length = ids.length - offset;
        if (length > limit) length = limit;
        result = new bytes32[](length);
        for (uint256 i; i < length; ++i) {
            result[i] = ids[offset + i];
        }
    }
}
