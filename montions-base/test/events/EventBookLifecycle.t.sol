// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IMontionsBook} from "../../src/interfaces/IMontionsBook.sol";
import {MontionsBook} from "../../src/MontionsBook.sol";
import {OptimisticEventResolver} from "../../src/resolvers/OptimisticEventResolver.sol";
import {EventOutcome, EventStatus, EventRegistration, DEFAULT_CHALLENGE_WINDOW, DEFAULT_BOND_AMOUNT} from "../../src/resolvers/events/EventTypes.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";

/// @notice Full Book lifecycle for event markets: register → series → trade → propose → resolve → redeem.
contract EventBookLifecycleTest is Test {
    uint256 internal constant UNIT = 1_000_000;
    uint256 internal constant TICK_UNIT = 10_000;

    address internal constant BOOK_OWNER = address(0xB00C);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant PROPOSER = address(0xA55E47);
    address internal constant DISPUTER = address(0xD15);
    address internal constant TREASURY = address(0xFEE);

    TestUSDC internal usdc;
    MontionsBook internal book;
    OptimisticEventResolver internal resolver;

    bytes32 internal eventKey;
    bytes32 internal seriesId;
    uint64 internal closeTime;
    bytes32 internal rulesHash;
    bytes internal data;
    string internal constant RULES =
        "YES if the fixture resolves yes. INVALID voids 50/50. Timezone: UTC. Source: this test.";

    function setUp() public {
        usdc = new TestUSDC(address(this));
        book = new MontionsBook(address(usdc), BOOK_OWNER);
        resolver = new OptimisticEventResolver(address(usdc), BOOK_OWNER, TREASURY, BOOK_OWNER);

        vm.prank(BOOK_OWNER);
        book.setResolverAllowed(address(resolver), true);

        closeTime = uint64(block.timestamp + book.MIN_DURATION() + 1 days);
        rulesHash = keccak256(bytes(RULES));
        vm.prank(BOOK_OWNER);
        resolver.registerEvent(
            EventRegistration({
                key: "LIFECYCLE-EVENT",
                question: "Will the lifecycle fixture resolve YES?",
                rules: RULES,
                source: "https://example.com/lifecycle",
                closeTime: closeTime,
                category: "other",
                icon: "x"
            })
        );
        eventKey = resolver.eventKeyOf("LIFECYCLE-EVENT");
        data = resolver.encode(eventKey, closeTime, rulesHash);

        vm.prank(ALICE);
        seriesId = book.createSeries(address(resolver), data, closeTime);
        assertEq(seriesId, book.seriesIdOf(address(resolver), data, closeTime));

        _fund(ALICE, 1_000_000e6);
        _fund(BOB, 1_000_000e6);
        _fund(PROPOSER, 10_000e6);
        _fund(DISPUTER, 10_000e6);
        _approve(ALICE, address(book));
        _approve(BOB, address(book));
        _approve(PROPOSER, address(resolver));
        _approve(DISPUTER, address(resolver));
    }

    function _fund(address user, uint256 amount) internal {
        usdc.mint(user, amount);
    }

    function _approve(address user, address spender) internal {
        vm.prank(user);
        usdc.approve(spender, type(uint256).max);
    }

    function _deposit(address user, uint256 amount) internal {
        vm.prank(user);
        book.deposit(amount);
    }

    function _params(uint8 tick, uint64 qty, IMontionsBook.Side side)
        internal
        view
        returns (IMontionsBook.PlaceParams memory p)
    {
        p = IMontionsBook.PlaceParams({
            seriesId: seriesId,
            side: side,
            tick: tick,
            qty: qty,
            fromHeld: false,
            tif: IMontionsBook.TIF.GTC,
            maxFills: 0
        });
    }

    function testMismatchedRulesHashRejectedByBook() public {
        uint64 later = uint64(block.timestamp + book.MIN_DURATION() + 2 days);
        vm.prank(BOOK_OWNER);
        resolver.registerEvent(
            EventRegistration({
                key: "OTHER",
                question: "q",
                rules: "different-rules",
                source: "https://x",
                closeTime: later,
                category: "crypto",
                icon: ""
            })
        );
        bytes32 key = resolver.eventKeyOf("OTHER");
        bytes memory bad = resolver.encode(key, later, keccak256("nope"));
        vm.expectRevert(MontionsBook.ResolverValidationFailed.selector);
        book.createSeries(address(resolver), bad, later);
    }

    function testCreateSeriesRejectsExpiryNotEqualToCloseTime() public {
        uint64 expiry = uint64(closeTime + 60);
        // Book duration bounds still hold; resolver validate fails on expiry mismatch.
        vm.expectRevert(MontionsBook.ResolverValidationFailed.selector);
        book.createSeries(address(resolver), data, expiry);
    }

    function testFullLifecycleTradeProposeResolveRedeemYes() public {
        _deposit(ALICE, 100 * UNIT);
        _deposit(BOB, 100 * UNIT);

        vm.prank(ALICE);
        book.placeOrder(_params(40, 10, IMontionsBook.Side.Ask));
        vm.prank(BOB);
        (uint64 orderId, uint64 filled, uint64 resting) = book.placeOrder(_params(40, 10, IMontionsBook.Side.Bid));
        orderId;
        assertEq(filled, 10);
        assertEq(resting, 0);

        IMontionsBook.SeriesInfo memory info = book.seriesInfo(seriesId);
        assertEq(book.balanceOf(BOB, info.yesId), 10);
        assertEq(book.balanceOf(ALICE, info.noId), 10);
        assertEq(book.pool(seriesId), 10 * UNIT);

        vm.warp(closeTime);
        vm.expectRevert(IMontionsBook.NotExpired.selector);
        book.resolve(seriesId);

        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);

        vm.warp(uint256(closeTime) + 1);
        vm.expectRevert(IMontionsBook.NotExpired.selector);
        book.resolve(seriesId); // still in challenge window → not ready, before VOID_GRACE

        vm.warp(uint256(closeTime) + DEFAULT_CHALLENGE_WINDOW + 1);
        book.resolve(seriesId);
        info = book.seriesInfo(seriesId);
        assertEq(uint256(info.status), uint256(IMontionsBook.Status.Resolved));
        assertTrue(info.yes);

        vm.prank(BOB);
        uint256 payout = book.redeem(seriesId, 10, 0);
        assertEq(payout, 10 * UNIT);
        vm.prank(ALICE);
        assertEq(book.redeem(seriesId, 0, 10), 0);
        assertEq(book.pool(seriesId), 0);

        resolver.finalize(eventKey);
        assertEq(usdc.balanceOf(PROPOSER), 10_000e6);
    }

    function testInvalidVoidsFiftyFiftyAfterGrace() public {
        _deposit(ALICE, 10 * UNIT);
        vm.prank(ALICE);
        book.split(seriesId, 4);

        vm.warp(closeTime);
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Invalid);
        vm.warp(uint256(closeTime) + DEFAULT_CHALLENGE_WINDOW + 1);

        vm.expectRevert(IMontionsBook.NotExpired.selector);
        book.resolve(seriesId);

        vm.warp(uint256(closeTime) + book.VOID_GRACE());
        book.resolve(seriesId);
        IMontionsBook.SeriesInfo memory info = book.seriesInfo(seriesId);
        assertEq(uint256(info.status), uint256(IMontionsBook.Status.Void));

        vm.prank(ALICE);
        uint256 payout = book.redeem(seriesId, 4, 4);
        assertEq(payout, 4 * UNIT);
    }

    function testNobodyProposesVoidsAfterGrace() public {
        _deposit(ALICE, 2 * UNIT);
        vm.prank(ALICE);
        book.split(seriesId, 2);
        vm.warp(uint256(closeTime) + 1);
        vm.expectRevert(IMontionsBook.NotExpired.selector);
        book.resolve(seriesId);
        vm.warp(uint256(closeTime) + book.VOID_GRACE());
        book.resolve(seriesId);
        assertEq(uint256(book.seriesInfo(seriesId).status), uint256(IMontionsBook.Status.Void));
        vm.prank(ALICE);
        assertEq(book.redeem(seriesId, 1, 1), UNIT);
    }

    function testDisputedYesThenArbitrateNoRedeemsNo() public {
        _deposit(ALICE, 50 * UNIT);
        _deposit(BOB, 50 * UNIT);
        vm.prank(ALICE);
        book.placeOrder(_params(50, 5, IMontionsBook.Side.Ask));
        vm.prank(BOB);
        book.placeOrder(_params(50, 5, IMontionsBook.Side.Bid));

        vm.warp(closeTime);
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);
        vm.prank(DISPUTER);
        resolver.dispute(eventKey);
        vm.prank(BOOK_OWNER);
        resolver.arbitrate(eventKey, EventOutcome.No);

        vm.warp(uint256(closeTime) + 1);
        book.resolve(seriesId);
        assertFalse(book.seriesInfo(seriesId).yes);

        IMontionsBook.SeriesInfo memory info = book.seriesInfo(seriesId);
        vm.prank(ALICE);
        assertEq(book.redeem(seriesId, 0, 5), 5 * UNIT);
        vm.prank(BOB);
        assertEq(book.redeem(seriesId, 5, 0), 0);
        info;
    }

    function testTradingStopsAtCloseTime() public {
        _deposit(ALICE, 10 * UNIT);
        vm.warp(closeTime);
        vm.expectRevert(IMontionsBook.Expired.selector);
        vm.prank(ALICE);
        book.placeOrder(_params(50, 1, IMontionsBook.Side.Bid));
    }
}
