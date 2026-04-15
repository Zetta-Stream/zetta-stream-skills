// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestVault} from "../src/TestVault.sol";

contract TestVaultTest is Test {
    TestVault vault;
    address alice = address(0xA11CE);

    function setUp() public {
        vault = new TestVault();
    }

    function test_DepositIncrements() public {
        vm.prank(alice);
        vault.deposit(100);
        assertEq(vault.balances(alice), 100);
        assertEq(vault.totalDeposited(), 100);
    }

    function test_WithdrawDecrements() public {
        vm.prank(alice);
        vault.deposit(100);
        vm.prank(alice);
        vault.withdraw(40);
        assertEq(vault.balances(alice), 60);
        assertEq(vault.totalDeposited(), 60);
    }

    function test_WithdrawInsufficient_Reverts() public {
        vm.prank(alice);
        vm.expectRevert("insufficient");
        vault.withdraw(1);
    }
}
