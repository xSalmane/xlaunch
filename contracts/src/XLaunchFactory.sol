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

/// @title XLaunchFactory (v2)
/// @notice Déploie des tokens depuis un relayer (la plateforme paie le gas) et crée une pool
///         Uniswap v3 TOKEN/ACTIF, où ACTIF est choisi dans une liste blanche tenue par l'owner :
///         WETH, USDC, actions tokenisées… La pool est créée avec une liquidité 100 % token
///         (single-sided) et la position LP reste à vie dans ce contrat (liquidité verrouillée).
///         Personne ne reçoit de tokens au lancement. Le créateur touche sa part des frais de
///         trading, dans les deux actifs de la paire, mise en séquestre sous l'id de son compte X
///         et réclamable plus tard via une signature EIP-712 de l'attester.
contract XLaunchFactory is Ownable2Step, ReentrancyGuard, EIP712, IERC721Receiver {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constantes
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint24 public constant POOL_FEE = 10_000; // 1 %
    int24 public constant TICK_SPACING = 200;
    int24 public constant MAX_TICK = 887_200; // plus grand multiple de 200 <= 887272
    uint16 public constant BPS = 10_000;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

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

    /// @notice actifs autorisés comme seconde moitié de la paire (WETH, USDC, actions…)
    mapping(address asset => bool) public quoteAllowed;

    struct Launch {
        bytes32 creatorId;
        uint256 positionId;
        address pool;
        address quote;
        bool tokenIsToken0;
    }

    mapping(address token => Launch) public launches;
    /// @notice séquestre : creatorId => actif (token lancé ou actif de paire) => montant
    mapping(bytes32 creatorId => mapping(address asset => uint256)) public escrow;
    /// @notice frais plateforme dont le transfert a échoué (actif en pause…), récupérables plus tard
    mapping(address asset => uint256) public treasuryOwed;
    /// @notice wallet lié après la première réclamation ; les gains futurs y vont directement
    mapping(bytes32 creatorId => address) public boundWallet;
    mapping(bytes32 creatorId => uint256) public nonces;

    // ---------------------------------------------------------------- events
    event TokenLaunched(
        address indexed token,
        bytes32 indexed creatorId,
        address indexed quote,
        address pool,
        uint256 positionId,
        bool tokenIsToken0,
        string name,
        string symbol
    );
    event FeesCollected(address indexed token, uint256 tokenAmount, uint256 quoteAmount);
    event CreatorCredited(bytes32 indexed creatorId, address indexed asset, uint256 amount, bool paidDirect);
    event Claimed(bytes32 indexed creatorId, address indexed recipient, address indexed asset, uint256 amount);
    event WalletBound(bytes32 indexed creatorId, address wallet);
    event QuoteSet(address indexed asset, bool allowed);
    event RelayerSet(address relayer);
    event AttesterSet(address attester);
    event TreasurySet(address treasury);

    error NotRelayer();
    error ZeroAddress();
    error BadTick();
    error QuoteNotAllowed();
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
        quoteAllowed[weth_] = true;
        emit QuoteSet(weth_, true);
    }

    // ================================================================ launch

    /// @notice Hash du init code du token, pour que le backend prédise l'adresse CREATE2
    ///         (et donc le sens token0/token1 de la pool) avant d'envoyer la transaction.
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

    /// @param quote        actif de la paire (doit être dans la liste blanche)
    /// @param sqrtPriceX96 prix initial de la pool. Il est placé juste hors de la plage pour que la
    ///                     position soit 100 % token : sous tickBound si le token est token0,
    ///                     au-dessus si le token est token1
    /// @param tickBound    si token0 : borne basse (plage [tickBound, MAX]) ;
    ///                     si token1 : borne haute (plage [-MAX, tickBound]). Multiple de 200.
    function launch(
        string calldata name,
        string calldata symbol,
        string calldata image,
        bytes32 creatorId,
        bytes32 salt,
        address quote,
        uint160 sqrtPriceX96,
        int24 tickBound
    ) external onlyRelayer nonReentrant returns (address token, uint256 positionId) {
        if (!quoteAllowed[quote]) revert QuoteNotAllowed();
        if (tickBound % TICK_SPACING != 0 || tickBound >= MAX_TICK || tickBound <= -MAX_TICK) revert BadTick();

        token = address(new LaunchToken{salt: salt}(name, symbol, image, creatorId, TOTAL_SUPPLY));
        bool isToken0 = token < quote;
        (address t0, address t1) = isToken0 ? (token, quote) : (quote, token);

        address pool = positionManager.createAndInitializePoolIfNecessary(t0, t1, POOL_FEE, sqrtPriceX96);
        // protection contre une pool pré-créée à un autre prix (adresse CREATE2 prévisible)
        (uint160 currentPrice,,,,,,) = IUniswapV3PoolState(pool).slot0();
        if (currentPrice != sqrtPriceX96) revert PoolPriceMismatch();

        IERC20(token).forceApprove(address(positionManager), TOTAL_SUPPLY);
        uint256 used0;
        uint256 used1;
        (positionId,, used0, used1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: t0,
                token1: t1,
                fee: POOL_FEE,
                tickLower: isToken0 ? tickBound : -MAX_TICK,
                tickUpper: isToken0 ? MAX_TICK : tickBound,
                amount0Desired: isToken0 ? TOTAL_SUPPLY : 0,
                amount1Desired: isToken0 ? 0 : TOTAL_SUPPLY,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        IERC20(token).forceApprove(address(positionManager), 0);
        uint256 used = isToken0 ? used0 : used1;
        // poussière d'arrondi Uniswap (quelques wei) -> brûlée, la plateforme ne garde aucun token
        if (TOTAL_SUPPLY > used) IERC20(token).safeTransfer(DEAD, TOTAL_SUPPLY - used);

        launches[token] =
            Launch({creatorId: creatorId, positionId: positionId, pool: pool, quote: quote, tokenIsToken0: isToken0});
        emit TokenLaunched(token, creatorId, quote, pool, positionId, isToken0, name, symbol);
    }

    // ================================================================ frais

    /// @notice Récupère les frais de trading de la position et les répartit. Appelable par tous.
    function collectFees(address token) public nonReentrant returns (uint256 amountToken, uint256 amountQuote) {
        Launch memory l = launches[token];
        if (l.positionId == 0) revert UnknownToken();

        (uint256 a0, uint256 a1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: l.positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        (amountToken, amountQuote) = l.tokenIsToken0 ? (a0, a1) : (a1, a0);
        emit FeesCollected(token, amountToken, amountQuote);

        _split(l.creatorId, token, amountToken);
        _split(l.creatorId, l.quote, amountQuote);
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
        uint256 platformPart = amount - creatorPart;
        // un actif en pause ou qui bloque une adresse ne doit pas bloquer la collecte
        if (platformPart > 0 && !IERC20(asset).trySafeTransfer(treasury, platformPart)) {
            treasuryOwed[asset] += platformPart;
        }
    }

    function _creditCreator(bytes32 creatorId, address asset, uint256 amount) internal {
        address wallet = boundWallet[creatorId];
        if (wallet != address(0) && IERC20(asset).trySafeTransfer(wallet, amount)) {
            emit CreatorCredited(creatorId, asset, amount, true);
        } else {
            escrow[creatorId][asset] += amount;
            emit CreatorCredited(creatorId, asset, amount, false);
        }
    }

    /// @notice renvoie à la trésorerie les frais plateforme restés en attente
    function flushTreasury(address asset) external {
        uint256 amount = treasuryOwed[asset];
        if (amount == 0) return;
        treasuryOwed[asset] = 0;
        IERC20(asset).safeTransfer(treasury, amount);
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
            // un actif en pause reste en séquestre au lieu de faire échouer toute la réclamation
            if (IERC20(assets[i]).trySafeTransfer(recipient, amount)) {
                emit Claimed(creatorId, recipient, assets[i], amount);
            } else {
                escrow[creatorId][assets[i]] = amount;
            }
        }
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ================================================================ admin

    function setQuote(address asset, bool allowed) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        quoteAllowed[asset] = allowed;
        emit QuoteSet(asset, allowed);
    }

    function setQuotes(address[] calldata assets, bool allowed) external onlyOwner {
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i] == address(0)) revert ZeroAddress();
            quoteAllowed[assets[i]] = allowed;
            emit QuoteSet(assets[i], allowed);
        }
    }

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
