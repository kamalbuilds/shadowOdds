// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPyth, PythPrice} from "./interfaces/IPyth.sol";
import {YieldVault} from "./YieldVault.sol";

/// @title ShadowOddsV2 — Private Prediction Market with Shielded Yield
/// @notice Commitment-keyed bets: any address (user wallet or Unlink adapter) can place bets.
///         Bets indexed by commitment hash (not msg.sender), enabling useInteract privacy.
///         Winners receive pari-mutuel payout + proportional yield bonus.
contract ShadowOddsV2 {
    using SafeERC20 for IERC20;

    // ─────────────────────────── Types ───────────────────────────────────────

    enum Outcome { PENDING, YES, NO }
    enum OracleType { ADMIN, PRICE_FEED }

    struct Market {
        string question;
        uint256 bettingDeadline;
        uint256 resolutionTime;
        uint256 revealDeadline;
        OracleType oracleType;
        address priceOracle;
        bytes32 priceFeedId;
        int64 priceThreshold;
        Outcome result;
        bool resolved;
        uint256 totalPool;
        uint256 yesPool;
        uint256 noPool;
    }

    struct Bet {
        address placer;         // msg.sender at bet time (user wallet or adapter)
        bytes32 commitment;
        uint256 lockedAmount;
        Outcome outcome;
        bool revealed;
        bool claimed;
    }

    // ─────────────────────────── Storage ─────────────────────────────────────

    IERC20 public immutable USDC;
    IPyth public immutable pyth;
    YieldVault public immutable yieldVault;
    address public owner;
    address public treasury;

    uint256 public protocolFeeBps = 100;
    uint256 public constant MAX_FEE_BPS = 500;

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(bytes32 => Bet)) public bets;  // keyed by commitment

    // Yield tracking
    mapping(uint256 => bool) public yieldWithdrawn;
    mapping(uint256 => uint256) public marketYield;

    // ─────────────────────────── Events ──────────────────────────────────────

    event MarketCreated(uint256 indexed marketId, string question, uint256 bettingDeadline, uint256 resolutionTime);
    event BetPlaced(uint256 indexed marketId, address indexed bettor, bytes32 commitment, uint256 amount);
    event MarketResolved(uint256 indexed marketId, Outcome result);
    event BetRevealed(uint256 indexed marketId, address indexed bettor, Outcome outcome, uint256 amount);
    event WinningsClaimed(uint256 indexed marketId, address indexed bettor, uint256 winnings, uint256 fee);
    event ProtocolFeeUpdated(uint256 newFeeBps);
    event BetRefunded(uint256 indexed marketId, address indexed bettor, uint256 amount);
    event UnclaimedSwept(uint256 indexed marketId, address indexed bettor, uint256 amount);
    event YieldHarvested(uint256 indexed marketId, uint256 yieldAmount);
    event YieldClaimed(uint256 indexed marketId, address indexed bettor, uint256 yieldBonus);

    // ─────────────────────────── Errors ──────────────────────────────────────

    error BettingClosed();
    error MarketAlreadyResolved();
    error CommitmentExists();
    error ZeroAmount();
    error InvalidMarket();
    error NotResolved();
    error RevealWindowClosed();
    error AlreadyRevealed();
    error AmountMismatch();
    error InvalidOutcome();
    error InvalidCommitment();
    error WrongOutcome();
    error AlreadyClaimed();
    error NotOwner();
    error NotPlacer();
    error TooEarly();
    error NotAdminMarket();
    error NotPriceFeedMarket();
    error RevealWindowOpen();

    // ─────────────────────────── Modifiers ───────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ─────────────────────────── Constructor ─────────────────────────────────

    constructor(address _usdc, address _pyth, address _treasury, address _yieldVault) {
        USDC = IERC20(_usdc);
        pyth = IPyth(_pyth);
        owner = msg.sender;
        treasury = _treasury;
        yieldVault = YieldVault(_yieldVault);
    }

    // ─────────────────────────── Market Creation ─────────────────────────────

    function createMarket(
        string calldata question,
        uint256 bettingDeadline,
        uint256 resolutionTime,
        OracleType oracleType,
        address priceOracle,
        bytes32 priceFeedId,
        int64 priceThreshold
    ) external returns (uint256 marketId) {
        require(bettingDeadline > block.timestamp, "betting deadline in past");
        require(resolutionTime >= bettingDeadline, "resolution before deadline");

        marketId = ++marketCount;
        Market storage m = markets[marketId];
        m.question = question;
        m.bettingDeadline = bettingDeadline;
        m.resolutionTime = resolutionTime;
        m.revealDeadline = resolutionTime + 24 hours;
        m.oracleType = oracleType;
        m.priceOracle = priceOracle;
        m.priceFeedId = priceFeedId;
        m.priceThreshold = priceThreshold;
        m.result = Outcome.PENDING;

        emit MarketCreated(marketId, question, bettingDeadline, resolutionTime);
    }

    // ─────────────────────────── Betting ─────────────────────────────────────

    /// @notice Place a hidden bet. Indexed by commitment (not msg.sender).
    ///         msg.sender is stored as `placer` for claim authorization.
    function placeBet(uint256 marketId, bytes32 commitment, uint256 amount) external {
        if (marketId == 0 || marketId > marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (block.timestamp >= m.bettingDeadline) revert BettingClosed();
        if (m.resolved) revert MarketAlreadyResolved();
        if (bets[marketId][commitment].lockedAmount != 0) revert CommitmentExists();
        if (amount == 0) revert ZeroAmount();

        // Route USDC to YieldVault (earns yield while locked)
        USDC.safeTransferFrom(msg.sender, address(yieldVault), amount);
        yieldVault.deposit(marketId, amount);

        bets[marketId][commitment] = Bet({
            placer: msg.sender,
            commitment: commitment,
            lockedAmount: amount,
            outcome: Outcome.PENDING,
            revealed: false,
            claimed: false
        });

        m.totalPool += amount;

        emit BetPlaced(marketId, msg.sender, commitment, amount);
    }

    // ─────────────────────────── Resolution ──────────────────────────────────

    function resolveWithPyth(uint256 marketId, bytes[] calldata pythUpdateData) external payable {
        if (marketId == 0 || marketId > marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (m.resolved) revert MarketAlreadyResolved();
        if (m.oracleType != OracleType.PRICE_FEED) revert NotPriceFeedMarket();
        if (block.timestamp < m.resolutionTime) revert TooEarly();

        uint256 fee = pyth.getUpdateFee(pythUpdateData);
        pyth.updatePriceFeeds{value: fee}(pythUpdateData);

        PythPrice memory price = pyth.getPriceNoOlderThan(m.priceFeedId, 60);
        Outcome result = price.price >= m.priceThreshold ? Outcome.YES : Outcome.NO;

        _finalize(marketId, result);
    }

    function resolveAdmin(uint256 marketId, Outcome result) external onlyOwner {
        if (marketId == 0 || marketId > marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (m.resolved) revert MarketAlreadyResolved();
        if (m.oracleType != OracleType.ADMIN) revert NotAdminMarket();
        if (block.timestamp < m.resolutionTime) revert TooEarly();
        if (result == Outcome.PENDING) revert InvalidOutcome();

        _finalize(marketId, result);
    }

    function _finalize(uint256 marketId, Outcome result) internal {
        markets[marketId].result = result;
        markets[marketId].resolved = true;
        emit MarketResolved(marketId, result);
    }

    // ─────────────────────────── Reveal ──────────────────────────────────────

    /// @notice Reveal a bet. Lookup by commitment, not msg.sender.
    ///         Anyone with the secret can reveal (no msg.sender restriction).
    function revealBet(
        uint256 marketId,
        bytes32 commitment,
        bytes32 secret,
        Outcome outcome,
        uint256 amount,
        uint256 nonce
    ) external {
        if (marketId == 0 || marketId > marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (!m.resolved) revert NotResolved();
        if (block.timestamp >= m.revealDeadline) revert RevealWindowClosed();

        Bet storage bet = bets[marketId][commitment];
        if (bet.revealed) revert AlreadyRevealed();
        if (bet.lockedAmount != amount) revert AmountMismatch();
        if (outcome == Outcome.PENDING) revert InvalidOutcome();

        bytes32 expected = keccak256(abi.encodePacked(secret, uint8(outcome), amount, nonce));
        if (bet.commitment != expected) revert InvalidCommitment();

        bet.revealed = true;
        bet.outcome = outcome;

        if (outcome == Outcome.YES) {
            m.yesPool += amount;
        } else {
            m.noPool += amount;
        }

        emit BetRevealed(marketId, bet.placer, outcome, amount);
    }

    // ─────────────────────────── Yield ───────────────────────────────────────

    function _ensureYieldWithdrawn(uint256 marketId) internal {
        if (!yieldWithdrawn[marketId]) {
            yieldWithdrawn[marketId] = true;
            (, uint256 yieldAmount) = yieldVault.withdraw(marketId);
            marketYield[marketId] = yieldAmount;
            emit YieldHarvested(marketId, yieldAmount);
        }
    }

    // ─────────────────────────── Claim ───────────────────────────────────────

    /// @notice Claim winnings. Lookup by commitment. Only the placer can claim.
    ///         If placed via adapter, winnings go to adapter (reshielded to user's pool).
    function claimWinnings(uint256 marketId, bytes32 commitment) external {
        if (marketId == 0 || marketId > marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (!m.resolved) revert NotResolved();

        Bet storage bet = bets[marketId][commitment];
        if (!bet.revealed) revert NotResolved();
        if (bet.claimed) revert AlreadyClaimed();
        if (bet.outcome != m.result) revert WrongOutcome();
        if (bet.placer != msg.sender) revert NotPlacer();

        bet.claimed = true;

        // Withdraw from vault on first claim (harvests yield)
        _ensureYieldWithdrawn(marketId);

        uint256 winnerPool = bet.outcome == Outcome.YES ? m.yesPool : m.noPool;
        uint256 loserPool = bet.outcome == Outcome.YES ? m.noPool : m.yesPool;

        uint256 grossWinnings;
        if (loserPool == 0) {
            grossWinnings = bet.lockedAmount;
        } else {
            grossWinnings = bet.lockedAmount + (bet.lockedAmount * loserPool / winnerPool);
        }

        // Proportional yield bonus for winners
        uint256 yieldBonus = winnerPool > 0 ? (bet.lockedAmount * marketYield[marketId]) / winnerPool : 0;

        // Fee on profit (including yield)
        uint256 profit = grossWinnings > bet.lockedAmount
            ? grossWinnings - bet.lockedAmount + yieldBonus
            : yieldBonus;
        uint256 fee = (profit * protocolFeeBps) / 10_000;
        uint256 netWinnings = grossWinnings + yieldBonus - fee;

        if (fee > 0) USDC.safeTransfer(treasury, fee);
        USDC.safeTransfer(msg.sender, netWinnings);

        emit WinningsClaimed(marketId, msg.sender, netWinnings, fee);
        if (yieldBonus > 0) emit YieldClaimed(marketId, msg.sender, yieldBonus);
    }

    // ─────────────────────────── Refund ──────────────────────────────────────

    /// @notice Refund a bet from an unresolved market. Only the placer can refund.
    function refund(
        uint256 marketId,
        bytes32 commitment,
        bytes32 secret,
        Outcome /* outcomeGuess */,
        uint256 amount,
        uint256 nonce
    ) external {
        if (marketId == 0 || marketId > marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (m.resolved) revert MarketAlreadyResolved();
        if (block.timestamp <= m.revealDeadline) revert RevealWindowOpen();

        Bet storage bet = bets[marketId][commitment];
        if (bet.placer != msg.sender) revert NotPlacer();
        if (bet.claimed) revert AlreadyClaimed();
        if (bet.lockedAmount != amount) revert AmountMismatch();

        bytes32 yesHash = keccak256(abi.encodePacked(secret, uint8(Outcome.YES), amount, nonce));
        bytes32 noHash = keccak256(abi.encodePacked(secret, uint8(Outcome.NO), amount, nonce));
        if (bet.commitment != yesHash && bet.commitment != noHash) revert InvalidCommitment();

        bet.claimed = true;

        // Withdraw from vault if not already done
        _ensureYieldWithdrawn(marketId);

        USDC.safeTransfer(msg.sender, amount);
        emit BetRefunded(marketId, msg.sender, amount);
    }

    // ─────────────────────────── Sweep ───────────────────────────────────────

    function sweepUnclaimed(uint256 marketId, bytes32[] calldata commitments) external {
        if (marketId == 0 || marketId > marketCount) revert InvalidMarket();
        Market storage m = markets[marketId];
        if (!m.resolved) revert NotResolved();
        if (block.timestamp <= m.revealDeadline) revert RevealWindowOpen();
        if (msg.sender != treasury && msg.sender != owner) revert NotOwner();

        _ensureYieldWithdrawn(marketId);

        for (uint256 i = 0; i < commitments.length; i++) {
            Bet storage bet = bets[marketId][commitments[i]];
            if (!bet.claimed && bet.lockedAmount > 0) {
                uint256 amt = bet.lockedAmount;
                bet.claimed = true;
                USDC.safeTransfer(treasury, amt);
                emit UnclaimedSwept(marketId, bet.placer, amt);
            }
        }
    }

    // ─────────────────────────── Views ───────────────────────────────────────

    function computeCommitment(bytes32 secret, Outcome outcome, uint256 amount, uint256 nonce)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(secret, uint8(outcome), amount, nonce));
    }

    function getPoolSizes(uint256 marketId) external view returns (uint256 yesPool, uint256 noPool) {
        Market storage m = markets[marketId];
        if (!m.resolved) return (0, 0);
        return (m.yesPool, m.noPool);
    }

    function getYieldInfo(uint256 marketId) external view returns (
        uint256 totalDeposited,
        uint256 currentYield,
        uint256 depositTime,
        uint256 aprBps,
        bool harvested
    ) {
        (totalDeposited, currentYield, depositTime, aprBps) = yieldVault.getEstimatedYield(marketId);
        harvested = yieldWithdrawn[marketId];
    }

    function setProtocolFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "fee too high");
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(newFeeBps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "zero address");
        treasury = newTreasury;
    }
}
