// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  ZettaStreamDelegate — EIP-7702 batch target with per-target allowlist
/// @notice Deployed on Arbitrum (chainId 42161). Either authorized via EIP-7702 (Pectra)
///         or invoked directly as a Multicall fallback. The allowlist is the firewall's
///         on-chain backstop: even if the agent is compromised, only pre-approved targets
///         (Aave Pool, UniV4 PositionManager, USDC, OKX router, the Log) can ever be hit.
contract ZettaStreamDelegate {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    address public immutable factory;
    mapping(address => bool) public allowedTarget;

    error CallFailed(uint256 index, bytes reason);
    error TargetNotAllowed(address target);
    error NotFactory();
    error ZeroAddress();

    event BatchExecuted(address indexed caller, uint256 count, uint256 totalValue);
    event TargetAllowedSet(address indexed target, bool allowed);

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    constructor(address factory_, address[] memory seeds) {
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        // self-call is always allowed (sub-batches, view helpers)
        allowedTarget[address(this)] = true;
        emit TargetAllowedSet(address(this), true);
        for (uint256 i; i < seeds.length; ++i) {
            address t = seeds[i];
            if (t == address(0)) revert ZeroAddress();
            allowedTarget[t] = true;
            emit TargetAllowedSet(t, true);
        }
    }

    /// @notice Add or remove a target from the runtime allowlist. Factory-only.
    /// @dev    Lets ops widen the allowlist at runtime (e.g. when OKX rotates router
    ///         addresses). The factory key is a multisig in production.
    function setAllowed(address t, bool ok) external onlyFactory {
        if (t == address(0)) revert ZeroAddress();
        allowedTarget[t] = ok;
        emit TargetAllowedSet(t, ok);
    }

    /// @notice Execute an array of calls atomically. Reverts on any inner failure or
    ///         disallowed target.
    /// @dev    EIP-7702 mode: `msg.sender == address(this) == EOA` (self-call).
    ///         Multicall mode: any caller, payable receives the bundled value.
    function executeBatch(Call[] calldata calls) external payable {
        uint256 totalValue;
        for (uint256 i; i < calls.length; ++i) {
            address to = calls[i].to;
            if (!allowedTarget[to]) revert TargetNotAllowed(to);
            totalValue += calls[i].value;
            (bool ok, bytes memory r) = to.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, r);
        }
        emit BatchExecuted(msg.sender, calls.length, totalValue);
    }

    /// @notice View helper — preview total value needed for a batch (UI/estimation).
    function previewValue(Call[] calldata calls) external pure returns (uint256 total) {
        for (uint256 i; i < calls.length; ++i) {
            total += calls[i].value;
        }
    }

    receive() external payable {}
}
