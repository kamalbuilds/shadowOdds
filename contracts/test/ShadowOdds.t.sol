// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ShadowOddsV2} from "../src/ShadowOddsV2.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockPyth} from "../src/mocks/MockPyth.sol";

contract ShadowOddsV2Test is Test {
    ShadowOddsV2 public odds;
    YieldVault public vault;
    MockUSDC public usdc;
    MockPyth public pyth;

    address public owner = address(this);
    address public treasury = makeAddr("treasury");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public adapter = makeAddr("adapter"); // simulates Unlink adapter

    bytes32 public constant ETH_USD_FEED = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    uint256 public constant D6 = 1e6;

    function setUp() public {
        usdc = new MockUSDC();
        pyth = new MockPyth();
        vault = new YieldVault(address(usdc));
        odds = new ShadowOddsV2(address(usdc), address(pyth), treasury, address(vault));
        vault.initialize(address(odds));

        usdc.mint(alice, 10_000 * D6);
        usdc.mint(bob, 10_000 * D6);
        usdc.mint(carol, 10_000 * D6);
        usdc.mint(adapter, 10_000 * D6);

        vm.prank(alice);
        usdc.approve(address(odds), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(odds), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(odds), type(uint256).max);
        vm.prank(adapter);
        usdc.approve(address(odds), type(uint256).max);
    }

    function _createMarket() internal returns (uint256) {
        return odds.createMarket(
            "Will ETH > $3000?",
            block.timestamp + 1 hours,
            block.timestamp + 2 hours,
            ShadowOddsV2.OracleType.ADMIN,
            address(0),
            bytes32(0),
            0
        );
    }

    function _commit(address who, ShadowOddsV2.Outcome outcome, uint256 amount)
        internal
        view
        returns (bytes32 commitment, bytes32 secret, uint256 nonce)
    {
        secret = keccak256(abi.encodePacked("secret", who));
        nonce = 1;
        commitment = odds.computeCommitment(secret, outcome, amount, nonce);
    }

    function _commitUnique(bytes memory salt, ShadowOddsV2.Outcome outcome, uint256 amount)
        internal
        view
        returns (bytes32 commitment, bytes32 secret, uint256 nonce)
    {
        secret = keccak256(salt);
        nonce = uint256(keccak256(salt)) % 1e18;
        commitment = odds.computeCommitment(secret, outcome, amount, nonce);
    }

    // ─────────────────────── Yield Vault Integration ─────────────────────────

    function test_placeBet_depositsToVault() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;
        (bytes32 c,,) = _commit(alice, ShadowOddsV2.Outcome.YES, amount);

        vm.prank(alice);
        odds.placeBet(mid, c, amount);

        // USDC should be in the vault, NOT in the odds contract
        assertEq(usdc.balanceOf(address(vault)), amount);
        assertEq(usdc.balanceOf(address(odds)), 0);

        // Vault tracks the deposit
        (uint256 deposited,,,) = vault.getEstimatedYield(mid);
        assertEq(deposited, amount);
    }

    function test_yieldAccrues_overTime() public {
        uint256 mid = _createMarket();
        uint256 amount = 1000 * D6; // 1000 USDC
        (bytes32 c,,) = _commit(alice, ShadowOddsV2.Outcome.YES, amount);

        vm.prank(alice);
        odds.placeBet(mid, c, amount);

        // Warp 1 year
        vm.warp(block.timestamp + 365 days);

        (, uint256 yieldAmount,,) = vault.getEstimatedYield(mid);
        assertApproxEqAbs(yieldAmount, 50 * D6, 1 * D6);
        console2.log("1-year yield on 1000 USDC:", yieldAmount);
    }

    function test_claimWithYield_fullFlow() public {
        uint256 mid = odds.createMarket(
            "Long market for yield test",
            block.timestamp + 30 days,
            block.timestamp + 30 days + 1 hours,
            ShadowOddsV2.OracleType.ADMIN,
            address(0),
            bytes32(0),
            0
        );

        uint256 aliceAmt = 100 * D6;
        uint256 bobAmt = 200 * D6;

        (bytes32 ac, bytes32 as_, uint256 an) = _commit(alice, ShadowOddsV2.Outcome.YES, aliceAmt);
        (bytes32 bc, bytes32 bs, uint256 bn) = _commit(bob, ShadowOddsV2.Outcome.NO, bobAmt);

        vm.prank(alice);
        odds.placeBet(mid, ac, aliceAmt);
        vm.prank(bob);
        odds.placeBet(mid, bc, bobAmt);

        vm.warp(block.timestamp + 30 days + 1 hours);
        odds.resolveAdmin(mid, ShadowOddsV2.Outcome.YES);

        // revealBet now takes commitment as first arg after marketId
        vm.prank(alice);
        odds.revealBet(mid, ac, as_, ShadowOddsV2.Outcome.YES, aliceAmt, an);
        vm.prank(bob);
        odds.revealBet(mid, bc, bs, ShadowOddsV2.Outcome.NO, bobAmt, bn);

        // claimWinnings now takes commitment
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        odds.claimWinnings(mid, ac);
        uint256 aliceWinnings = usdc.balanceOf(alice) - aliceBefore;

        console2.log("Alice winnings (with yield):", aliceWinnings);
        assertGt(aliceWinnings, 297 * D6);

        assertTrue(odds.yieldWithdrawn(mid));
        uint256 yieldAmt = odds.marketYield(mid);
        console2.log("Market yield harvested:", yieldAmt);
        assertGt(yieldAmt, 0);
    }

    function test_yieldDistribution_proportional() public {
        uint256 mid = odds.createMarket(
            "Proportional yield test",
            block.timestamp + 30 days,
            block.timestamp + 30 days + 1 hours,
            ShadowOddsV2.OracleType.ADMIN,
            address(0),
            bytes32(0),
            0
        );

        uint256 aliceAmt = 300 * D6;
        uint256 bobAmt = 200 * D6;
        uint256 carolAmt = 100 * D6;

        (bytes32 ac, bytes32 as_, uint256 an) = _commit(alice, ShadowOddsV2.Outcome.YES, aliceAmt);
        (bytes32 bc, bytes32 bs, uint256 bn) = _commit(bob, ShadowOddsV2.Outcome.NO, bobAmt);
        (bytes32 cc, bytes32 cs, uint256 cn) = _commit(carol, ShadowOddsV2.Outcome.YES, carolAmt);

        vm.prank(alice);
        odds.placeBet(mid, ac, aliceAmt);
        vm.prank(bob);
        odds.placeBet(mid, bc, bobAmt);
        vm.prank(carol);
        odds.placeBet(mid, cc, carolAmt);

        vm.warp(block.timestamp + 30 days + 1 hours);
        odds.resolveAdmin(mid, ShadowOddsV2.Outcome.YES);

        vm.prank(alice);
        odds.revealBet(mid, ac, as_, ShadowOddsV2.Outcome.YES, aliceAmt, an);
        vm.prank(bob);
        odds.revealBet(mid, bc, bs, ShadowOddsV2.Outcome.NO, bobAmt, bn);
        vm.prank(carol);
        odds.revealBet(mid, cc, cs, ShadowOddsV2.Outcome.YES, carolAmt, cn);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        odds.claimWinnings(mid, ac);
        uint256 aliceWin = usdc.balanceOf(alice) - aliceBefore;

        uint256 carolBefore = usdc.balanceOf(carol);
        vm.prank(carol);
        odds.claimWinnings(mid, cc);
        uint256 carolWin = usdc.balanceOf(carol) - carolBefore;

        console2.log("Alice winnings:", aliceWin);
        console2.log("Carol winnings:", carolWin);
        assertGt(aliceWin, carolWin * 2);
    }

    function test_refund_withdrawsFromVault() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;
        (bytes32 c, bytes32 s, uint256 n) = _commit(alice, ShadowOddsV2.Outcome.YES, amount);

        vm.prank(alice);
        odds.placeBet(mid, c, amount);

        vm.warp(block.timestamp + 100 hours);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        odds.refund(mid, c, s, ShadowOddsV2.Outcome.YES, amount, n);
        assertEq(usdc.balanceOf(alice), before + amount);
    }

    function test_getYieldInfo_view() public {
        uint256 mid = _createMarket();
        uint256 amount = 500 * D6;
        (bytes32 c,,) = _commit(alice, ShadowOddsV2.Outcome.YES, amount);

        vm.prank(alice);
        odds.placeBet(mid, c, amount);

        vm.warp(block.timestamp + 7 days);

        (uint256 dep, uint256 yield_, uint256 depTime, uint256 apr, bool harvested) = odds.getYieldInfo(mid);
        assertEq(dep, amount);
        assertGt(yield_, 0);
        assertGt(depTime, 0);
        assertEq(apr, 500);
        assertFalse(harvested);
    }

    // ─────────────────── NEW: Commitment-Keyed Tests ────────────────────────

    function test_multipleBetsPerAddress() public {
        uint256 mid = _createMarket();
        uint256 amt1 = 50 * D6;
        uint256 amt2 = 75 * D6;

        // Alice places TWO bets on the same market with different commitments
        (bytes32 c1, bytes32 s1, uint256 n1) = _commitUnique("alice-bet-1", ShadowOddsV2.Outcome.YES, amt1);
        (bytes32 c2, bytes32 s2, uint256 n2) = _commitUnique("alice-bet-2", ShadowOddsV2.Outcome.NO, amt2);

        vm.startPrank(alice);
        odds.placeBet(mid, c1, amt1);
        odds.placeBet(mid, c2, amt2); // should NOT revert — different commitment
        vm.stopPrank();

        // Both bets tracked by commitment
        (address p1,, uint256 locked1,,,) = odds.bets(mid, c1);
        (address p2,, uint256 locked2,,,) = odds.bets(mid, c2);
        assertEq(p1, alice);
        assertEq(p2, alice);
        assertEq(locked1, amt1);
        assertEq(locked2, amt2);
    }

    function test_adapterPlaceAndClaim() public {
        uint256 mid = _createMarket();
        uint256 aliceAmt = 100 * D6;
        uint256 bobAmt = 50 * D6;

        // Adapter places bet on behalf of alice (simulating useInteract)
        (bytes32 ac, bytes32 as_, uint256 an) = _commitUnique("adapter-alice", ShadowOddsV2.Outcome.YES, aliceAmt);
        (bytes32 bc, bytes32 bs, uint256 bn) = _commit(bob, ShadowOddsV2.Outcome.NO, bobAmt);

        vm.prank(adapter);
        odds.placeBet(mid, ac, aliceAmt); // placer = adapter

        vm.prank(bob);
        odds.placeBet(mid, bc, bobAmt);

        // Verify placer is adapter, not alice
        (address placer,,,,, ) = odds.bets(mid, ac);
        assertEq(placer, adapter);

        // Resolve
        vm.warp(block.timestamp + 2 hours);
        odds.resolveAdmin(mid, ShadowOddsV2.Outcome.YES);

        // Anyone can reveal (no msg.sender check)
        odds.revealBet(mid, ac, as_, ShadowOddsV2.Outcome.YES, aliceAmt, an);
        vm.prank(bob);
        odds.revealBet(mid, bc, bs, ShadowOddsV2.Outcome.NO, bobAmt, bn);

        // Adapter claims (must match placer)
        uint256 adapterBefore = usdc.balanceOf(adapter);
        vm.prank(adapter);
        odds.claimWinnings(mid, ac);
        uint256 adapterWin = usdc.balanceOf(adapter) - adapterBefore;
        assertGt(adapterWin, aliceAmt); // won the bet
        console2.log("Adapter (on behalf of user) winnings:", adapterWin);
    }

    function test_anyoneCanReveal() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;
        (bytes32 c, bytes32 s, uint256 n) = _commit(alice, ShadowOddsV2.Outcome.YES, amount);

        vm.prank(alice);
        odds.placeBet(mid, c, amount);

        vm.warp(block.timestamp + 2 hours);
        odds.resolveAdmin(mid, ShadowOddsV2.Outcome.YES);

        // Bob reveals alice's bet (anyone with the secret can reveal)
        vm.prank(bob);
        odds.revealBet(mid, c, s, ShadowOddsV2.Outcome.YES, amount, n);

        // Verify it's revealed
        (,,, ShadowOddsV2.Outcome outcome, bool revealed,) = odds.bets(mid, c);
        assertTrue(revealed);
        assertEq(uint8(outcome), uint8(ShadowOddsV2.Outcome.YES));
    }

    function test_onlyPlacerCanClaim() public {
        uint256 mid = _createMarket();
        uint256 amount = 100 * D6;
        (bytes32 c, bytes32 s, uint256 n) = _commit(alice, ShadowOddsV2.Outcome.YES, amount);
        (bytes32 bc, bytes32 bs, uint256 bn) = _commit(bob, ShadowOddsV2.Outcome.NO, 50 * D6);

        vm.prank(alice);
        odds.placeBet(mid, c, amount);
        vm.prank(bob);
        odds.placeBet(mid, bc, 50 * D6);

        vm.warp(block.timestamp + 2 hours);
        odds.resolveAdmin(mid, ShadowOddsV2.Outcome.YES);

        odds.revealBet(mid, c, s, ShadowOddsV2.Outcome.YES, amount, n);
        vm.prank(bob);
        odds.revealBet(mid, bc, bs, ShadowOddsV2.Outcome.NO, 50 * D6, bn);

        // Bob tries to claim alice's bet — should revert with NotPlacer
        vm.prank(bob);
        vm.expectRevert(ShadowOddsV2.NotPlacer.selector);
        odds.claimWinnings(mid, c);

        // Alice can claim her own bet
        vm.prank(alice);
        odds.claimWinnings(mid, c); // should succeed
    }
}
