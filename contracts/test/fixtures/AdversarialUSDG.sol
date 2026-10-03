// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDG} from "./MockUSDG.sol";

/// @notice Adversarial fixtures exercise the vault's actual transfer and rollback boundaries.
contract AdversarialUSDG is MockUSDG {
    bool public failTransfer;
    bool public failTransferFrom;
    uint256 public feeBps;
    address public callbackTarget;
    bytes public callbackData;
    bool public onTransfer;
    bool public onTransferFrom;
    bool public bubbleCallbackFailure;
    bool public callbackSuccess;
    bytes public callbackResult;

    function configureFailures(bool transferFailure, bool transferFromFailure) external {
        failTransfer = transferFailure;
        failTransferFrom = transferFromFailure;
    }

    function setFee(uint256 basisPoints) external {
        feeBps = basisPoints;
    }

    function configureCallback(
        address target,
        bytes calldata data,
        bool transferHook,
        bool transferFromHook,
        bool bubble
    ) external {
        callbackTarget = target;
        callbackData = data;
        onTransfer = transferHook;
        onTransferFrom = transferFromHook;
        bubbleCallbackFailure = bubble;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failTransfer) return false;
        bool success = super.transfer(to, amount);
        if (onTransfer) _callback();
        return success;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (failTransferFrom) return false;
        bool success = super.transferFrom(from, to, amount);
        if (onTransferFrom) _callback();
        return success;
    }

    function _update(address from, address to, uint256 amount) internal override {
        uint256 fee = from != address(0) && to != address(0) ? amount * feeBps / 10_000 : 0;
        if (fee != 0) super._update(from, address(0), fee);
        super._update(from, to, amount - fee);
    }

    function _callback() private {
        (callbackSuccess, callbackResult) = callbackTarget.call(callbackData);
        if (!callbackSuccess && bubbleCallbackFailure) {
            bytes memory result = callbackResult;
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
    }
}

contract NoReturnUSDG is MockUSDG {
    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        assembly ("memory-safe") { return(0, 0) }
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        assembly ("memory-safe") { return(0, 0) }
    }
}
