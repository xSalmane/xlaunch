// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {LaunchToken} from "./LaunchToken.sol";

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
}

interface IUniswapV3PoolState {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

/// @title XLaunchFactory
/// @notice Déploie des tokens depuis un relayer (la plateforme paie le gas), crée une pool
///         Uniswap v3 TOKEN/WETH avec liquidité 100 % token (single-sided) et garde la
///         position LP à vie (liquidité verrouillée : aucune fonction ne la retire).
///         100 % de la supply part dans la pool : personne (ni créateur ni plateforme) ne
///         reçoit de tokens au lancement. Le créateur touche uniquement sa part des frais de
///         trading, mise en séquestre sous l'id de son compte X et réclamable plus tard via
///         une signature EIP-712 de l'attester.
contract XLaunchFactory is Ownable2Step, ReentrancyGuard, EIP712, IERC721Receiver {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constantes
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint24 public constant POOL_FEE = 10_000; // 1 %
    int24 public constant TICK_SPACING = 200;
    int24 public constant MAX_TICK = 887_200; // plus grand multiple de 200 <= 887272
    uint16 public constant BPS = 10_000;

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 creatorId,address recipient,uint256 nonce,uint256 deadline)");

    // ---------------------------------------------------------------- immuables
    INonfungiblePositionManager public immutable positionManager;
    address public immutable weth;
    uint16 public immutable creatorFeeBps; // part des frais LP reversée au créateur

    // ---------------------------------------------------------------- état
    address public relayer;
    address public attester;
    address public treasury;

    struct Launch {
        bytes32 creatorId;
        uint256 positionId;
        address pool;
    }

    mapping(address token => Launch) public launches;
    /// @notice séquestre : creatorId => actif (token lancé ou WETH) => montant
    mapping(bytes32 creatorId => mapping(address asset => uint256)) public escrow;
    /// @notice wallet lié après la première réclamation ; les gains futurs y vont directement
    mapping(bytes32 creatorId => address) public boundWallet;
    mapping(bytes32 creatorId => uint256) public nonces;

    // ---------------------------------------------------------------- events
    event TokenLaunched(
        address indexed token, bytes32 indexed creatorId, address pool, uint256 positionId, string name, string symbol
    );
    event FeesCollected(address indexed token, uint256 tokenAmount, uint256 wethAmount);
    event CreatorCredited(bytes32 indexed creatorId, address indexed asset, uint256 amount, bool paidDirect);
    event Claimed(bytes32 indexed creatorId, address indexed recipient, address indexed asset, uint256 amount);
    event WalletBound(bytes32 indexed creatorId, address wallet);
    event RelayerSet(address relayer);
    event AttesterSet(address attester);
    event TreasurySet(address treasury);

    error NotRelayer();
    error ZeroAddress();
    error BadTick();
    error TokenNotBelowWeth();
    error PoolPriceMismatch();
    error UnknownToken();
    error Expired();
    error BadSignature();
    error BadBps();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(
        address owner_,
        INonfungiblePositionManager positionManager_,
        address weth_,
        address relayer_,
        address attester_,
        address treasury_,
        uint16 creatorFeeBps_
    ) Ownable(owner_) EIP712("XLaunch", "1") {
        if (
            address(positionManager_) == address(0) || weth_ == address(0) || relayer_ == address(0)
                || attester_ == address(0) || treasury_ == address(0)
        ) revert ZeroAddress();
        if (creatorFeeBps_ > BPS) revert BadBps();
        positionManager = positionManager_;
        weth = weth_;
        relayer = relayer_;
        attester = attester_;
        treasury = treasury_;
        creatorFeeBps = creatorFeeBps_;
    }

    // ================================================================ launch

