// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";

/**
 * @title PrivateSettlement
 * @notice Privacy layer for agent payments. Uses commitment/nullifier scheme
 *         to hide payer identity while proving payment to agent.
 *
 *         Flow:
 *         1. Payer commits: keccak256(secret, agent, amount, nonce) → stored on-chain
 *         2. Payer reveals secret off-chain to agent
 *         3. Agent claims via nullifier, settlement is private
 *
 *         On Monad: 10k TPS lets us handle high-frequency private payments
 *         that would be cost-prohibitive on Ethereum.
 */
contract PrivateSettlement {
    IERC20 public immutable usdc;

    struct Commitment {
        uint256 amount;
        uint256 expiry;
        bool claimed;
    }

    // commitment hash => commitment data
    mapping(bytes32 => Commitment) public commitments;
    // nullifier hash => used (prevents double-spend)
    mapping(bytes32 => bool) public nullifiers;

    uint256 public constant COMMITMENT_TTL = 1 hours;

    event CommitmentCreated(bytes32 indexed commitment, uint256 amount, uint256 expiry);
    event CommitmentClaimed(bytes32 indexed commitment, bytes32 indexed nullifier, address indexed agent, uint256 amount);
    event CommitmentExpired(bytes32 indexed commitment, address indexed refundTo, uint256 amount);

    error CommitmentExists();
    error CommitmentNotFound();
    error CommitmentAlreadyClaimed();
    error CommitmentExpiredError();
    error NullifierUsed();
    error InvalidProof();
    error NotExpiredYet();
    error TransferFailed();

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    /**
     * @notice Create a private payment commitment.
     * @param commitment keccak256(abi.encodePacked(secret, agent, amount, nonce))
     * @param amount     USDC amount (6 decimals)
     */
    function commit(bytes32 commitment, uint256 amount) external {
        if (commitments[commitment].amount != 0) revert CommitmentExists();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        uint256 expiry = block.timestamp + COMMITMENT_TTL;
        commitments[commitment] = Commitment({amount: amount, expiry: expiry, claimed: false});

        emit CommitmentCreated(commitment, amount, expiry);
    }

    /**
     * @notice Agent claims a payment by revealing the secret.
     * @param secret  The secret used to create the commitment.
     * @param agent   The agent's address (recipient).
     * @param amount  The committed amount.
     * @param nonce   Nonce used in commitment.
     */
    function claim(bytes32 secret, address agent, uint256 amount, uint256 nonce) external {
        bytes32 commitment = keccak256(abi.encodePacked(secret, agent, amount, nonce));
        bytes32 nullifier = keccak256(abi.encodePacked(secret, nonce));

        Commitment storage c = commitments[commitment];
        if (c.amount == 0) revert CommitmentNotFound();
        if (c.claimed) revert CommitmentAlreadyClaimed();
        if (block.timestamp > c.expiry) revert CommitmentExpiredError();
        if (nullifiers[nullifier]) revert NullifierUsed();

        c.claimed = true;
        nullifiers[nullifier] = true;

        if (!usdc.transfer(agent, amount)) revert TransferFailed();

        emit CommitmentClaimed(commitment, nullifier, agent, amount);
    }

    /**
     * @notice Refund an expired commitment back to payer.
     * @param secret      The original secret (proves ownership, commitment is derived from this).
     * @param agent       Agent address used in commitment.
     * @param amount      Amount used in commitment.
     * @param nonce       Nonce used in commitment.
     */
    function refundExpired(bytes32 secret, address agent, uint256 amount, uint256 nonce) external {
        bytes32 commitment = keccak256(abi.encodePacked(secret, agent, amount, nonce));
        Commitment storage c = commitments[commitment];

        if (c.amount == 0) revert CommitmentNotFound();
        if (c.claimed) revert CommitmentAlreadyClaimed();
        if (block.timestamp <= c.expiry) revert NotExpiredYet();

        c.claimed = true; // prevent re-entry
        if (!usdc.transfer(msg.sender, amount)) revert TransferFailed();

        emit CommitmentExpired(commitment, msg.sender, amount);
    }
}
