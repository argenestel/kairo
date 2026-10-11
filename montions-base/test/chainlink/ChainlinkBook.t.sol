// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ChainlinkTestBase} from "./ChainlinkTestBase.sol";
import {MontionsBook} from "../../src/MontionsBook.sol";
import {MontionsBookEngine} from "../../src/book/MontionsBookEngine.sol";
import {Quoter} from "../../src/Quoter.sol";
import {MakerVault} from "../../src/MakerVault.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";
import {IMontionsBook} from "../../src/interfaces/IMontionsBook.sol";
import {IQuoter} from "../../src/interfaces/IQuoter.sol";

/// @notice End to end on the real Book + Quoter + MakerVault with the Chainlink oracle/resolver (Base path).
contract ChainlinkBookTest is ChainlinkTestBase {
    uint256 internal constant UNIT = 1e6;
    address internal constant OWNER = address(0x0E);
    address internal constant KEEPER = address(0x4EE9);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    TestUSDC internal usdc;
    MontionsBook internal book;
    Quoter internal quoter;
    MakerVault internal vault;
    uint64 internal expiry;
    bytes32 internal seriesId;

    function setUp() public override {
        super.setUp();
        usdc = new TestUSDC(address(this));
        book = new MontionsBook(address(usdc), OWNER);
        quoter = new Quoter(address(book), address(resolver));
        vault = new MakerVault(address(book), address(quoter), OWNER);
        vm.startPrank(OWNER);
        book.setResolverAllowed(address(resolver), true);
        vault.setTrustedResolver(address(resolver));
        vault.setKeeper(KEEPER);
        vm.stopPrank();

        usdc.mint(address(this), 100_000 * UNIT);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(100_000 * UNIT, address(this));
        for (uint256 i; i < 2; ++i) {
            address u = i == 0 ? ALICE : BOB;
            usdc.mint(u, 10_000 * UNIT);
            vm.prank(u);
            usdc.approve(address(book), type(uint256).max);
        }

        expiry = uint64(START + 1 days);
        seriesId = book.createSeries(address(resolver), _data(ETH, 2500e18, true), expiry);
    }

    function _buy(address user, bool yes, uint8 limitTick, uint64 qty) internal returns (uint64 filled) {
        // YES: Bid at limit. NO: write-Ask at YES limit 100 - limitTick (consumes bids).
        IMontionsBook.PlaceParams memory p = IMontionsBook.PlaceParams({
            seriesId: seriesId,
            side: yes ? IMontionsBook.Side.Bid : IMontionsBook.Side.Ask,
            tick: yes ? limitTick : 100 - limitTick,
            qty: qty,
            fromHeld: false,
            tif: IMontionsBook.TIF.IOC,
            maxFills: 0
        });
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(IMontionsBook.deposit, (uint256(qty) * 100 * 10_000));
        calls[1] = abi.encodeCall(IMontionsBook.placeOrder, (p));
        vm.prank(user);
        bytes[] memory out = book.multicall(calls);
        (, filled,) = abi.decode(out[1], (uint64, uint64, uint64));
    }

    function testQuoterPricesChainlinkSeries() public view {
        (uint8 fairTick, uint256 probWad, uint256 volWad, uint256 spotWad) = quoter.fair(seriesId);
        assertEq(spotWad, 2500e18);
        assertEq(volWad, ETH_VOL);
        assertApproxEqAbs(probWad, 0.4937e18, 0.002e18); // ATM digital, sigma 60%, 1 day
        assertEq(fairTick, 49);
        IQuoter.Snapshot memory s = quoter.snapshot(seriesId);
        assertEq(s.title, "ETH >= $2500.00 at 2023-11-15 22:13 UTC (first Chainlink round at/after expiry, max 3600s)");
        assertEq(s.fairTick, 49);
    }

    function testQuoterGivesNoModelWhenFeedStale() public {
        vm.warp(START - 60 + STALENESS + 1);
        (uint8 fairTick,,,) = quoter.fair(seriesId);
        assertEq(fairTick, 0);
        vm.prank(KEEPER);
        vault.refresh(seriesId);
        (uint8 bid,, uint8 ask,) = book.bestBidAsk(seriesId);
        assertEq(bid, 0);
        assertEq(ask, 0, "vault does not quote without a fresh Chainlink price");
    }

    function testEndToEndBuySettleRedeemYes() public {
        vm.prank(KEEPER);
        vault.refresh(seriesId);
        (uint8 bid,, uint8 ask,) = book.bestBidAsk(seriesId);
        assertGt(bid, 0);
        assertGt(ask, bid);
        assertLe(bid, 49);
        assertGe(ask, 49);

        IQuoter.Quote memory q = quoter.quoteBuy(seriesId, true, 10, 99);
        assertEq(q.filled, 10);
        uint64 filled = _buy(ALICE, true, q.worstTick, 10);
        assertEq(filled, 10);
        IMontionsBook.SeriesInfo memory info = book.seriesInfo(seriesId);
        assertEq(book.balanceOf(ALICE, info.yesId), 10);

        IQuoter.Quote memory qn = quoter.quoteBuy(seriesId, false, 5, 99);
        assertEq(qn.filled, 5);
        assertEq(_buy(BOB, false, qn.worstTick, 5), 5);
        assertEq(book.balanceOf(BOB, info.noId), 5);
        assertEq(book.balanceOf(address(vault), info.noId), 10);
        assertEq(book.balanceOf(address(vault), info.yesId), 5);

        // Expiry passes; Chainlink reports 2600 forty seconds later.
        ethFeed.push(2550e8, expiry - 200);
        vm.warp(expiry + 10);
        vm.expectRevert(IMontionsBook.NotExpired.selector); // not recorded yet, inside the grace period
        book.resolve(seriesId);
        ethFeed.push(2600e8, expiry + 40);
        vm.warp(expiry + 60);
        resolver.recordAsset(ETH, expiry);
        book.resolve(seriesId);
        info = book.seriesInfo(seriesId);
        assertEq(uint256(info.status), uint256(IMontionsBook.Status.Resolved));
        assertTrue(info.yes);

        uint256 aliceCash = book.cash(ALICE);
        vm.prank(ALICE);
        assertEq(book.redeem(seriesId, 10, 0), 10 * UNIT);
        assertEq(book.cash(ALICE), aliceCash + 10 * UNIT);
        vm.prank(BOB);
        assertEq(book.redeem(seriesId, 0, 5), 0);

        uint256 vaultYes = book.balanceOf(address(vault), info.yesId);
        uint256 vaultNo = book.balanceOf(address(vault), info.noId);
        assertEq(vaultYes, 5);
        assertEq(vaultNo, 10);
        uint256 navBefore = vault.totalAssets();
        uint256 vaultCashBefore = book.cash(address(vault));
        uint256 vaultLockedBefore = book.lockedCash(address(vault));
        assertEq(vault.redeemSeries(seriesId), vaultYes * UNIT);
        assertEq(book.cash(address(vault)), vaultCashBefore + vaultLockedBefore + vaultYes * UNIT);
        assertEq(book.balanceOf(address(vault), info.yesId), 0);
        assertEq(book.balanceOf(address(vault), info.noId), 0);
        assertEq(vault.totalAssets(), navBefore);
        assertEq(book.pool(seriesId), 0);
    }

    function testEndToEndNoWinsBelowStrike() public {
        vm.prank(KEEPER);
        vault.refresh(seriesId);
        IQuoter.Quote memory qn = quoter.quoteBuy(seriesId, false, 3, 99);
        assertEq(_buy(BOB, false, qn.worstTick, 3), 3);
        ethFeed.push(2490e8, expiry + 1);
        vm.warp(expiry + 2);
        resolver.recordFirstRound(address(ethFeed), expiry);
        book.resolve(seriesId);
        assertFalse(book.seriesInfo(seriesId).yes);
        vm.prank(BOB);
        assertEq(book.redeem(seriesId, 0, 3), 3 * UNIT);
    }

    function testVoidWhenNoRoundAfterExpiry() public {
        vm.prank(ALICE);
        book.deposit(2 * UNIT);
        vm.prank(ALICE);
        book.split(seriesId, 2);
        vm.warp(expiry + 1 hours);
        (, bool found) = resolver.findRound(address(ethFeed), expiry);
        assertFalse(found);
        vm.expectRevert(IMontionsBook.NotExpired.selector);
        book.resolve(seriesId);
        vm.warp(uint256(expiry) + book.VOID_GRACE());
        book.resolve(seriesId);
        assertEq(uint256(book.seriesInfo(seriesId).status), uint256(IMontionsBook.Status.Void));
        vm.prank(ALICE);
        assertEq(book.redeem(seriesId, 1, 1), UNIT);
        vm.prank(ALICE);
        assertEq(book.redeem(seriesId, 1, 0), UNIT / 2);
    }

    function testVoidWhenFirstRoundIsTooLate() public {
        vm.prank(ALICE);
        book.deposit(UNIT);
        vm.prank(ALICE);
        book.split(seriesId, 1);
        ethFeed.push(9000e8, expiry + SETTLE_DELAY + 1); // feed stalled through expiry
        vm.warp(expiry + SETTLE_DELAY + 5);
        resolver.recordFirstRound(address(ethFeed), expiry);
        vm.expectRevert(IMontionsBook.NotExpired.selector);
        book.resolve(seriesId);
        vm.warp(uint256(expiry) + book.VOID_GRACE());
        book.resolve(seriesId);
        assertEq(uint256(book.seriesInfo(seriesId).status), uint256(IMontionsBook.Status.Void));
    }

    function testCreateSeriesRejectsNonCanonicalDelay() public {
        bytes memory bad = abi.encode(address(oracle), ETH, 2500e18, true, uint32(60));
        vm.expectRevert(MontionsBook.ResolverValidationFailed.selector);
        book.createSeries(address(resolver), bad, expiry);
    }

    // ───────────────────────── EIP-170 split ─────────────────────────

    function testBookFitsEip170AndEngineIsLinked() public view {
        assertLt(address(book).code.length, 24_577);
        assertLt(book.engine().code.length, 24_577);
        assertGt(book.engine().code.length, 0);
    }

    function testEngineRejectsDirectCalls() public {
        MontionsBookEngine engine = MontionsBookEngine(book.engine());
        IMontionsBook.PlaceParams memory p = IMontionsBook.PlaceParams({
            seriesId: seriesId,
            side: IMontionsBook.Side.Bid,
            tick: 50,
            qty: 1,
            fromHeld: false,
            tif: IMontionsBook.TIF.GTC,
            maxFills: 0
        });
        vm.expectRevert(MontionsBookEngine.DirectCallNotAllowed.selector);
        engine.placeOrder(p);
        vm.expectRevert(MontionsBookEngine.DirectCallNotAllowed.selector);
        engine.cancelOrder(1);
        vm.expectRevert(MontionsBookEngine.DirectCallNotAllowed.selector);
        engine.cancelOrders(new uint64[](0));
    }

    function testDelegatedOrderEventsComeFromBookAndShareStorage() public {
        vm.prank(ALICE);
        book.deposit(UNIT);
        IMontionsBook.PlaceParams memory p = IMontionsBook.PlaceParams({
            seriesId: seriesId,
            side: IMontionsBook.Side.Bid,
            tick: 30,
            qty: 2,
            fromHeld: false,
            tif: IMontionsBook.TIF.GTC,
            maxFills: 0
        });
        vm.expectEmit(true, true, true, true, address(book));
        emit IMontionsBook.OrderPlaced(1, seriesId, ALICE, IMontionsBook.Side.Bid, 30, 2, false);
        vm.prank(ALICE);
        (uint64 id,, uint64 resting) = book.placeOrder(p);
        assertEq(id, 1);
        assertEq(resting, 2);
        assertEq(book.orderCount(), 1);
        assertEq(book.lockedCash(ALICE), 2 * 30 * 10_000);
        (uint8 bid, uint64 bidQty,,) = book.bestBidAsk(seriesId);
        assertEq(bid, 30);
        assertEq(bidQty, 2);
        vm.prank(BOB);
        vm.expectRevert(IMontionsBook.NotOrderOwner.selector);
        book.cancelOrder(id);
        vm.prank(ALICE);
        book.cancelOrder(id);
        assertEq(book.lockedCash(ALICE), 0);
        assertEq(book.cash(ALICE), UNIT);
    }

    function testPausedBlocksDelegatedPlacement() public {
        vm.prank(OWNER);
        book.setPaused(true);
        vm.prank(ALICE);
        vm.expectRevert(MontionsBook.Paused.selector);
        book.placeOrder(
            IMontionsBook.PlaceParams({
                seriesId: seriesId,
                side: IMontionsBook.Side.Bid,
                tick: 30,
                qty: 1,
                fromHeld: false,
                tif: IMontionsBook.TIF.GTC,
                maxFills: 0
            })
        );
    }

    function testQuoterRefusesPrintOlderThanTwoHeartbeats() public {
        // Print is 41 minutes old: still inside maxStaleness (1h) but past 2× Base's 20-min heartbeat.
        vm.warp(START - 60 + 41 minutes);
        assertTrue(oracle.isHealthy(ETH), "oracle maxStaleness is still 1h");
        (uint8 fairTick,,,) = quoter.fair(seriesId);
        assertEq(fairTick, 0, "Quoter must not treat a 41-minute-old print as a good quote");
        vm.prank(KEEPER);
        vault.refresh(seriesId);
        (uint8 bid,, uint8 ask,) = book.bestBidAsk(seriesId);
        assertEq(bid, 0);
        assertEq(ask, 0);
    }

    function testQuoterKeepsConfiguredStableVol() public {
        oracle.setRisk(ETH, 0.05e18, STALENESS);
        (,, uint256 volWad,) = quoter.fair(seriesId);
        assertEq(volWad, 0.05e18, "do not 30%-floor operator-configured vol");
    }

    function testVaultAllowlistSkipsUntrustedAsset() public {
        vm.prank(OWNER);
        vault.setTrustedAsset(keccak256("BTC"), true, 500e18); // ETH series is not BTC
        vm.prank(KEEPER);
        vault.refresh(seriesId);
        (uint8 bid,, uint8 ask,) = book.bestBidAsk(seriesId);
        assertEq(bid, 0);
        assertEq(ask, 0);

        vm.prank(OWNER);
        vault.setTrustedAsset(ETH, true, 25e18);
        vm.prank(KEEPER);
        vault.refresh(seriesId);
        (bid,, ask,) = book.bestBidAsk(seriesId);
        assertGt(bid, 0);
        assertGt(ask, bid);
    }

    function testCreateSeriesRejectsOffGridWhenLadderPolicySet() public {
        oracle.setMarketPolicy(ETH, 1200, 25e18, true);
        bytes memory offGrid = abi.encode(address(oracle), ETH, uint256(2512e18), true, SETTLE_DELAY);
        vm.expectRevert(MontionsBook.ResolverValidationFailed.selector);
        book.createSeries(address(resolver), offGrid, uint64(block.timestamp + 2 days));
        bytes32 id = book.createSeries(
            address(resolver), abi.encode(address(oracle), ETH, uint256(2500e18), true, SETTLE_DELAY), uint64(block.timestamp + 2 days)
        );
        assertTrue(id != bytes32(0));
    }
}
