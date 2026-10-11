// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 { function transfer(address, uint256) external returns (bool); }
interface IPool {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external returns (int256 amount0, int256 amount1);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// Swap direct sur la pool, comme le font les bots de trading (sans passer par un router Uniswap).
/// Le contrat paie la pool avec ce qu'il détient ; on lui envoie l'actif d'entrée avant d'appeler swap().
contract BotSwapper {
    uint160 constant MIN_SQRT = 4295128740;
    uint160 constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;
    address pool;

    function swap(address pool_, address tokenIn, uint256 amountIn, address to) external returns (uint256 out) {
        pool = pool_;
        bool zeroForOne = tokenIn == IPool(pool_).token0();
        (int256 a0, int256 a1) = IPool(pool_).swap(to, zeroForOne, int256(amountIn), zeroForOne ? MIN_SQRT : MAX_SQRT, abi.encode(tokenIn));
        out = uint256(-(zeroForOne ? a1 : a0));
        pool = address(0);
    }

    function uniswapV3SwapCallback(int256 a0, int256 a1, bytes calldata data) external {
        require(msg.sender == pool, "pool");
        address tokenIn = abi.decode(data, (address));
        IERC20(tokenIn).transfer(msg.sender, uint256(a0 > 0 ? a0 : a1));
    }
}
