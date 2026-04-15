// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  ZettaStreamLog — immutable rotation ledger for the Zetta-Stream agent
/// @notice Deployed on X Layer (chainId 196). Every yield rotation + delegation writes
///         exactly one record. Anyone reads; only owner-authorized agents write.
contract ZettaStreamLog {
    // --------------------------- Types ---------------------------

    enum Position {
        IDLE,
        AAVE,
        UNIV4
    }

    enum DelegateMode {
        EIP7702,
        MULTICALL_FALLBACK
    }

    /// @notice One record per autonomous rotation decision the agent commits on-chain.
    /// @dev    `netYieldBps` is signed: positive means the rotation improved net APY in
    ///         basis points after IL + gas; negative means the agent chose to rebalance
    ///         out of a losing position and accepted a small drag.
    struct Rotation {
        uint64 timestamp;
        address owner;
        address agent;
        bytes32 signalHash;     // keccak256(canonicalJson(YieldSignal))
        Position from;
        Position to;
        uint8 confidence;       // 0-100
        int32 netYieldBps;      // signed bps after IL + gas
        uint32 gasSavedBps;     // savings vs N independent EOA tx baseline (bps of notional)
        bytes32 batchTxHash;    // the EIP-7702 / Multicall batch tx
        DelegateMode mode;
        string reason;          // <=140 bytes
    }

    struct Delegation {
        uint64 timestamp;
        address eoa;
        address delegate;
        uint256 chainId;
        bytes32 authTxHash;
        DelegateMode mode;
        bool revoked;
    }

    // --------------------------- Storage ------------------------

    Rotation[] private _rotations;
    Delegation[] private _delegations;

    mapping(address => uint256[]) private _ownerRotations;
    mapping(address => uint256[]) private _ownerDelegations;
    /// @notice owner -> authorized agent wallet (TEE EVM address)
    mapping(address => address) public authorizedAgent;

    // --------------------------- Events -------------------------

    event AgentAuthorized(address indexed owner, address indexed agent);
    event AgentRevoked(address indexed owner, address indexed previousAgent);
    event RotationLogged(
        uint256 indexed id,
        address indexed owner,
        address indexed agent,
        Position from,
        Position to,
        int32 netYieldBps,
        uint8 confidence
    );
    event DelegationLogged(
        uint256 indexed id,
        address indexed eoa,
        address delegate,
        DelegateMode mode
    );
    event DelegationRevoked(uint256 indexed id, address indexed eoa);

    // --------------------------- Errors -------------------------

    error NotAuthorized();
    error ReasonTooLong();
    error NoAgent();
    error InvalidConfidence();
    error UnknownDelegation();
    error AlreadyRevoked();
    error NotDelegationOwner();

    // --------------------------- Modifiers ----------------------

    modifier onlyAuthorized(address owner) {
        if (msg.sender != authorizedAgent[owner] && msg.sender != owner) {
            revert NotAuthorized();
        }
        _;
    }

    // --------------------------- Agent management ---------------

    function authorizeAgent(address agent) external {
        authorizedAgent[msg.sender] = agent;
        emit AgentAuthorized(msg.sender, agent);
    }

    function revokeAgent() external {
        address prev = authorizedAgent[msg.sender];
        if (prev == address(0)) revert NoAgent();
        delete authorizedAgent[msg.sender];
        emit AgentRevoked(msg.sender, prev);
    }

    // --------------------------- Rotation log ---------------------

    function logRotation(
        address owner,
        bytes32 signalHash,
        Position from,
        Position to,
        uint8 confidence,
        int32 netYieldBps,
        uint32 gasSavedBps,
        bytes32 batchTxHash,
        DelegateMode mode,
        string calldata reason
    ) external onlyAuthorized(owner) returns (uint256 id) {
        if (confidence > 100) revert InvalidConfidence();
        if (bytes(reason).length > 140) revert ReasonTooLong();

        _rotations.push(
            Rotation({
                timestamp: uint64(block.timestamp),
                owner: owner,
                agent: msg.sender,
                signalHash: signalHash,
                from: from,
                to: to,
                confidence: confidence,
                netYieldBps: netYieldBps,
                gasSavedBps: gasSavedBps,
                batchTxHash: batchTxHash,
                mode: mode,
                reason: reason
            })
        );
        id = _rotations.length - 1;
        _ownerRotations[owner].push(id);
        emit RotationLogged(id, owner, msg.sender, from, to, netYieldBps, confidence);
    }

    // --------------------------- Delegation log ------------------

    function logDelegation(
        address eoa,
        address delegate,
        uint256 chainId,
        bytes32 authTxHash,
        DelegateMode mode
    ) external onlyAuthorized(eoa) returns (uint256 id) {
        _delegations.push(
            Delegation({
                timestamp: uint64(block.timestamp),
                eoa: eoa,
                delegate: delegate,
                chainId: chainId,
                authTxHash: authTxHash,
                mode: mode,
                revoked: false
            })
        );
        id = _delegations.length - 1;
        _ownerDelegations[eoa].push(id);
        emit DelegationLogged(id, eoa, delegate, mode);
    }

    function revokeDelegation(uint256 id) external {
        if (id >= _delegations.length) revert UnknownDelegation();
        Delegation storage d = _delegations[id];
        if (d.eoa != msg.sender && authorizedAgent[d.eoa] != msg.sender) {
            revert NotDelegationOwner();
        }
        if (d.revoked) revert AlreadyRevoked();
        d.revoked = true;
        emit DelegationRevoked(id, d.eoa);
    }

    // --------------------------- Views --------------------------

    function rotationCount() external view returns (uint256) {
        return _rotations.length;
    }

    function delegationCount() external view returns (uint256) {
        return _delegations.length;
    }

    function rotation(uint256 id) external view returns (Rotation memory) {
        return _rotations[id];
    }

    function delegation(uint256 id) external view returns (Delegation memory) {
        return _delegations[id];
    }

    function rotationsFor(address owner) external view returns (uint256[] memory) {
        return _ownerRotations[owner];
    }

    function delegationsFor(address owner) external view returns (uint256[] memory) {
        return _ownerDelegations[owner];
    }

    /// @notice Most-recent `n` rotations (newest first), clamped to available count.
    function recent(uint256 n) external view returns (Rotation[] memory out) {
        uint256 total = _rotations.length;
        uint256 take = n > total ? total : n;
        out = new Rotation[](take);
        for (uint256 i = 0; i < take; i++) {
            out[i] = _rotations[total - 1 - i];
        }
    }

    function recentDelegations(uint256 n) external view returns (Delegation[] memory out) {
        uint256 total = _delegations.length;
        uint256 take = n > total ? total : n;
        out = new Delegation[](take);
        for (uint256 i = 0; i < take; i++) {
            out[i] = _delegations[total - 1 - i];
        }
    }
}
