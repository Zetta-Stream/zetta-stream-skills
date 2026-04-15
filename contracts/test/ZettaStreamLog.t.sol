// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ZettaStreamLog} from "../src/ZettaStreamLog.sol";

contract ZettaStreamLogTest is Test {
    ZettaStreamLog logContract;
    address owner = address(0xA11CE);
    address agent = address(0xBEEF);
    address attacker = address(0xDEAD);
    address delegateAddr = address(0xD00D);

    function setUp() public {
        logContract = new ZettaStreamLog();
        vm.prank(owner);
        logContract.authorizeAgent(agent);
    }

    // ------- authorize / revoke -------

    function test_AuthorizeAndRevoke() public {
        assertEq(logContract.authorizedAgent(owner), agent);
        vm.prank(owner);
        logContract.revokeAgent();
        assertEq(logContract.authorizedAgent(owner), address(0));
    }

    function test_RevokeWithoutAgent_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert(ZettaStreamLog.NoAgent.selector);
        logContract.revokeAgent();
    }

    // ------- logRotation -------

    function test_AuthorizedAgent_CanLogRotation() public {
        vm.prank(agent);
        uint256 id = logContract.logRotation(
            owner,
            keccak256("YieldSignal{aave:0.031,uni:0.042,il:0.18}"),
            ZettaStreamLog.Position.AAVE,
            ZettaStreamLog.Position.UNIV4,
            73,
            85,
            42,
            bytes32(uint256(0xCAFE)),
            ZettaStreamLog.DelegateMode.EIP7702,
            "uni fee apr +110bps after IL"
        );
        assertEq(id, 0);
        assertEq(logContract.rotationCount(), 1);

        ZettaStreamLog.Rotation memory r = logContract.rotation(0);
        assertEq(r.owner, owner);
        assertEq(r.agent, agent);
        assertEq(uint8(r.from), uint8(ZettaStreamLog.Position.AAVE));
        assertEq(uint8(r.to), uint8(ZettaStreamLog.Position.UNIV4));
        assertEq(r.confidence, 73);
        assertEq(r.netYieldBps, int32(85));
        assertEq(r.gasSavedBps, 42);
        assertEq(r.batchTxHash, bytes32(uint256(0xCAFE)));
        assertEq(uint8(r.mode), uint8(ZettaStreamLog.DelegateMode.EIP7702));
    }

    function test_NegativeNetYield_Allowed() public {
        vm.prank(agent);
        uint256 id = logContract.logRotation(
            owner,
            bytes32(0),
            ZettaStreamLog.Position.UNIV4,
            ZettaStreamLog.Position.AAVE,
            65,
            -25,
            10,
            bytes32(0),
            ZettaStreamLog.DelegateMode.MULTICALL_FALLBACK,
            "rebalance: il spike"
        );
        assertEq(logContract.rotation(id).netYieldBps, int32(-25));
    }

    function test_UnauthorizedAgent_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert(ZettaStreamLog.NotAuthorized.selector);
        logContract.logRotation(
            owner, bytes32(0),
            ZettaStreamLog.Position.IDLE, ZettaStreamLog.Position.AAVE,
            80, 0, 0, bytes32(0),
            ZettaStreamLog.DelegateMode.EIP7702, "hack"
        );
    }

    function test_Owner_CanLogDirectly() public {
        vm.prank(owner);
        uint256 id = logContract.logRotation(
            owner, bytes32(0),
            ZettaStreamLog.Position.AAVE, ZettaStreamLog.Position.UNIV4,
            98, 60, 5, bytes32(0),
            ZettaStreamLog.DelegateMode.EIP7702, "owner-direct"
        );
        assertEq(logContract.rotation(id).confidence, 98);
    }

    function test_ConfidenceOver100_Reverts() public {
        vm.prank(agent);
        vm.expectRevert(ZettaStreamLog.InvalidConfidence.selector);
        logContract.logRotation(
            owner, bytes32(0),
            ZettaStreamLog.Position.AAVE, ZettaStreamLog.Position.UNIV4,
            101, 0, 0, bytes32(0),
            ZettaStreamLog.DelegateMode.EIP7702, "x"
        );
    }

    function test_ReasonTooLong_Reverts() public {
        bytes memory long = new bytes(141);
        for (uint256 i = 0; i < 141; i++) long[i] = "A";
        vm.prank(agent);
        vm.expectRevert(ZettaStreamLog.ReasonTooLong.selector);
        logContract.logRotation(
            owner, bytes32(0),
            ZettaStreamLog.Position.AAVE, ZettaStreamLog.Position.UNIV4,
            80, 0, 0, bytes32(0),
            ZettaStreamLog.DelegateMode.EIP7702, string(long)
        );
    }

    // ------- logDelegation -------

    function test_LogDelegation_EIP7702() public {
        vm.prank(agent);
        uint256 id = logContract.logDelegation(
            owner, delegateAddr, 42161,
            bytes32(uint256(0xABC)),
            ZettaStreamLog.DelegateMode.EIP7702
        );
        ZettaStreamLog.Delegation memory d = logContract.delegation(id);
        assertEq(d.eoa, owner);
        assertEq(d.delegate, delegateAddr);
        assertEq(d.chainId, 42161);
        assertEq(uint8(d.mode), uint8(ZettaStreamLog.DelegateMode.EIP7702));
        assertEq(d.revoked, false);
    }

    function test_RevokeDelegation() public {
        vm.prank(agent);
        uint256 id = logContract.logDelegation(
            owner, delegateAddr, 42161, bytes32(0),
            ZettaStreamLog.DelegateMode.EIP7702
        );
        vm.prank(owner);
        logContract.revokeDelegation(id);
        assertEq(logContract.delegation(id).revoked, true);
    }

    function test_RevokeDelegation_Unauthorized_Reverts() public {
        vm.prank(agent);
        uint256 id = logContract.logDelegation(
            owner, delegateAddr, 42161, bytes32(0),
            ZettaStreamLog.DelegateMode.EIP7702
        );
        vm.prank(attacker);
        vm.expectRevert(ZettaStreamLog.NotDelegationOwner.selector);
        logContract.revokeDelegation(id);
    }

    function test_RevokeDelegation_Twice_Reverts() public {
        vm.prank(agent);
        uint256 id = logContract.logDelegation(
            owner, delegateAddr, 42161, bytes32(0),
            ZettaStreamLog.DelegateMode.EIP7702
        );
        vm.prank(owner);
        logContract.revokeDelegation(id);
        vm.prank(owner);
        vm.expectRevert(ZettaStreamLog.AlreadyRevoked.selector);
        logContract.revokeDelegation(id);
    }

    function test_RevokeDelegation_Unknown_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ZettaStreamLog.UnknownDelegation.selector);
        logContract.revokeDelegation(99);
    }

    // ------- recent views -------

    function test_RecentRotations_NewestFirst() public {
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(agent);
            logContract.logRotation(
                owner, bytes32(i + 1),
                ZettaStreamLog.Position.AAVE, ZettaStreamLog.Position.UNIV4,
                80, int32(int256(i)) * 10, 0, bytes32(0),
                ZettaStreamLog.DelegateMode.EIP7702, "tick"
            );
        }
        ZettaStreamLog.Rotation[] memory r = logContract.recent(3);
        assertEq(r.length, 3);
        // newest first → signalHash order should be 5,4,3
        assertEq(r[0].signalHash, bytes32(uint256(5)));
        assertEq(r[1].signalHash, bytes32(uint256(4)));
        assertEq(r[2].signalHash, bytes32(uint256(3)));
    }

    function test_Recent_Clamped() public {
        vm.prank(agent);
        logContract.logRotation(
            owner, bytes32(0),
            ZettaStreamLog.Position.AAVE, ZettaStreamLog.Position.UNIV4,
            80, 0, 0, bytes32(0),
            ZettaStreamLog.DelegateMode.EIP7702, "x"
        );
        ZettaStreamLog.Rotation[] memory out = logContract.recent(100);
        assertEq(out.length, 1);
    }

    function test_RotationsFor_IndexesByOwner() public {
        vm.prank(agent);
        logContract.logRotation(
            owner, bytes32(0),
            ZettaStreamLog.Position.AAVE, ZettaStreamLog.Position.UNIV4,
            80, 10, 0, bytes32(0),
            ZettaStreamLog.DelegateMode.EIP7702, "a"
        );
        vm.prank(agent);
        logContract.logRotation(
            owner, bytes32(0),
            ZettaStreamLog.Position.UNIV4, ZettaStreamLog.Position.AAVE,
            90, -5, 0, bytes32(0),
            ZettaStreamLog.DelegateMode.MULTICALL_FALLBACK, "b"
        );
        uint256[] memory ids = logContract.rotationsFor(owner);
        assertEq(ids.length, 2);
        assertEq(ids[0], 0);
        assertEq(ids[1], 1);
    }
}
