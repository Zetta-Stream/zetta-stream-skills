// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ZettaStreamDelegate} from "../src/ZettaStreamDelegate.sol";

/// @notice Deploys ZettaStreamDelegate to Arbitrum (chainId 42161) and seeds the
///         allowlist with Aave V3 Pool, UniV4 PositionManager, USDC, and (optionally)
///         the OKX DEX router. The factory key (multisig in prod) can extend the
///         allowlist later via setAllowed.
contract DeployZettaStreamDelegate is Script {
    function run() external returns (address delegateAddr) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address factory = vm.envAddress("DELEGATE_FACTORY_ADDRESS");
        address aavePool = vm.envAddress("AAVE_V3_POOL");
        address uniPm = vm.envOr("UNI_V4_POSITION_MANAGER", address(0));
        address usdc = vm.envAddress("USDC_ADDRESS");
        address okxRouter = vm.envOr("OKX_DEX_ROUTER", address(0));

        // Assemble seed list, skipping zero-address entries so ops can extend later
        // via `setAllowed` when addresses (UniV4 PM, OKX router) are confirmed.
        address[] memory buf = new address[](4);
        uint256 n;
        buf[n++] = aavePool;
        buf[n++] = usdc;
        if (uniPm != address(0)) buf[n++] = uniPm;
        if (okxRouter != address(0)) buf[n++] = okxRouter;

        address[] memory seeds = new address[](n);
        for (uint256 i = 0; i < n; i++) seeds[i] = buf[i];

        vm.startBroadcast(pk);
        ZettaStreamDelegate d = new ZettaStreamDelegate(factory, seeds);
        delegateAddr = address(d);
        vm.stopBroadcast();

        console2.log("ZettaStreamDelegate deployed at:", delegateAddr);
        console2.log("Factory (allowlist admin):     ", factory);
        for (uint256 i = 0; i < seeds.length; i++) {
            console2.log("  seed allowed:", seeds[i]);
        }
        console2.log("Add to .env:");
        console2.log("ZETTA_STREAM_DELEGATE_ADDRESS=", delegateAddr);
        console2.log("NEXT_PUBLIC_ZETTA_STREAM_DELEGATE_ADDRESS=", delegateAddr);
    }
}