    /// @notice Hash du init code du token, pour que le backend calcule l'adresse CREATE2
    ///         et cherche un salt qui donne une adresse < WETH (token = token0).
    function tokenInitCodeHash(string calldata name, string calldata symbol, string calldata image, bytes32 creatorId)
        external
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                type(LaunchToken).creationCode, abi.encode(name, symbol, image, creatorId, TOTAL_SUPPLY)
            )
        );
    }

    /// @param salt         salt CREATE2 trouvé par le backend (adresse token < WETH)
    /// @param sqrtPriceX96 prix initial, légèrement SOUS sqrtRatio(tickLower) pour que la
    ///                     position soit 100 % token0
    /// @param tickLower    borne basse de la position (multiple de 200)
    function launch(
        string calldata name,
        string calldata symbol,
        string calldata image,
        bytes32 creatorId,
        bytes32 salt,
        uint160 sqrtPriceX96,
        int24 tickLower
    ) external onlyRelayer nonReentrant returns (address token, uint256 positionId) {
        if (tickLower % TICK_SPACING != 0 || tickLower >= MAX_TICK || tickLower <= -MAX_TICK) revert BadTick();

        token = address(new LaunchToken{salt: salt}(name, symbol, image, creatorId, TOTAL_SUPPLY));
        if (token >= weth) revert TokenNotBelowWeth();

        // pool + liquidité single-sided
        address pool = positionManager.createAndInitializePoolIfNecessary(token, weth, POOL_FEE, sqrtPriceX96);
        // protection contre une pool pré-créée à un autre prix (adresse CREATE2 prévisible)
        (uint160 currentPrice,,,,,,) = IUniswapV3PoolState(pool).slot0();
        if (currentPrice != sqrtPriceX96) revert PoolPriceMismatch();

        uint256 lpAmount = TOTAL_SUPPLY; // 100 % dans la pool
        IERC20(token).forceApprove(address(positionManager), lpAmount);
        uint256 used;
        (positionId,, used,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token,
                token1: weth,
                fee: POOL_FEE,
                tickLower: tickLower,
                tickUpper: MAX_TICK,
                amount0Desired: lpAmount,
                amount1Desired: 0,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        IERC20(token).forceApprove(address(positionManager), 0);
        // poussière d'arrondi Uniswap (quelques wei) -> brûlée, la plateforme ne garde aucun token
        if (lpAmount > used) IERC20(token).safeTransfer(0x000000000000000000000000000000000000dEaD, lpAmount - used);

        launches[token] = Launch({creatorId: creatorId, positionId: positionId, pool: pool});
        emit TokenLaunched(token, creatorId, pool, positionId, name, symbol);
    }

    // ================================================================ frais

    /// @notice Récupère les frais de trading de la position et les répartit. Appelable par tous.
    function collectFees(address token) public nonReentrant returns (uint256 amountToken, uint256 amountWeth) {
        Launch memory l = launches[token];
        if (l.positionId == 0) revert UnknownToken();

        (amountToken, amountWeth) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: l.positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        emit FeesCollected(token, amountToken, amountWeth);

        _split(l.creatorId, token, amountToken);
        _split(l.creatorId, weth, amountWeth);
    }

    function collectFeesMany(address[] calldata tokens) external {
        for (uint256 i; i < tokens.length; ++i) {
            collectFees(tokens[i]);
        }
    }

    function _split(bytes32 creatorId, address asset, uint256 amount) internal {
        if (amount == 0) return;
        uint256 creatorPart = (amount * creatorFeeBps) / BPS;
        if (creatorPart > 0) _creditCreator(creatorId, asset, creatorPart);
        if (amount > creatorPart) IERC20(asset).safeTransfer(treasury, amount - creatorPart);
    }

    function _creditCreator(bytes32 creatorId, address asset, uint256 amount) internal {
        address wallet = boundWallet[creatorId];
        if (wallet != address(0)) {
            IERC20(asset).safeTransfer(wallet, amount);
            emit CreatorCredited(creatorId, asset, amount, true);
        } else {
            escrow[creatorId][asset] += amount;
            emit CreatorCredited(creatorId, asset, amount, false);
        }
    }

    // ================================================================ réclamation

    /// @notice Lie un wallet au compte X et lui envoie le séquestre. Appelable par n'importe qui
    ///         (en pratique le relayer, pour que l'utilisateur n'ait pas besoin de gas).
    /// @param assets liste des actifs à libérer (tokens lancés + WETH)
    function claim(
        bytes32 creatorId,
        address recipient,
        address[] calldata assets,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert Expired();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_TYPEHASH, creatorId, recipient, nonces[creatorId]++, deadline))
        );
        if (ECDSA.recover(digest, signature) != attester) revert BadSignature();

        if (boundWallet[creatorId] != recipient) {
            boundWallet[creatorId] = recipient;
            emit WalletBound(creatorId, recipient);
        }

        for (uint256 i; i < assets.length; ++i) {
            uint256 amount = escrow[creatorId][assets[i]];
            if (amount == 0) continue;
            escrow[creatorId][assets[i]] = 0;
            IERC20(assets[i]).safeTransfer(recipient, amount);
            emit Claimed(creatorId, recipient, assets[i], amount);
        }
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ================================================================ admin

    function setRelayer(address relayer_) external onlyOwner {
        if (relayer_ == address(0)) revert ZeroAddress();
        relayer = relayer_;
        emit RelayerSet(relayer_);
    }

    function setAttester(address attester_) external onlyOwner {
        if (attester_ == address(0)) revert ZeroAddress();
        attester = attester_;
        emit AttesterSet(attester_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
