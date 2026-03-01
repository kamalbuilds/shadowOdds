// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentRegistry
 * @notice Registry for AI agents participating in the PrivateX payment network.
 *         Agents register here to receive payments via x402 and interact with AgentVault.
 */
contract AgentRegistry {
    struct Agent {
        address owner;
        string endpoint;   // HTTPS endpoint for x402 payment requests
        string metadataURI;
        bool active;
        uint256 registeredAt;
    }

    mapping(address => Agent) public agents;
    mapping(address => bool) public isRegistered;
    address[] public agentList;

    event AgentRegistered(address indexed agent, address indexed owner, string endpoint);
    event AgentDeactivated(address indexed agent);
    event AgentEndpointUpdated(address indexed agent, string newEndpoint);

    error AlreadyRegistered();
    error NotRegistered();
    error NotOwner();

    modifier onlyAgentOwner(address agent) {
        if (agents[agent].owner != msg.sender) revert NotOwner();
        _;
    }

    /**
     * @notice Register a new AI agent.
     * @param agent  The agent's address (used as payment recipient in x402).
     * @param endpoint HTTPS URL the agent exposes for x402 payment challenges.
     * @param metadataURI IPFS/HTTPS URI for agent metadata (name, description, pricing).
     */
    function register(address agent, string calldata endpoint, string calldata metadataURI) external {
        if (isRegistered[agent]) revert AlreadyRegistered();

        agents[agent] = Agent({
            owner: msg.sender,
            endpoint: endpoint,
            metadataURI: metadataURI,
            active: true,
            registeredAt: block.timestamp
        });
        isRegistered[agent] = true;
        agentList.push(agent);

        emit AgentRegistered(agent, msg.sender, endpoint);
    }

    function deactivate(address agent) external onlyAgentOwner(agent) {
        agents[agent].active = false;
        emit AgentDeactivated(agent);
    }

    function updateEndpoint(address agent, string calldata newEndpoint) external onlyAgentOwner(agent) {
        agents[agent].endpoint = newEndpoint;
        emit AgentEndpointUpdated(agent, newEndpoint);
    }

    function getAgent(address agent) external view returns (Agent memory) {
        if (!isRegistered[agent]) revert NotRegistered();
        return agents[agent];
    }

    function totalAgents() external view returns (uint256) {
        return agentList.length;
    }
}
