// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ZettaStreamMedal} from "../src/ZettaStreamMedal.sol";

contract ZettaStreamMedalTest is Test {
    ZettaStreamMedal medal;
    address agentOwner = address(0xA1);
    address recipient = address(0xB0B);
    address attacker = address(0xDEAD);

    function setUp() public {
        medal = new ZettaStreamMedal(agentOwner);
    }

    function test_OwnerCanMint_PositiveYield() public {
        vm.prank(agentOwner);
        uint256 tokenId = medal.mintTo(recipient, 7, 85);
        assertEq(tokenId, 0);
        assertEq(medal.ownerOf(tokenId), recipient);
        assertEq(medal.totalSupply(), 1);

        (uint256 rotationId, int32 netYieldBps, uint64 mintedAt) = medal.medals(tokenId);
        assertEq(rotationId, 7);
        assertEq(netYieldBps, int32(85));
        assertGt(mintedAt, 0);
    }

    function test_NonOwner_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert();
        medal.mintTo(recipient, 1, 50);
    }

    function test_ZeroYield_Reverts() public {
        vm.prank(agentOwner);
        vm.expectRevert(ZettaStreamMedal.MustBePositiveYield.selector);
        medal.mintTo(recipient, 1, 0);
    }

    function test_NegativeYield_Reverts() public {
        vm.prank(agentOwner);
        vm.expectRevert(ZettaStreamMedal.MustBePositiveYield.selector);
        medal.mintTo(recipient, 1, -5);
    }

    function test_TokenURI_ReturnsDataUri() public {
        vm.prank(agentOwner);
        uint256 tokenId = medal.mintTo(recipient, 9, 120);
        string memory uri = medal.tokenURI(tokenId);
        // basic sanity — starts with the data: prefix
        bytes memory u = bytes(uri);
        assertGt(u.length, 0);
        assertEq(u[0], "d");
        assertEq(u[1], "a");
        assertEq(u[2], "t");
        assertEq(u[3], "a");
    }

    function test_Counter_Monotonic() public {
        vm.startPrank(agentOwner);
        assertEq(medal.mintTo(recipient, 1, 10), 0);
        assertEq(medal.mintTo(recipient, 2, 20), 1);
        assertEq(medal.mintTo(recipient, 3, 30), 2);
        vm.stopPrank();
        assertEq(medal.totalSupply(), 3);
    }
}
