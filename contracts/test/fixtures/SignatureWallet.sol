// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Deployed ERC1271 wallet fixture with owner-based signatures and revocation.
contract SignatureWallet is IERC1271 {
    address public immutable OWNER;
    uint8 public mode;
    address public callbackTarget;
    bytes public callbackData;

    constructor(address owner_) {
        OWNER = owner_;
    }

    function configure(uint8 mode_, address target, bytes calldata data) external {
        mode = mode_;
        callbackTarget = target;
        callbackData = data;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        if (mode == 1) return 0xffffffff;
        if (mode == 2) revert("revoked");
        if (mode == 3) {
            assembly ("memory-safe") { return(0, 0) }
        }
        if (mode == 4) {
            (bool success, bytes memory result) = callbackTarget.staticcall(callbackData);
            if (
                success
                    || keccak256(result)
                        != keccak256(
                            abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
                        )
            ) {
                return 0xffffffff;
            }
        }
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(digest, signature);
        return error == ECDSA.RecoverError.NoError && recovered == OWNER
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }
}
