// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {CovaSessionRouter} from "../src/CovaSessionRouter.sol";

/// @notice Deploy against the verified CovaVault v2; private key stays in the environment.
contract DeploySessionRouter is Script {
    function run() external returns (CovaSessionRouter router) {
        require(block.chainid == 421614, "Deploy only to Arbitrum Sepolia");
        address vault = vm.envAddress("COVA_SESSION_VAULT_ADDRESS");
        address token = vm.envAddress("USDG_ADDRESS");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        router = new CovaSessionRouter(vault, token);
        vm.stopBroadcast();
    }
}
