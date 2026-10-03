// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Script} from "forge-std/Script.sol";
import {CovaVault} from "../src/CovaVault.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Deploy the immutable vault using official Paxos USDG on Arbitrum Sepolia.
/// @dev Supply ARB_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, USDG_ADDRESS through the environment.
contract Deploy is Script {
    address internal constant OFFICIAL_USDG = 0xFFC95faa3d63Cde504a05B567C600B78C0b41892;

    function run() external returns (CovaVault vault) {
        require(block.chainid == 421614, "Deploy only to Arbitrum Sepolia");
        address tokenAddress = vm.envAddress("USDG_ADDRESS");
        require(tokenAddress == OFFICIAL_USDG, "Use official Arbitrum Sepolia USDG");
        require(tokenAddress.code.length != 0, "USDG bytecode missing");
        IERC20Metadata token = IERC20Metadata(tokenAddress);
        require(token.decimals() == 6, "USDG must use six decimals");
        require(keccak256(bytes(token.symbol())) == keccak256("USDG"), "USDG symbol mismatch");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(deployerKey != 0, "Deployer key missing");
        vm.startBroadcast(deployerKey);
        vault = new CovaVault(tokenAddress);
        vm.stopBroadcast();
    }
}
