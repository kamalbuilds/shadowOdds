// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";

/**
 * @title AgentVault
 * @notice Holds USDC balances for AI agents. Agents receive x402 payments here
 *         and can withdraw earnings. Supports private settlement via PrivateSettlement.
 *
 * USDC on Monad Mainnet: 0x754704Bc059F8C67012fEd69BC8A327a5aafb603
 */
contract AgentVault {
    IERC20 public immutable usdc;
    address public immutable registry;

    mapping(address => uint256) public balances;
    uint256 public totalDeposited;

    event Deposit(address indexed agent, address indexed from, uint256 amount);
    event Withdrawal(address indexed agent, address indexed to, uint256 amount);
    event PrivateSettlement(address indexed payer, address indexed agent, uint256 amount, bytes32 indexed ref);

    error InsufficientBalance();
    error ZeroAmount();
    error TransferFailed();

    constructor(address _usdc, address _registry) {
        usdc = IERC20(_usdc);
        registry = _registry;
    }

    /**
     * @notice Deposit USDC into an agent's vault balance.
     *         Called by x402Verifier after validating payment authorization.
     */
    function deposit(address agent, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        balances[agent] += amount;
        totalDeposited += amount;

        emit Deposit(agent, msg.sender, amount);
    }

    /**
     * @notice Settle a private payment from payer to agent.
     *         `ref` is a commitment/nullifier hash for privacy.
     */
    function settlePrivate(address agent, uint256 amount, bytes32 ref) external {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        balances[agent] += amount;
        totalDeposited += amount;

        emit PrivateSettlement(msg.sender, agent, amount, ref);
    }

    /**
     * @notice Agent withdraws their earned USDC.
     */
    function withdraw(uint256 amount, address to) external {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        balances[msg.sender] -= amount;
        totalDeposited -= amount;

        if (!usdc.transfer(to, amount)) revert TransferFailed();

        emit Withdrawal(msg.sender, to, amount);
    }

    function balanceOf(address agent) external view returns (uint256) {
        return balances[agent];
    }
}
