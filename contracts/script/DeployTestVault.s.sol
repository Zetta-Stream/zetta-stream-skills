// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TestVault} from "../src/TestVault.sol";

contract DeployTestVault is Script {
    function run() external returns (address vaultAddr) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        TestVault v = new TestVault();
        vaultAddr = address(v);
        vm.stopBroadcast();

        console2.log("TestVault deployed at:", vaultAddr);
        console2.log("Add to .env:");
        console2.log("TEST_VAULT_ADDRESS=", vaultAddr);
    }
}
