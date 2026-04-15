// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  ZettaStreamLog — immutable audit ledger for ZettaStream Agentic Kernel
/// @author OKX Onchain OS Hackathon submission
/// @notice Every intent verdict + EIP-7702 delegation write one entry here.
///         Deployed on X Layer (chainId 196). Anyone reads; only pre-authorized agents write.
contract ZettaStreamLog {
    // --------------------------- Types ---------------------------

    enum Verdict {
        PENDING,
        APPROVED,
        REJECTED,
        EXECUTED
    }

    enum DelegateMode {
        EIP7702,
        MULTICALL_FALLBACK
    }

    struct Entry {
        uint64 timestamp;
        address owner;
        address agent;
        bytes32 intentHash;
        Verdict verdict;
        uint8 confidence;     // 0-100
        uint32 gasSaved;      // gwei-scaled saving vs N independent EOA tx baseline
        bytes32[] txHashes;   // inner call hashes (empty for REJECTED)
        string reason;        // <=140 bytes
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

    Entry[] private _entries;
    Delegation[] private _delegations;

    mapping(address => uint256[]) private _ownerEntries;
    mapping(address => uint256[]) private _ownerDelegations;
    /// @notice owner -> authorized agent wallet
    mapping(address => address) public authorizedAgent;

    // --------------------------- Events -------------------------

    event AgentAuthorized(address indexed owner, address indexed agent);
    event AgentRevoked(address indexed owner, address indexed previousAgent);
    event IntentLogged(
        uint256 indexed id,
        address indexed owner,
        address indexed agent,
        Verdict verdict,
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

    // --------------------------- Intent log ---------------------

    function logIntent(
        address owner,
        bytes32 intentHash,
        Verdict verdict,
        uint8 confidence,
        uint32 gasSaved,
        bytes32[] calldata txHashes,
        string calldata reason
    ) external onlyAuthorized(owner) returns (uint256 id) {
        if (confidence > 100) revert InvalidConfidence();
        if (bytes(reason).length > 140) revert ReasonTooLong();

        _entries.push(
            Entry({
                timestamp: uint64(block.timestamp),
                owner: owner,
                agent: msg.sender,
                intentHash: intentHash,
                verdict: verdict,
                confidence: confidence,
                gasSaved: gasSaved,
                txHashes: txHashes,
                reason: reason
            })
        );
        id = _entries.length - 1;
        _ownerEntries[owner].push(id);
        emit IntentLogged(id, owner, msg.sender, verdict, confidence);
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

    function entryCount() external view returns (uint256) {
        return _entries.length;
    }

    function delegationCount() external view returns (uint256) {
        return _delegations.length;
    }

    function entry(uint256 id) external view returns (Entry memory) {
        return _entries[id];
    }

    function delegation(uint256 id) external view returns (Delegation memory) {
        return _delegations[id];
    }

    function entriesFor(address owner) external view returns (uint256[] memory) {
        return _ownerEntries[owner];
    }

    function delegationsFor(address owner) external view returns (uint256[] memory) {
        return _ownerDelegations[owner];
    }

    /// @notice Most-recent `n` entries (newest first), clamped to available count.
    function recent(uint256 n) external view returns (Entry[] memory out) {
        uint256 total = _entries.length;
        uint256 take = n > total ? total : n;
        out = new Entry[](take);
        for (uint256 i = 0; i < take; i++) {
            out[i] = _entries[total - 1 - i];
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
