// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Token ERC-20 à supply fixe, sans owner ni mint. Toute la supply est
///         envoyée à la factory au déploiement.
contract LaunchToken is ERC20 {
    string public image;
    /// @notice keccak256("x:" + id numérique du compte X du créateur)
    bytes32 public immutable creatorId;
    address public immutable factory;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory image_,
        bytes32 creatorId_,
        uint256 supply_
    ) ERC20(name_, symbol_) {
        image = image_;
        creatorId = creatorId_;
        factory = msg.sender;
        _mint(msg.sender, supply_);
    }
}
