// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  TestVault — minimal "staker" fixture for the gas-save demo scenario
/// @notice Used as the target for STAKE/DEPOSIT steps in scenario 2. Tracks who
///         deposited how much; no token movement (the batch's APPROVE/transfer is
///         semantically a no-op in this demo — we only care that the 3-step batch
///         executes atomically on X Layer).
contract TestVault {
    mapping(address => uint256) public balances;
    uint256 public totalDeposited;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    function deposit(uint256 amount) external {
        balances[msg.sender] += amount;
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        balances[msg.sender] -= amount;
        totalDeposited -= amount;
        emit Withdrawn(msg.sender, amount);
    }
}
