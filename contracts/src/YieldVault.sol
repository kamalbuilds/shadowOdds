// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title YieldVault — Simulated yield on locked prediction market USDC
/// @notice Tracks per-market USDC deposits and calculates time-based yield at 5% APR.
///         On Monad testnet, yield is simulated by minting MockUSDC. In production,
///         this vault would deposit into Aave/Compound and earn real yield.
contract YieldVault {
    using SafeERC20 for IERC20;

    struct MarketDeposit {
        uint256 totalDeposited;
        uint256 firstDepositTime;
        uint256 withdrawnAt;
        bool withdrawn;
    }

    IERC20 public immutable USDC;
    address public shadowOdds;
    address public immutable deployer;
    bool public initialized;

    uint256 public constant APR_BPS = 500; // 5% APR
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    mapping(uint256 => MarketDeposit) public deposits;

    event Deposited(uint256 indexed marketId, uint256 amount, uint256 newTotal);
    event Withdrawn(uint256 indexed marketId, uint256 principal, uint256 yieldAmount);

    error OnlyShadowOdds();
    error AlreadyWithdrawn();
    error NoDeposit();
    error AlreadyInitialized();
    error NotDeployer();

    modifier onlyShadowOdds() {
        if (msg.sender != shadowOdds) revert OnlyShadowOdds();
        _;
    }

    constructor(address _usdc) {
        USDC = IERC20(_usdc);
        deployer = msg.sender;
    }

    /// @notice Set the ShadowOddsV2 address (one-time, solves deploy order)
    function initialize(address _shadowOdds) external {
        if (initialized) revert AlreadyInitialized();
        if (msg.sender != deployer) revert NotDeployer();
        shadowOdds = _shadowOdds;
        initialized = true;
    }

    /// @notice Deposit USDC for a market (called by ShadowOddsV2 on placeBet)
    function deposit(uint256 marketId, uint256 amount) external onlyShadowOdds {
        MarketDeposit storage d = deposits[marketId];
        if (d.withdrawn) revert AlreadyWithdrawn();

        if (d.firstDepositTime == 0) {
            d.firstDepositTime = block.timestamp;
        }
        d.totalDeposited += amount;

        emit Deposited(marketId, amount, d.totalDeposited);
    }

    /// @notice Withdraw principal + simulated yield (called on first claim/refund)
    function withdraw(uint256 marketId) external onlyShadowOdds returns (uint256 principal, uint256 yieldAmount) {
        MarketDeposit storage d = deposits[marketId];
        if (d.totalDeposited == 0) revert NoDeposit();
        if (d.withdrawn) revert AlreadyWithdrawn();

        d.withdrawn = true;
        d.withdrawnAt = block.timestamp;

        principal = d.totalDeposited;
        yieldAmount = _calculateYield(d);

        // Transfer principal back
        USDC.safeTransfer(shadowOdds, principal);

        // Simulate yield by minting MockUSDC (testnet only)
        if (yieldAmount > 0) {
            (bool success,) = address(USDC).call(abi.encodeWithSignature("mint(address,uint256)", shadowOdds, yieldAmount));
            if (!success) yieldAmount = 0; // graceful degradation
        }

        emit Withdrawn(marketId, principal, yieldAmount);
    }

    /// @notice Calculate accrued yield for a market
    function calculateYield(uint256 marketId) external view returns (uint256) {
        return _calculateYield(deposits[marketId]);
    }

    /// @notice Get yield info for frontend display
    function getEstimatedYield(uint256 marketId)
        external
        view
        returns (uint256 principal, uint256 currentYield, uint256 depositTime, uint256 aprBps)
    {
        MarketDeposit storage d = deposits[marketId];
        principal = d.totalDeposited;
        currentYield = _calculateYield(d);
        depositTime = d.firstDepositTime;
        aprBps = APR_BPS;
    }

    function _calculateYield(MarketDeposit storage d) internal view returns (uint256) {
        if (d.totalDeposited == 0 || d.firstDepositTime == 0) return 0;
        uint256 endTime = d.withdrawn ? d.withdrawnAt : block.timestamp;
        uint256 duration = endTime - d.firstDepositTime;
        return (d.totalDeposited * APR_BPS * duration) / (SECONDS_PER_YEAR * 10_000);
    }
}
