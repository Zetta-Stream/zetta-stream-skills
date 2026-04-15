// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ZettaStreamDelegate} from "../src/ZettaStreamDelegate.sol";

contract Sink {
    uint256 public touched;
    function bump() external payable returns (uint256) {
        touched += 1;
        return touched;
    }
    function boom() external pure {
        revert("boom");
    }
    receive() external payable {}
}

contract ZettaStreamDelegateTest is Test {
    ZettaStreamDelegate del;
    Sink seedSink;
    Sink unlistedSink;
    address factory = address(0xFAB);
    address eoa = address(0xE0A);

    function setUp() public {
        seedSink = new Sink();
        unlistedSink = new Sink();
        address[] memory seeds = new address[](1);
        seeds[0] = address(seedSink);
        del = new ZettaStreamDelegate(factory, seeds);
    }

    function test_Constructor_SeedsAllowlist() public view {
        assertTrue(del.allowedTarget(address(seedSink)));
        assertTrue(del.allowedTarget(address(del)));
        assertFalse(del.allowedTarget(address(unlistedSink)));
        assertEq(del.factory(), factory);
    }

    function test_ExecuteBatch_Atomic() public {
        ZettaStreamDelegate.Call[] memory calls = new ZettaStreamDelegate.Call[](2);
        calls[0] = ZettaStreamDelegate.Call({
            to: address(seedSink), value: 0,
            data: abi.encodeWithSignature("bump()")
        });
        calls[1] = ZettaStreamDelegate.Call({
            to: address(seedSink), value: 0,
            data: abi.encodeWithSignature("bump()")
        });
        vm.prank(eoa);
        del.executeBatch(calls);
        assertEq(seedSink.touched(), 2);
    }

    function test_ExecuteBatch_RevertsOnDisallowed() public {
        ZettaStreamDelegate.Call[] memory calls = new ZettaStreamDelegate.Call[](1);
        calls[0] = ZettaStreamDelegate.Call({
            to: address(unlistedSink), value: 0,
            data: abi.encodeWithSignature("bump()")
        });
        vm.prank(eoa);
        vm.expectRevert(
            abi.encodeWithSelector(
                ZettaStreamDelegate.TargetNotAllowed.selector, address(unlistedSink)
            )
        );
        del.executeBatch(calls);
    }

    function test_ExecuteBatch_RevertsOnInnerFailure() public {
        ZettaStreamDelegate.Call[] memory calls = new ZettaStreamDelegate.Call[](2);
        calls[0] = ZettaStreamDelegate.Call({
            to: address(seedSink), value: 0,
            data: abi.encodeWithSignature("bump()")
        });
        calls[1] = ZettaStreamDelegate.Call({
            to: address(seedSink), value: 0,
            data: abi.encodeWithSignature("boom()")
        });
        vm.prank(eoa);
        vm.expectRevert();
        del.executeBatch(calls);
        // first call rolled back atomically
        assertEq(seedSink.touched(), 0);
    }

    function test_SetAllowed_OnlyFactory() public {
        vm.expectRevert(ZettaStreamDelegate.NotFactory.selector);
        del.setAllowed(address(unlistedSink), true);

        vm.prank(factory);
        del.setAllowed(address(unlistedSink), true);
        assertTrue(del.allowedTarget(address(unlistedSink)));

        vm.prank(factory);
        del.setAllowed(address(unlistedSink), false);
        assertFalse(del.allowedTarget(address(unlistedSink)));
    }

    function test_PreviewValue_SumsValues() public view {
        ZettaStreamDelegate.Call[] memory calls = new ZettaStreamDelegate.Call[](3);
        calls[0] = ZettaStreamDelegate.Call({to: address(seedSink), value: 1 ether, data: ""});
        calls[1] = ZettaStreamDelegate.Call({to: address(seedSink), value: 2 ether, data: ""});
        calls[2] = ZettaStreamDelegate.Call({to: address(seedSink), value: 3 ether, data: ""});
        assertEq(del.previewValue(calls), 6 ether);
    }
}
