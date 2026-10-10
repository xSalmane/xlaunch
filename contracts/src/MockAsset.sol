// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Actif de TEST uniquement (testnet / local) : imite une action tokenisée pour essayer
///         les paires. Le minter (le relayer) peut en créer à volonté. Aucune valeur.
contract MockAsset is ERC20 {
    address public immutable minter;
    uint8 private immutable _decimals;

    error NotMinter();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address minter_) ERC20(name_, symbol_) {
        minter = minter_;
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }
}
