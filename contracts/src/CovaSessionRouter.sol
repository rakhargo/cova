// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CovaVault} from "./CovaVault.sol";

/// @title CovaSessionRouter
/// @notice Converts a provider-signed time quote into a vault hold and deterministic settlement.
/// @dev CovaVault remains the accounting authority; all prices are token base units.
contract CovaSessionRouter is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum SessionStatus {
        None,
        Active,
        Settled,
        Expired
    }

    struct SessionQuote {
        bytes32 sessionId;
        address customer;
        address provider;
        bytes32 serviceId;
        uint128 ratePerMinute;
        uint128 maxAmount;
        uint32 maxDurationSeconds;
        uint64 startBy;
        uint64 holdExpiresAt;
    }

    struct Session {
        SessionStatus status;
        bytes32 quoteDigest;
        bytes32 holdId;
        address customer;
        address provider;
        uint128 ratePerMinute;
        uint128 maxAmount;
        uint128 chargedAmount;
        uint128 returnedAmount;
        uint32 maxDurationSeconds;
        uint64 startedAt;
        uint64 stoppedAt;
    }

    error InvalidVault();
    error InvalidToken();
    error InvalidQuote();
    error InvalidProviderSignature();
    error SessionAlreadyExists();
    error InvalidAuthorization();
    error StartDeadlinePassed();
    error UnauthorizedStopper();
    error SessionNotActive();
    error StopSignatureExpired();
    error InvalidStopSignature();
    error MaxDurationNotReached();
    error HoldNotExpired();
    error UnsupportedTokenTransfer();
    error PageSizeTooLarge();

    event SessionStarted(
        bytes32 indexed sessionId, bytes32 indexed holdId, address indexed customer, address provider
    );
    event SessionSettled(
        bytes32 indexed sessionId,
        uint64 stoppedAt,
        uint256 billedSeconds,
        uint256 chargedAmount,
        uint256 returnedAmount
    );
    event SessionExpired(bytes32 indexed sessionId, uint256 returnedAmount);

    IERC20 public immutable token;
    CovaVault public immutable vault;
    uint256 public constant MAX_PAGE_SIZE = 100;

    bytes32 private constant SESSION_QUOTE_TYPEHASH = keccak256(
        "SessionQuote(bytes32 sessionId,address customer,address provider,bytes32 serviceId,uint128 ratePerMinute,uint128 maxAmount,uint32 maxDurationSeconds,uint64 startBy,uint64 holdExpiresAt)"
    );
    bytes32 private constant SESSION_STOP_TYPEHASH =
        keccak256("SessionStop(bytes32 sessionId,uint64 validUntil)");

    mapping(bytes32 => Session) public sessions;
    mapping(address => uint256) public activeSessionCount;
    mapping(address => bytes32[]) private customerSessionIds;
    mapping(address => bytes32[]) private providerSessionIds;

    constructor(address vault_, address token_) EIP712("CovaSessionRouter", "1") {
        if (vault_ == address(0) || vault_.code.length == 0) revert InvalidVault();
        if (token_ == address(0) || token_.code.length == 0) revert InvalidToken();
        CovaVault candidate = CovaVault(vault_);
        if (candidate.version() != 2 || address(candidate.token()) != token_) revert InvalidVault();
        if (block.chainid != 421614 && block.chainid != 31337 && block.chainid != 31338) {
            revert InvalidVault();
        }
        if (block.chainid == 421614 && token_ != 0xFFC95faa3d63Cde504a05B567C600B78C0b41892) {
            revert InvalidToken();
        }
        vault = candidate;
        token = IERC20(token_);
    }

    function quoteDigest(SessionQuote calldata quote) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SESSION_QUOTE_TYPEHASH,
                quote.sessionId,
                quote.customer,
                quote.provider,
                quote.serviceId,
                quote.ratePerMinute,
                quote.maxAmount,
                quote.maxDurationSeconds,
                quote.startBy,
                quote.holdExpiresAt
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function startSession(
        SessionQuote calldata quote,
        bytes calldata providerSignature,
        CovaVault.HoldAuthorization calldata authorization,
        bytes calldata customerSignature
    ) external nonReentrant returns (bytes32 holdId) {
        if (sessions[quote.sessionId].status != SessionStatus.None) {
            revert SessionAlreadyExists();
        }
        if (
            quote.sessionId == bytes32(0) || quote.serviceId == bytes32(0) || quote.customer == address(0)
                || quote.provider == address(0) || quote.provider == address(this)
                || quote.customer == quote.provider || quote.ratePerMinute == 0 || quote.maxAmount == 0
                || quote.maxDurationSeconds == 0
        ) {
            revert InvalidQuote();
        }
        if (block.timestamp > quote.startBy) revert StartDeadlinePassed();
        if (
            quote.holdExpiresAt <= quote.startBy || quote.holdExpiresAt <= block.timestamp
                || uint256(quote.holdExpiresAt) <= uint256(quote.startBy) + quote.maxDurationSeconds
        ) revert InvalidQuote();
        if (Math.mulDiv(quote.ratePerMinute, quote.maxDurationSeconds, 60) > quote.maxAmount) {
            revert InvalidQuote();
        }

        bytes32 digest = quoteDigest(quote);
        if (!SignatureChecker.isValidSignatureNow(quote.provider, digest, providerSignature)) {
            revert InvalidProviderSignature();
        }
        if (
            authorization.customer != quote.customer || authorization.merchant != address(this)
                || authorization.maxAmount != quote.maxAmount
                || authorization.expiresAt != quote.holdExpiresAt || authorization.referenceId != digest
        ) revert InvalidAuthorization();

        holdId = vault.authorizeHold(authorization, customerSignature);
        sessions[quote.sessionId] = Session({
            status: SessionStatus.Active,
            quoteDigest: digest,
            holdId: holdId,
            customer: quote.customer,
            provider: quote.provider,
            ratePerMinute: quote.ratePerMinute,
            maxAmount: quote.maxAmount,
            chargedAmount: 0,
            returnedAmount: 0,
            maxDurationSeconds: quote.maxDurationSeconds,
            startedAt: uint64(block.timestamp),
            stoppedAt: 0
        });
        activeSessionCount[quote.customer] += 1;
        customerSessionIds[quote.customer].push(quote.sessionId);
        providerSessionIds[quote.provider].push(quote.sessionId);
        emit SessionStarted(quote.sessionId, holdId, quote.customer, quote.provider);
    }

    function stopSession(bytes32 sessionId) external nonReentrant {
        Session storage session = _active(sessionId);
        if (msg.sender != session.customer && msg.sender != session.provider) revert UnauthorizedStopper();
        if (block.timestamp >= _holdExpiry(session.holdId)) {
            _expire(sessionId, session);
        } else {
            _settle(sessionId, session, _billableSeconds(session, block.timestamp));
        }
    }

    function stopSessionWithSignature(bytes32 sessionId, uint64 validUntil, bytes calldata customerSignature)
        external
        nonReentrant
    {
        Session storage session = _active(sessionId);
        if (block.timestamp > validUntil) revert StopSignatureExpired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SESSION_STOP_TYPEHASH, sessionId, validUntil)));
        if (!SignatureChecker.isValidSignatureNow(session.customer, digest, customerSignature)) {
            revert InvalidStopSignature();
        }
        if (block.timestamp >= _holdExpiry(session.holdId)) _expire(sessionId, session);
        else _settle(sessionId, session, _billableSeconds(session, block.timestamp));
    }

    function settleAtMaxDuration(bytes32 sessionId) external nonReentrant {
        Session storage session = _active(sessionId);
        uint256 deadline = uint256(session.startedAt) + session.maxDurationSeconds;
        if (block.timestamp < deadline) revert MaxDurationNotReached();
        if (block.timestamp >= _holdExpiry(session.holdId)) _expire(sessionId, session);
        else _settle(sessionId, session, session.maxDurationSeconds);
    }

    function expireSession(bytes32 sessionId) external nonReentrant {
        Session storage session = _active(sessionId);
        if (block.timestamp < _holdExpiry(session.holdId)) revert HoldNotExpired();
        _expire(sessionId, session);
    }

    function getCustomerSessionIds(address customer, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory)
    {
        return _page(customerSessionIds[customer], offset, limit);
    }

    function getProviderSessionIds(address provider, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory)
    {
        return _page(providerSessionIds[provider], offset, limit);
    }

    function _settle(bytes32 sessionId, Session storage session, uint256 secondsBilled) private {
        uint256 charge = Math.mulDiv(session.ratePerMinute, secondsBilled, 60);
        if (charge > session.maxAmount) revert InvalidQuote();
        uint256 amountBefore = token.balanceOf(address(this));
        session.status = SessionStatus.Settled;
        activeSessionCount[session.customer] -= 1;
        session.stoppedAt = uint64(block.timestamp);
        session.chargedAmount = uint128(charge);
        session.returnedAmount = uint128(uint256(session.maxAmount) - charge);
        if (charge != 0) {
            vault.capture(session.holdId, charge);
            uint256 amountAfterCapture = token.balanceOf(address(this));
            if (amountAfterCapture < amountBefore || amountAfterCapture - amountBefore != charge) {
                revert UnsupportedTokenTransfer();
            }
            uint256 providerBefore = token.balanceOf(session.provider);
            token.safeTransfer(session.provider, charge);
            uint256 routerAfter = token.balanceOf(address(this));
            uint256 providerAfter = token.balanceOf(session.provider);
            if (
                routerAfter > amountAfterCapture || amountAfterCapture - routerAfter != charge
                    || providerAfter < providerBefore || providerAfter - providerBefore != charge
            ) {
                revert UnsupportedTokenTransfer();
            }
        }
        // A full capture already closes the underlying vault hold. Calling
        // release after that would revert with HoldNotActive.
        if (session.returnedAmount != 0) vault.release(session.holdId);
        emit SessionSettled(sessionId, session.stoppedAt, secondsBilled, charge, session.returnedAmount);
    }

    function _expire(bytes32 sessionId, Session storage session) private {
        // Anyone may also call CovaVault.releaseExpired directly. Reconcile a
        // previously released hold so that permissionless Router cleanup and
        // the per-customer active-session counter cannot get stuck.
        (,,,,, CovaVault.HoldStatus holdStatus,) = vault.holds(session.holdId);
        if (holdStatus == CovaVault.HoldStatus.Active) {
            vault.releaseExpired(session.holdId);
        } else if (holdStatus != CovaVault.HoldStatus.Released) {
            revert SessionNotActive();
        }
        session.status = SessionStatus.Expired;
        activeSessionCount[session.customer] -= 1;
        session.stoppedAt = uint64(block.timestamp);
        session.returnedAmount = session.maxAmount;
        emit SessionExpired(sessionId, session.maxAmount);
    }

    function _active(bytes32 sessionId) private view returns (Session storage session) {
        session = sessions[sessionId];
        if (session.status != SessionStatus.Active) revert SessionNotActive();
    }

    function _holdExpiry(bytes32 holdId) private view returns (uint64 expiry) {
        (,,,, expiry,,) = vault.holds(holdId);
    }

    function _billableSeconds(Session storage session, uint256 stopAt) private view returns (uint256) {
        uint256 elapsed = stopAt - session.startedAt;
        return elapsed > session.maxDurationSeconds ? session.maxDurationSeconds : elapsed;
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
