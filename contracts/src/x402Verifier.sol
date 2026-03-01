// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";
import {AgentVault} from "./AgentVault.sol";

/**
 * @title x402Verifier
 * @notice On-chain settlement contract for x402 payments on Monad.
 *         Validates EIP-3009 transferWithAuthorization signatures and
 *         settles USDC from payer to AgentVault in a single transaction.
 *
 *         x402 chain: "eip155:143" / "monad"
 *         USDC on Monad Mainnet: 0x754704Bc059F8C67012fEd69BC8A327a5aafb603
 *
 *         Off-chain flow:
 *         1. Client sends HTTP request to agent endpoint
 *         2. Agent responds 402 with payment requirements (amount, address, chain)
 *         3. Client signs EIP-3009 authorization off-chain
 *         4. Client includes X-PAYMENT header with signed authorization
 *         5. Agent calls this contract to settle on-chain
 *         6. Agent fulfills the request after settlement confirmed
 */
contract x402Verifier {
    // EIP-3009: transferWithAuthorization
    // USDC implements this natively
    bytes4 private constant TRANSFER_WITH_AUTH_SELECTOR = bytes4(
        keccak256("transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)")
    );

    IERC20 public immutable usdc;
    AgentVault public immutable vault;

    // Facilitator address — the x402 infrastructure relayer
    address public facilitator;
    address public owner;

    // Per-agent nonce tracking for replay protection
    mapping(address => mapping(bytes32 => bool)) public usedNonces;

    event PaymentSettled(
        address indexed payer,
        address indexed agent,
        uint256 amount,
        bytes32 indexed nonce,
        string requestId
    );

    error InvalidSignature();
    error NonceUsed();
    error Unauthorized();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _usdc, address _vault, address _facilitator) {
        usdc = IERC20(_usdc);
        vault = AgentVault(_vault);
        facilitator = _facilitator;
        owner = msg.sender;
    }

    /**
     * @notice Settle an x402 payment using EIP-3009 authorization.
     * @param from        Payer address
     * @param to          Agent address (payment recipient)
     * @param value       USDC amount (6 decimals)
     * @param validAfter  Authorization valid after timestamp
     * @param validBefore Authorization valid before timestamp
     * @param nonce       EIP-3009 nonce (bytes32, unique per authorization)
     * @param v, r, s     EIP-3009 signature components
     * @param requestId   Off-chain request identifier for correlation
     */
    function settle(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s,
        string calldata requestId
    ) external {
        if (usedNonces[to][nonce]) revert NonceUsed();

        usedNonces[to][nonce] = true;

        // Execute EIP-3009 transfer: payer → this contract
        (bool success,) = address(usdc).call(
            abi.encodeWithSelector(
                TRANSFER_WITH_AUTH_SELECTOR,
                from, address(this), value, validAfter, validBefore, nonce, v, r, s
            )
        );
        if (!success) revert InvalidSignature();

        // Deposit into agent vault
        usdc.approve(address(vault), value);
        vault.deposit(to, value);

        emit PaymentSettled(from, to, value, nonce, requestId);
    }

    function setFacilitator(address _facilitator) external onlyOwner {
        facilitator = _facilitator;
    }
}
