// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title  ZettaStreamMedal — ERC-721 profit badge minted per profitable rotation
/// @notice Deployed on X Layer (chainId 196). Owner is the agent EOA. tokenURI is a
///         fully on-chain data: URI — no IPFS, no off-chain metadata server.
contract ZettaStreamMedal is ERC721, Ownable {
    using Strings for uint256;

    struct Medal {
        uint256 rotationId;     // ZettaStreamLog rotation id this medal commemorates
        int32 netYieldBps;      // captured net yield in bps
        uint64 mintedAt;
    }

    uint256 private _nextId;
    mapping(uint256 => Medal) public medals;

    event MedalMinted(
        uint256 indexed tokenId,
        uint256 indexed rotationId,
        address indexed to,
        int32 netYieldBps
    );

    error MustBePositiveYield();

    constructor(address initialOwner)
        ERC721("Zetta-Stream Medal", "ZETTA")
        Ownable(initialOwner)
    {}

    /// @notice Mint a new medal commemorating one profitable rotation.
    /// @dev    Owner-only (the agent EOA). `netYieldBps` MUST be > 0; the agent enforces
    ///         this off-chain, and the contract enforces it again here.
    function mintTo(address to, uint256 rotationId, int32 netYieldBps)
        external
        onlyOwner
        returns (uint256 tokenId)
    {
        if (netYieldBps <= 0) revert MustBePositiveYield();
        tokenId = _nextId++;
        medals[tokenId] = Medal({
            rotationId: rotationId,
            netYieldBps: netYieldBps,
            mintedAt: uint64(block.timestamp)
        });
        _safeMint(to, tokenId);
        emit MedalMinted(tokenId, rotationId, to, netYieldBps);
    }

    function totalSupply() external view returns (uint256) {
        return _nextId;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Medal memory m = medals[tokenId];
        string memory yieldStr = string.concat(
            "+", uint256(uint32(m.netYieldBps)).toString(), " bps"
        );
        bytes memory json = abi.encodePacked(
            '{"name":"Zetta-Stream Medal #', tokenId.toString(),
            '","description":"Awarded for a profitable autonomous yield rotation on Zetta-Stream.",',
            '"attributes":[',
            '{"trait_type":"Rotation ID","value":', uint256(m.rotationId).toString(), '},',
            '{"trait_type":"Net Yield (bps)","display_type":"number","value":', uint256(uint32(m.netYieldBps)).toString(), '},',
            '{"trait_type":"Minted At","display_type":"date","value":', uint256(m.mintedAt).toString(), '}',
            '],',
            '"image":"data:image/svg+xml;base64,', Base64.encode(_svg(tokenId, yieldStr)), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function _svg(uint256 tokenId, string memory yieldStr) internal pure returns (bytes memory) {
        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">',
            '<rect width="320" height="320" fill="#0a0a0a"/>',
            '<circle cx="160" cy="160" r="120" fill="none" stroke="#22c55e" stroke-width="4"/>',
            '<text x="160" y="135" font-family="monospace" font-size="14" fill="#86efac" text-anchor="middle">ZETTA-STREAM</text>',
            '<text x="160" y="170" font-family="monospace" font-size="22" fill="#ffffff" text-anchor="middle" font-weight="bold">#', tokenId.toString(), '</text>',
            '<text x="160" y="205" font-family="monospace" font-size="16" fill="#22c55e" text-anchor="middle">', yieldStr, '</text>',
            '</svg>'
        );
    }
}
