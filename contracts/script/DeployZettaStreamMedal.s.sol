// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ZettaStreamMedal} from "../src/ZettaStreamMedal.sol";

/// @notice Deploys ZettaStreamMedal to X Layer (chainId 196). Owner is the agent EOA
///         (set via MEDAL_OWNER_ADDRESS). The agent calls `mintTo` from its TEE wallet
///         after every profitable rotation.
contract DeployZettaStreamMedal is Script {
    function run() external returns (address medalAddr) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agentOwner = vm.envAddress("MEDAL_OWNER_ADDRESS");

        vm.startBroadcast(pk);
        ZettaStreamMedal m = new ZettaStreamMedal(agentOwner);
        medalAddr = address(m);
        vm.stopBroadcast();

        console2.log("ZettaStreamMedal deployed at:", medalAddr);
        console2.log("Owner (mint authority):      ", agentOwner);
        console2.log("Add to .env:");
        console2.log("ZETTA_STREAM_MEDAL_ADDRESS=", medalAddr);
        console2.log("NEXT_PUBLIC_ZETTA_STREAM_MEDAL_ADDRESS=", medalAddr);
    }
}
