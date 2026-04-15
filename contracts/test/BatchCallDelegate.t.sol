// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BatchCallDelegate} from "../src/BatchCallDelegate.sol";

contract Target {
    uint256 public x;
    mapping(address => uint256) public deposited;

    event TargetCalled(uint256 x);

    function setX(uint256 v) external {
        x = v;
        emit TargetCalled(v);
    }

    function deposit() external payable {
        deposited[msg.sender] += msg.value;
    }

    function boom() external pure {
        revert("boom");
    }
}

contract BatchCallDelegateTest is Test {
    BatchCallDelegate batch;
    Target target;
    address caller = address(0xA11CE);

    function setUp() public {
        batch = new BatchCallDelegate();
        target = new Target();
        vm.deal(caller, 10 ether);
    }

    function test_ExecuteBatch_MultipleCalls() public {
        BatchCallDelegate.Call[] memory calls = new BatchCallDelegate.Call[](3);
        calls[0] = BatchCallDelegate.Call({
            to: address(target),
            value: 0,
            data: abi.encodeWithSelector(Target.setX.selector, uint256(42))
        });
        calls[1] = BatchCallDelegate.Call({
            to: address(target),
            value: 0,
            data: abi.encodeWithSelector(Target.setX.selector, uint256(7))
        });
        calls[2] = BatchCallDelegate.Call({
            to: address(target),
            value: 0,
            data: abi.encodeWithSelector(Target.setX.selector, uint256(99))
        });
        vm.prank(caller);
        batch.executeBatch(calls);
        assertEq(target.x(), 99);
    }

    function test_ExecuteBatch_WithValue() public {
        BatchCallDelegate.Call[] memory calls = new BatchCallDelegate.Call[](2);
        calls[0] = BatchCallDelegate.Call({
            to: address(target),
            value: 0.3 ether,
            data: abi.encodeWithSelector(Target.deposit.selector)
        });
        calls[1] = BatchCallDelegate.Call({
            to: address(target),
            value: 0.7 ether,
            data: abi.encodeWithSelector(Target.deposit.selector)
        });
        vm.prank(caller);
        batch.executeBatch{value: 1 ether}(calls);
        // Both deposits recorded from the BatchCallDelegate contract (msg.sender in sub-calls)
        assertEq(target.deposited(address(batch)), 1 ether);
    }

    function test_ExecuteBatch_OneReverts_WholeReverts() public {
        BatchCallDelegate.Call[] memory calls = new BatchCallDelegate.Call[](2);
        calls[0] = BatchCallDelegate.Call({
            to: address(target),
            value: 0,
            data: abi.encodeWithSelector(Target.setX.selector, uint256(42))
        });
        calls[1] = BatchCallDelegate.Call({
            to: address(target),
            value: 0,
            data: abi.encodeWithSelector(Target.boom.selector)
        });
        vm.prank(caller);
        vm.expectRevert();
        batch.executeBatch(calls);
        // x should NOT have updated — the whole batch reverted
        assertEq(target.x(), 0);
    }

    function test_PreviewValue() public view {
        BatchCallDelegate.Call[] memory calls = new BatchCallDelegate.Call[](3);
        calls[0].value = 1;
        calls[1].value = 2;
        calls[2].value = 3;
        assertEq(batch.previewValue(calls), 6);
    }

    function test_ExecuteBatch_EmitsEvent() public {
        BatchCallDelegate.Call[] memory calls = new BatchCallDelegate.Call[](1);
        calls[0] = BatchCallDelegate.Call({
            to: address(target),
            value: 0,
            data: abi.encodeWithSelector(Target.setX.selector, uint256(1))
        });
        vm.expectEmit(true, false, false, true);
        emit BatchCallDelegate.BatchExecuted(caller, 1, 0);
        vm.prank(caller);
        batch.executeBatch(calls);
    }
}
