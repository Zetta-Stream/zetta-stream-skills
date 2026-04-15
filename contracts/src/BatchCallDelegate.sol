// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  BatchCallDelegate — dual-use delegate for ZettaStream
/// @notice Can be authorized by an EOA via EIP-7702 (Pectra), OR called directly as a
///         plain Multicall contract if the chain doesn't yet support type-0x04 tx.
///         Deployed on X Layer (chainId 196). Runtime-detects support via pectra-probe.
contract BatchCallDelegate {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    error CallFailed(uint256 index, bytes reason);

    event BatchExecuted(address indexed caller, uint256 count, uint256 totalValue);

    /// @notice Execute an array of calls atomically. Reverts on any inner failure.
    /// @dev    In EIP-7702 mode: `msg.sender == address(this) == EOA` (self-call).
    ///         In Multicall mode: any caller, payable receives the bundled value.
    ///         We intentionally don't restrict msg.sender so both paths share logic.
    function executeBatch(Call[] calldata calls) external payable {
        uint256 totalValue;
        for (uint256 i; i < calls.length; ++i) {
            totalValue += calls[i].value;
            (bool ok, bytes memory r) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, r);
        }
        emit BatchExecuted(msg.sender, calls.length, totalValue);
    }

    /// @notice View helper — preview total value needed for a batch (for UI / estimation).
    function previewValue(Call[] calldata calls) external pure returns (uint256 total) {
        for (uint256 i; i < calls.length; ++i) {
            total += calls[i].value;
        }
    }

    receive() external payable {}
}
