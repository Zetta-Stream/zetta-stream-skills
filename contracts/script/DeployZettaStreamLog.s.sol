// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ZettaStreamLog} from "../src/ZettaStreamLog.sol";

contract DeployZettaStreamLog is Script {
    function run() external returns (address logAddr) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        ZettaStreamLog logContract = new ZettaStreamLog();
        logAddr = address(logContract);
        vm.stopBroadcast();

        console2.log("ZettaStreamLog deployed at:", logAddr);
        console2.log("Add to .env:");
        console2.log("ZETTA_STREAM_LOG_ADDRESS=", logAddr);
        console2.log("NEXT_PUBLIC_ZETTA_STREAM_LOG_ADDRESS=", logAddr);
    }
}
