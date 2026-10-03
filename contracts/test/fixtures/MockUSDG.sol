// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test and local Anvil fixture only. This is not Paxos USDG or a production token.
contract MockUSDG is ERC20 {
    constructor() ERC20("Mock USDG (test only)", "MockUSDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

