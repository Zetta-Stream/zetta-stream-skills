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

    // ------- logIntent -------

    function test_AuthorizedAgent_CanLogIntent() public {
        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = bytes32(uint256(0x1));
        hashes[1] = bytes32(uint256(0x2));

        vm.prank(agent);
        uint256 id = logContract.logIntent(
            owner,
            keccak256("swap 0.1 OKB to USDC"),
            ZettaStreamLog.Verdict.EXECUTED,
            95,
            123456,
            hashes,
            "batch 3 steps, 58% gas saved"
        );
        assertEq(id, 0);
        assertEq(logContract.entryCount(), 1);

        ZettaStreamLog.Entry memory e = logContract.entry(0);
        assertEq(e.owner, owner);
        assertEq(e.agent, agent);
        assertEq(uint8(e.verdict), uint8(ZettaStreamLog.Verdict.EXECUTED));
        assertEq(e.confidence, 95);
        assertEq(e.gasSaved, 123456);
        assertEq(e.txHashes.length, 2);
        assertEq(e.txHashes[0], bytes32(uint256(0x1)));
    }

    function test_UnauthorizedAgent_Reverts() public {
        bytes32[] memory hashes = new bytes32[](0);
        vm.prank(attacker);
        vm.expectRevert(ZettaStreamLog.NotAuthorized.selector);
        logContract.logIntent(
            owner,
            bytes32(0),
            ZettaStreamLog.Verdict.APPROVED,
            80,
            0,
            hashes,
            "hack"
        );
    }

    function test_Owner_CanLogDirectly() public {
        bytes32[] memory hashes = new bytes32[](0);
        vm.prank(owner);
        uint256 id = logContract.logIntent(
            owner,
            bytes32(0),
            ZettaStreamLog.Verdict.REJECTED,
            98,
            0,
            hashes,
            "phishing vault"
        );
        assertEq(id, 0);
        ZettaStreamLog.Entry memory e = logContract.entry(id);
        assertEq(uint8(e.verdict), uint8(ZettaStreamLog.Verdict.REJECTED));
    }

    function test_ConfidenceOver100_Reverts() public {
        bytes32[] memory hashes = new bytes32[](0);
        vm.prank(agent);
        vm.expectRevert(ZettaStreamLog.InvalidConfidence.selector);
        logContract.logIntent(owner, bytes32(0), ZettaStreamLog.Verdict.APPROVED, 101, 0, hashes, "x");
    }

    function test_ReasonTooLong_Reverts() public {
        bytes memory long = new bytes(141);
        for (uint256 i = 0; i < 141; i++) long[i] = "A";
        bytes32[] memory hashes = new bytes32[](0);
        vm.prank(agent);
        vm.expectRevert(ZettaStreamLog.ReasonTooLong.selector);
        logContract.logIntent(owner, bytes32(0), ZettaStreamLog.Verdict.APPROVED, 80, 0, hashes, string(long));
    }

    // ------- logDelegation -------

    function test_LogDelegation_EIP7702() public {
        vm.prank(agent);
        uint256 id = logContract.logDelegation(
            owner,
            delegateAddr,
            196,
            bytes32(uint256(0xABC)),
            ZettaStreamLog.DelegateMode.EIP7702
        );
        assertEq(id, 0);
        ZettaStreamLog.Delegation memory d = logContract.delegation(0);
        assertEq(d.eoa, owner);
        assertEq(d.delegate, delegateAddr);
        assertEq(d.chainId, 196);
        assertEq(uint8(d.mode), uint8(ZettaStreamLog.DelegateMode.EIP7702));
        assertEq(d.revoked, false);
    }

    function test_LogDelegation_Multicall() public {
        vm.prank(agent);
        uint256 id = logContract.logDelegation(
            owner,
            delegateAddr,
            196,
            bytes32(uint256(0xDEF)),
            ZettaStreamLog.DelegateMode.MULTICALL_FALLBACK
        );
        ZettaStreamLog.Delegation memory d = logContract.delegation(id);
        assertEq(uint8(d.mode), uint8(ZettaStreamLog.DelegateMode.MULTICALL_FALLBACK));
    }

    function test_RevokeDelegation() public {
        vm.prank(agent);
        uint256 id = logContract.logDelegation(
            owner, delegateAddr, 196, bytes32(0), ZettaStreamLog.DelegateMode.EIP7702
        );
        vm.prank(owner);
        logContract.revokeDelegation(id);
        assertEq(logContract.delegation(id).revoked, true);
    }

    function test_RevokeDelegation_Unauthorized_Reverts() public {
        vm.prank(agent);
        uint256 id = logContract.logDelegation(
            owner, delegateAddr, 196, bytes32(0), ZettaStreamLog.DelegateMode.EIP7702
        );
        vm.prank(attacker);
        vm.expectRevert(ZettaStreamLog.NotDelegationOwner.selector);
        logContract.revokeDelegation(id);
    }

    function test_RevokeDelegation_Twice_Reverts() public {
        vm.prank(agent);
        uint256 id = logContract.logDelegation(
            owner, delegateAddr, 196, bytes32(0), ZettaStreamLog.DelegateMode.EIP7702
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

    function test_RecentEntries_NewestFirst() public {
        bytes32[] memory hashes = new bytes32[](0);
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(agent);
            logContract.logIntent(
                owner,
                bytes32(i + 1),
                ZettaStreamLog.Verdict.EXECUTED,
                80,
                uint32(i * 100),
                hashes,
                "step"
            );
        }
        ZettaStreamLog.Entry[] memory recent = logContract.recent(3);
        assertEq(recent.length, 3);
        // newest first → intentHash order should be 5,4,3
        assertEq(recent[0].intentHash, bytes32(uint256(5)));
        assertEq(recent[1].intentHash, bytes32(uint256(4)));
        assertEq(recent[2].intentHash, bytes32(uint256(3)));
    }

    function test_Recent_Clamped() public {
        bytes32[] memory hashes = new bytes32[](0);
        vm.prank(agent);
        logContract.logIntent(owner, bytes32(0), ZettaStreamLog.Verdict.APPROVED, 80, 0, hashes, "x");
        ZettaStreamLog.Entry[] memory out = logContract.recent(100);
        assertEq(out.length, 1);
    }

    function test_EntriesFor_IndexesByOwner() public {
        bytes32[] memory hashes = new bytes32[](0);
        vm.prank(agent);
        logContract.logIntent(owner, bytes32(0), ZettaStreamLog.Verdict.APPROVED, 80, 0, hashes, "x");
        vm.prank(agent);
        logContract.logIntent(owner, bytes32(0), ZettaStreamLog.Verdict.REJECTED, 90, 0, hashes, "y");
        uint256[] memory ids = logContract.entriesFor(owner);
        assertEq(ids.length, 2);
        assertEq(ids[0], 0);
        assertEq(ids[1], 1);
    }
}
