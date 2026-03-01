// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Minimal IPyth interface for ShadowOdds
// Full interface: https://github.com/pyth-network/pyth-sdk-solidity

struct PythPrice {
    int64 price;
    uint64 conf;
    int32 expo;
    uint256 publishTime;
}

interface IPyth {
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount);

    function updatePriceFeeds(bytes[] calldata updateData) external payable;

    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (PythPrice memory price);

    function getPrice(bytes32 id) external view returns (PythPrice memory price);
}
