// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// WETH minimal pour les tests locaux (placé à 0x4200…0006 via anvil_setCode)
contract WETH9 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    function decimals() external pure returns (uint8) { return 18; }
    function name() external pure returns (string memory) { return "Wrapped Ether"; }
    function symbol() external pure returns (string memory) { return "WETH"; }
    receive() external payable { deposit(); }
    function deposit() public payable { balanceOf[msg.sender] += msg.value; emit Transfer(address(0), msg.sender, msg.value); }
    function withdraw(uint256 wad) external { balanceOf[msg.sender] -= wad; payable(msg.sender).transfer(wad); }
    function totalSupply() external view returns (uint256) { return address(this).balance; }
    function approve(address s, uint256 wad) external returns (bool) { allowance[msg.sender][s] = wad; emit Approval(msg.sender, s, wad); return true; }
    function transfer(address to, uint256 wad) external returns (bool) { return transferFrom(msg.sender, to, wad); }
    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) allowance[src][msg.sender] -= wad;
        balanceOf[src] -= wad; balanceOf[dst] += wad; emit Transfer(src, dst, wad); return true;
    }
}
