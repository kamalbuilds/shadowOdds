// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPyth, PythPrice} from "./interfaces/IPyth.sol";

/// @title ShadowLimitOrder — Private Limit Orders for ShadowOdds
/// @notice Users set hidden price triggers (commitment scheme). When Pyth price hits
///         the trigger, anyone can execute the order (keeper model). The order auto-places
///         a bet on ShadowOddsV2 with the escrowed USDC.
///
///         Privacy: trigger price, direction, and bet outcome are hidden in the commitment.
///         Only revealed at execution time.
contract ShadowLimitOrder {
    using SafeERC20 for IERC20;

    enum TriggerDirection { BELOW, ABOVE_OR_EQUAL }

    struct Order {
        address creator;
        bytes32 orderCommitment;
        bytes32 betCommitment;     // pre-computed ShadowOdds bet commitment
        bytes32 priceFeedId;
        uint256 marketId;
        uint256 amount;
        uint256 expiry;
        uint256 keeperRewardBps;
        bool executed;
        bool cancelled;
    }

    IERC20 public immutable USDC;
    IPyth public immutable pyth;
    address public immutable shadowOdds;

    uint256 public orderCount;
    mapping(uint256 => Order) public orders;
    mapping(bytes32 => bool) public nullifiers;

    // Track which market has an active limit order bet (one per market for this contract)
    mapping(uint256 => uint256) public activeMarketOrder; // marketId => orderId

    uint256 public constant DEFAULT_KEEPER_REWARD_BPS = 50;  // 0.5%
    uint256 public constant MAX_KEEPER_REWARD_BPS = 200;     // 2%
    uint256 public constant MAX_ORDER_TTL = 7 days;

    // ─────────────────────────── Events ──────────────────────────────────────

    event OrderCreated(
        uint256 indexed orderId,
        address indexed creator,
        bytes32 orderCommitment,
        bytes32 priceFeedId,
        uint256 marketId,
        uint256 amount,
        uint256 expiry
    );
    event OrderExecuted(
        uint256 indexed orderId,
        address indexed keeper,
        uint256 keeperReward,
        int64 executionPrice
    );
    event OrderCancelled(uint256 indexed orderId, address indexed creator);
    event OrderRevealed(uint256 indexed orderId, uint256 indexed marketId);
    event OrderWinningsClaimed(uint256 indexed orderId, address indexed creator, uint256 amount);

    // ─────────────────────────── Errors ──────────────────────────────────────

    error OrderNotFound();
    error OrderAlreadyExecuted();
    error OrderAlreadyCancelled();
    error OrderExpired();
    error OrderNotExpired();
    error InvalidCommitment();
    error TriggerNotMet();
    error NotCreator();
    error InvalidAmount();
    error InvalidKeeperReward();
    error MarketAlreadyHasOrder();
    error NullifierUsed();
    error BettingClosed();
    error OrderNotExecuted();

    // ─────────────────────────── Constructor ─────────────────────────────────

    constructor(address _usdc, address _pyth, address _shadowOdds) {
        USDC = IERC20(_usdc);
        pyth = IPyth(_pyth);
        shadowOdds = _shadowOdds;
    }

    // ─────────────────────────── Create Order ────────────────────────────────

    /// @notice Create a private limit order. Trigger conditions hidden in commitment.
    /// @param orderCommitment keccak256(secret, marketId, triggerPrice, triggerDir, betOutcome, amount, nonce)
    /// @param betCommitment Pre-computed ShadowOdds bet commitment (opaque)
    /// @param priceFeedId Pyth feed to monitor
    /// @param marketId ShadowOdds market to bet on
    /// @param amount USDC to escrow
    /// @param expiry When order auto-expires
    /// @param keeperRewardBps Reward for executor in basis points
    function createOrder(
        bytes32 orderCommitment,
        bytes32 betCommitment,
        bytes32 priceFeedId,
        uint256 marketId,
        uint256 amount,
        uint256 expiry,
        uint256 keeperRewardBps
    ) external returns (uint256 orderId) {
        if (amount == 0) revert InvalidAmount();
        if (keeperRewardBps > MAX_KEEPER_REWARD_BPS) revert InvalidKeeperReward();
        if (activeMarketOrder[marketId] != 0) revert MarketAlreadyHasOrder();

        USDC.safeTransferFrom(msg.sender, address(this), amount);

        orderId = ++orderCount;
        orders[orderId] = Order({
            creator: msg.sender,
            orderCommitment: orderCommitment,
            betCommitment: betCommitment,
            priceFeedId: priceFeedId,
            marketId: marketId,
            amount: amount,
            expiry: expiry,
            keeperRewardBps: keeperRewardBps,
            executed: false,
            cancelled: false
        });

        activeMarketOrder[marketId] = orderId;

        emit OrderCreated(orderId, msg.sender, orderCommitment, priceFeedId, marketId, amount, expiry);
    }

    // ─────────────────────────── Execute Order ───────────────────────────────

    /// @notice Execute a limit order when trigger condition is met
    /// @dev Keeper provides commitment preimage + fresh Pyth price proof
    function executeOrder(
        uint256 orderId,
        bytes[] calldata pythUpdateData,
        bytes32 secret,
        uint256 marketId,
        int64 triggerPrice,
        TriggerDirection triggerDirection,
        uint8 betOutcome,
        uint256 amount,
        uint256 nonce
    ) external payable {
        Order storage order = orders[orderId];
        if (order.amount == 0) revert OrderNotFound();
        if (order.executed) revert OrderAlreadyExecuted();
        if (order.cancelled) revert OrderAlreadyCancelled();
        if (block.timestamp >= order.expiry) revert OrderExpired();

        // Verify commitment preimage
        bytes32 expected = keccak256(
            abi.encodePacked(secret, marketId, triggerPrice, uint8(triggerDirection), betOutcome, amount, nonce)
        );
        if (order.orderCommitment != expected) revert InvalidCommitment();

        // Nullifier check
        bytes32 nullifier = keccak256(abi.encodePacked(secret, nonce));
        if (nullifiers[nullifier]) revert NullifierUsed();
        nullifiers[nullifier] = true;

        // Verify amounts match
        if (order.marketId != marketId || order.amount != amount) revert InvalidCommitment();

        // Update Pyth price
        uint256 pythFee = pyth.getUpdateFee(pythUpdateData);
        pyth.updatePriceFeeds{value: pythFee}(pythUpdateData);

        // Check current price meets trigger
        PythPrice memory price = pyth.getPriceNoOlderThan(order.priceFeedId, 60);
        if (triggerDirection == TriggerDirection.ABOVE_OR_EQUAL) {
            if (price.price < triggerPrice) revert TriggerNotMet();
        } else {
            if (price.price >= triggerPrice) revert TriggerNotMet();
        }

        order.executed = true;

        // Calculate keeper reward
        uint256 keeperReward = (amount * order.keeperRewardBps) / 10_000;
        uint256 betAmount = amount - keeperReward;

        // Pay keeper
        if (keeperReward > 0) {
            USDC.safeTransfer(msg.sender, keeperReward);
        }

        // Approve and place bet on ShadowOdds
        USDC.approve(shadowOdds, betAmount);

        // Call placeBet — this contract becomes the bettor
        (bool success,) = shadowOdds.call(
            abi.encodeWithSignature(
                "placeBet(uint256,bytes32,uint256)",
                marketId,
                order.betCommitment,
                betAmount
            )
        );
        if (!success) revert BettingClosed();

        emit OrderExecuted(orderId, msg.sender, keeperReward, price.price);
    }

    // ─────────────────────────── Cancel Order ────────────────────────────────

    /// @notice Cancel an unexecuted order and reclaim USDC
    function cancelOrder(uint256 orderId) external {
        Order storage order = orders[orderId];
        if (order.amount == 0) revert OrderNotFound();
        if (order.executed) revert OrderAlreadyExecuted();
        if (order.cancelled) revert OrderAlreadyCancelled();
        if (msg.sender != order.creator) revert NotCreator();

        order.cancelled = true;
        activeMarketOrder[order.marketId] = 0;

        USDC.safeTransfer(order.creator, order.amount);
        emit OrderCancelled(orderId, order.creator);
    }

    // ─────────────────────────── Reveal & Claim ──────────────────────────────

    /// @notice Reveal the bet placed by an executed order (forwards to ShadowOdds)
    function revealOrder(
        uint256 orderId,
        bytes32 betSecret,
        uint8 betOutcome,
        uint256 amount,
        uint256 betNonce
    ) external {
        Order storage order = orders[orderId];
        if (order.amount == 0) revert OrderNotFound();
        if (!order.executed) revert OrderNotExecuted();

        // Forward reveal to ShadowOdds (commitment-keyed V2)
        (bool success,) = shadowOdds.call(
            abi.encodeWithSignature(
                "revealBet(uint256,bytes32,bytes32,uint8,uint256,uint256)",
                order.marketId,
                order.betCommitment,    // commitment for lookup
                betSecret,
                betOutcome,
                amount,
                betNonce
            )
        );
        require(success, "reveal failed");

        emit OrderRevealed(orderId, order.marketId);
    }

    /// @notice Claim winnings from an executed order (forwards to ShadowOdds, sends to creator)
    function claimOrderWinnings(uint256 orderId) external {
        Order storage order = orders[orderId];
        if (order.amount == 0) revert OrderNotFound();
        if (!order.executed) revert OrderNotExecuted();

        uint256 balBefore = USDC.balanceOf(address(this));

        // Forward claim to ShadowOdds (commitment-keyed V2)
        (bool success,) = shadowOdds.call(
            abi.encodeWithSignature(
                "claimWinnings(uint256,bytes32)",
                order.marketId,
                order.betCommitment     // commitment for lookup
            )
        );
        require(success, "claim failed");

        uint256 balAfter = USDC.balanceOf(address(this));
        uint256 winnings = balAfter - balBefore;

        // Clear market slot
        activeMarketOrder[order.marketId] = 0;

        // Send winnings to order creator
        if (winnings > 0) {
            USDC.safeTransfer(order.creator, winnings);
        }

        emit OrderWinningsClaimed(orderId, order.creator, winnings);
    }

    // ─────────────────────────── Views ───────────────────────────────────────

    /// @notice Compute order commitment hash (for testing/frontend)
    function computeOrderCommitment(
        bytes32 secret,
        uint256 marketId,
        int64 triggerPrice,
        TriggerDirection triggerDirection,
        uint8 betOutcome,
        uint256 amount,
        uint256 nonce
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(secret, marketId, triggerPrice, uint8(triggerDirection), betOutcome, amount, nonce)
        );
    }

    /// @notice Get order details
    function getOrder(uint256 orderId) external view returns (
        address creator,
        bytes32 priceFeedId,
        uint256 marketId,
        uint256 amount,
        uint256 expiry,
        bool executed,
        bool cancelled
    ) {
        Order storage o = orders[orderId];
        return (o.creator, o.priceFeedId, o.marketId, o.amount, o.expiry, o.executed, o.cancelled);
    }
}
