// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ShadowOddsV2} from "../src/ShadowOddsV2.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {ShadowLimitOrder} from "../src/ShadowLimitOrder.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockPyth} from "../src/mocks/MockPyth.sol";

contract ShadowLimitOrderTest is Test {
    ShadowOddsV2 public odds;
    YieldVault public vault;
    ShadowLimitOrder public limitOrder;
    MockUSDC public usdc;
    MockPyth public pyth;

    address public owner = address(this);
    address public treasury = makeAddr("treasury");
    address public alice = makeAddr("alice");
    address public keeper = makeAddr("keeper");

    bytes32 public constant ETH_USD_FEED = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    uint256 public constant D6 = 1e6;

    function setUp() public {
        usdc = new MockUSDC();
        pyth = new MockPyth();
        vault = new YieldVault(address(usdc));
        odds = new ShadowOddsV2(address(usdc), address(pyth), treasury, address(vault));
        vault.initialize(address(odds));
        limitOrder = new ShadowLimitOrder(address(usdc), address(pyth), address(odds));

        usdc.mint(alice, 10_000 * D6);
        usdc.mint(address(limitOrder), 0); // just initialize

        vm.prank(alice);
        usdc.approve(address(limitOrder), type(uint256).max);

        // LimitOrder contract needs to be able to approve odds for USDC
        // (handled inside executeOrder)
    }

    function _createMarket() internal returns (uint256) {
        return odds.createMarket(
            "Will ETH > $3000?",
            block.timestamp + 2 hours,
            block.timestamp + 3 hours,
            ShadowOddsV2.OracleType.ADMIN,
            address(0),
            bytes32(0),
            0
        );
    }

    function _orderCommitment(
        bytes32 secret,
        uint256 marketId,
        int64 triggerPrice,
        ShadowLimitOrder.TriggerDirection dir,
        uint8 betOutcome,
        uint256 amount,
        uint256 nonce
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret, marketId, triggerPrice, uint8(dir), betOutcome, amount, nonce));
    }

    function _betCommitment(bytes32 betSecret, uint8 outcome, uint256 amount, uint256 betNonce)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(betSecret, outcome, amount, betNonce));
    }

    // ─────────────────────── Create Order ─────────────────────────────────────

    function test_createOrder_escrewsUSDC() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;

        bytes32 secret = keccak256("order_secret");
        uint256 nonce = 42;
        bytes32 betSecret = keccak256("bet_secret");
        uint256 betNonce = 99;

        bytes32 oc = _orderCommitment(
            secret, mid, 3000_00000000, ShadowLimitOrder.TriggerDirection.ABOVE_OR_EQUAL, 1, amount, nonce
        );
        bytes32 bc = _betCommitment(betSecret, 1, amount, betNonce);

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 orderId = limitOrder.createOrder(oc, bc, ETH_USD_FEED, mid, amount, block.timestamp + 1 days, 50);

        assertEq(orderId, 1);
        assertEq(usdc.balanceOf(alice), aliceBefore - amount);
        assertEq(usdc.balanceOf(address(limitOrder)), amount);
    }

    // ─────────────────────── Execute Order ────────────────────────────────────

    function test_executeOrder_triggerAbove() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;

        bytes32 secret = keccak256("order_secret");
        uint256 nonce = 42;
        bytes32 betSecret = keccak256("bet_secret");
        uint256 betNonce = 99;

        // Trigger: execute when ETH >= $3000
        int64 triggerPrice = 3000_00000000;

        bytes32 oc = _orderCommitment(
            secret, mid, triggerPrice, ShadowLimitOrder.TriggerDirection.ABOVE_OR_EQUAL, 1, amount, nonce
        );
        // betCommitment uses the net amount after keeper reward
        uint256 keeperRewardBps = 50;
        uint256 keeperReward = (amount * keeperRewardBps) / 10_000;
        uint256 betAmount = amount - keeperReward;
        bytes32 bc = _betCommitment(betSecret, 1, betAmount, betNonce);

        vm.prank(alice);
        limitOrder.createOrder(oc, bc, ETH_USD_FEED, mid, amount, block.timestamp + 1 days, keeperRewardBps);

        // Set Pyth price to $3500 (above trigger)
        pyth.setPrice(ETH_USD_FEED, 3500_00000000, -8);

        // Keeper executes
        bytes[] memory emptyData = new bytes[](0);
        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        limitOrder.executeOrder{value: 1}(
            1, emptyData, secret, mid, triggerPrice,
            ShadowLimitOrder.TriggerDirection.ABOVE_OR_EQUAL, 1, amount, nonce
        );

        // Verify order executed
        (,,,,,bool executed,) = limitOrder.getOrder(1);
        assertTrue(executed);

        // Verify keeper got reward
        assertEq(usdc.balanceOf(keeper), keeperReward);

        // Verify bet was placed on ShadowOdds (USDC in vault)
        assertEq(usdc.balanceOf(address(vault)), betAmount);
    }

    function test_executeOrder_triggerBelow() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;

        bytes32 secret = keccak256("order_secret");
        uint256 nonce = 42;
        bytes32 betSecret = keccak256("bet_secret");
        uint256 betNonce = 99;

        // Trigger: execute when ETH < $2000
        int64 triggerPrice = 2000_00000000;
        uint256 keeperReward = (amount * 50) / 10_000;
        uint256 betAmount = amount - keeperReward;

        bytes32 oc = _orderCommitment(
            secret, mid, triggerPrice, ShadowLimitOrder.TriggerDirection.BELOW, 2, amount, nonce
        );
        bytes32 bc = _betCommitment(betSecret, 2, betAmount, betNonce);

        vm.prank(alice);
        limitOrder.createOrder(oc, bc, ETH_USD_FEED, mid, amount, block.timestamp + 1 days, 50);

        // Set Pyth price to $1800 (below trigger)
        pyth.setPrice(ETH_USD_FEED, 1800_00000000, -8);

        bytes[] memory emptyData = new bytes[](0);
        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        limitOrder.executeOrder{value: 1}(
            1, emptyData, secret, mid, triggerPrice,
            ShadowLimitOrder.TriggerDirection.BELOW, 2, amount, nonce
        );

        (,,,,,bool executed,) = limitOrder.getOrder(1);
        assertTrue(executed);
    }

    function test_executeOrder_revertsWhenTriggerNotMet() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;

        bytes32 secret = keccak256("order_secret");
        uint256 nonce = 42;
        bytes32 betSecret = keccak256("bet_secret");
        uint256 betNonce = 99;

        int64 triggerPrice = 3000_00000000;
        uint256 betAmount = amount - (amount * 50) / 10_000;

        bytes32 oc = _orderCommitment(
            secret, mid, triggerPrice, ShadowLimitOrder.TriggerDirection.ABOVE_OR_EQUAL, 1, amount, nonce
        );
        bytes32 bc = _betCommitment(betSecret, 1, betAmount, betNonce);

        vm.prank(alice);
        limitOrder.createOrder(oc, bc, ETH_USD_FEED, mid, amount, block.timestamp + 1 days, 50);

        // Set price BELOW trigger ($2500 < $3000)
        pyth.setPrice(ETH_USD_FEED, 2500_00000000, -8);

        bytes[] memory emptyData = new bytes[](0);
        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        vm.expectRevert(ShadowLimitOrder.TriggerNotMet.selector);
        limitOrder.executeOrder{value: 1}(
            1, emptyData, secret, mid, triggerPrice,
            ShadowLimitOrder.TriggerDirection.ABOVE_OR_EQUAL, 1, amount, nonce
        );
    }

    // ─────────────────────── Cancel Order ─────────────────────────────────────

    function test_cancelOrder_refundsUSDC() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;

        bytes32 secret = keccak256("order_secret");
        uint256 nonce = 42;

        bytes32 oc = _orderCommitment(
            secret, mid, 3000_00000000, ShadowLimitOrder.TriggerDirection.ABOVE_OR_EQUAL, 1, amount, nonce
        );
        bytes32 bc = keccak256("fake_bet_commit");

        uint256 before = usdc.balanceOf(alice);

        vm.prank(alice);
        limitOrder.createOrder(oc, bc, ETH_USD_FEED, mid, amount, block.timestamp + 1 days, 50);

        vm.prank(alice);
        limitOrder.cancelOrder(1);

        assertEq(usdc.balanceOf(alice), before);

        (,,,,, bool executed, bool cancelled) = limitOrder.getOrder(1);
        assertFalse(executed);
        assertTrue(cancelled);
    }

    function test_cancelOrder_revertsIfNotCreator() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;

        bytes32 oc = keccak256("commit");
        bytes32 bc = keccak256("bet_commit");

        vm.prank(alice);
        limitOrder.createOrder(oc, bc, ETH_USD_FEED, mid, amount, block.timestamp + 1 days, 50);

        vm.prank(keeper);
        vm.expectRevert(ShadowLimitOrder.NotCreator.selector);
        limitOrder.cancelOrder(1);
    }

    function test_cancelOrder_revertsIfExecuted() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;

        bytes32 secret = keccak256("order_secret");
        uint256 nonce = 42;
        int64 triggerPrice = 3000_00000000;
        uint256 betAmount = amount - (amount * 50) / 10_000;

        bytes32 oc = _orderCommitment(
            secret, mid, triggerPrice, ShadowLimitOrder.TriggerDirection.ABOVE_OR_EQUAL, 1, amount, nonce
        );
        bytes32 bc = _betCommitment(keccak256("bet_secret"), 1, betAmount, 99);

        vm.prank(alice);
        limitOrder.createOrder(oc, bc, ETH_USD_FEED, mid, amount, block.timestamp + 1 days, 50);

        pyth.setPrice(ETH_USD_FEED, 3500_00000000, -8);

        bytes[] memory emptyData = new bytes[](0);
        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        limitOrder.executeOrder{value: 1}(
            1, emptyData, secret, mid, triggerPrice,
            ShadowLimitOrder.TriggerDirection.ABOVE_OR_EQUAL, 1, amount, nonce
        );

        vm.prank(alice);
        vm.expectRevert(ShadowLimitOrder.OrderAlreadyExecuted.selector);
        limitOrder.cancelOrder(1);
    }
}
