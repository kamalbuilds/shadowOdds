// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth, PythPrice} from "../interfaces/IPyth.sol";

/// @notice Mock Pyth oracle for local testing. Allows setting arbitrary prices.
contract MockPyth is IPyth {
    mapping(bytes32 => PythPrice) private prices;
    uint256 private updateFee = 1; // 1 wei

    function setPrice(bytes32 id, int64 price, int32 expo) external {
        prices[id] = PythPrice({price: price, conf: 0, expo: expo, publishTime: block.timestamp});
    }

    function setUpdateFee(uint256 fee) external {
        updateFee = fee;
    }

    function getUpdateFee(bytes[] calldata) external view override returns (uint256) {
        return updateFee;
    }

    function updatePriceFeeds(bytes[] calldata) external payable override {
        // No-op: prices set directly via setPrice()
    }

    function getPriceNoOlderThan(bytes32 id, uint256) external view override returns (PythPrice memory) {
        return prices[id];
    }

    function getPrice(bytes32 id) external view override returns (PythPrice memory) {
        return prices[id];
    }
}
