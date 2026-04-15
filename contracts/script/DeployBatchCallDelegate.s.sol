// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BatchCallDelegate} from "../src/BatchCallDelegate.sol";

contract DeployBatchCallDelegate is Script {
    function run() external returns (address delegateAddr) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        BatchCallDelegate d = new BatchCallDelegate();
        delegateAddr = address(d);
        vm.stopBroadcast();

        console2.log("BatchCallDelegate deployed at:", delegateAddr);
        console2.log("Add to .env:");
        console2.log("BATCH_CALL_DELEGATE_ADDRESS=", delegateAddr);
        console2.log("NEXT_PUBLIC_BATCH_CALL_DELEGATE_ADDRESS=", delegateAddr);
    }
}
