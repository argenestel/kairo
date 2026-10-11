// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {Ownable} from "solady/auth/Ownable.sol";

import {KeeperFeed} from "../../src/oracle/keeperfeed/KeeperFeed.sol";
import {KeeperFeedHub} from "../../src/oracle/keeperfeed/KeeperFeedHub.sol";
import {ChainlinkOracle} from "../../src/oracle/chainlink/ChainlinkOracle.sol";
import {ChainlinkSettlementResolver as R} from "../../src/resolvers/ChainlinkSettlementResolver.sol";

contract KeeperFeedTest is Test {
    uint256 internal constant START = 1_700_000_000;
    uint32 internal constant SETTLE_DELAY = 3600;
    uint32 internal constant STALENESS = 2 days;
    uint256 internal constant VOL = 0.41e18;
    bytes32 internal constant TSLA = keccak256("TSLA");
    bytes32 internal constant AMD = keccak256("AMD");

    address internal owner = address(this);
    address internal reporter = address(0x4EE9);
    address internal stranger = address(0xBAD);

    KeeperFeedHub internal hub;
    KeeperFeed internal tsla;
    ChainlinkOracle internal oracle;
    R internal resolver;

    function setUp() public {
        vm.warp(START);
        hub = new KeeperFeedHub(owner, reporter);
        tsla = KeeperFeed(hub.createFeed("TSLA"));
        oracle = new ChainlinkOracle(owner);
        resolver = new R(address(oracle));
    }

    function _pid(uint64 agg) internal pure returns (uint80) {
        return (uint80(1) << 64) | uint80(agg);
    }

    function _push(bytes32 id, int256 price, uint64 observedAt) internal {
        bytes32[] memory ids = new bytes32[](1);
        int256[] memory prices = new int256[](1);
        uint64[] memory obs = new uint64[](1);
        ids[0] = id;
        prices[0] = price;
        obs[0] = observedAt;
        vm.prank(reporter);
        hub.push(ids, prices, obs);
    }

    function _force(bytes32 id, int256 price, uint64 observedAt) internal {
        bytes32[] memory ids = new bytes32[](1);
        int256[] memory prices = new int256[](1);
        uint64[] memory obs = new uint64[](1);
        ids[0] = id;
        prices[0] = price;
        obs[0] = observedAt;
        hub.forcePush(ids, prices, obs);
    }

    function _seedAndRegister(int256 price) internal {
        _push(TSLA, price, uint64(block.timestamp));
        oracle.setFeed(TSLA, address(tsla), "TSLA", "USD", SETTLE_DELAY, VOL, STALENESS);
    }

    // ───────────────────────── AggregatorV3 ─────────────────────────

    function testAggregatorV3Metadata() public view {
        assertEq(tsla.decimals(), 8);
        assertEq(tsla.version(), 1);
        assertEq(tsla.description(), "TSLA / USD (keeper-reported)");
        assertEq(tsla.phaseId(), 1);
        assertEq(tsla.aggregator(), address(tsla));
        assertEq(tsla.phaseAggregators(1), address(tsla));
        assertEq(tsla.phaseAggregators(2), address(0));
        assertEq(tsla.symbol(), "TSLA");
        assertEq(tsla.hub(), address(hub));
    }

    function testEmptyLatestRoundIsZero() public view {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            tsla.latestRoundData();
        assertEq(roundId, 0);
        assertEq(answer, 0);
        assertEq(startedAt, 0);
        assertEq(updatedAt, 0);
        assertEq(answeredInRound, 0);
    }

    function testReportWritesChainlinkShapedRound() public {
        _push(TSLA, 382.7e8, uint64(START - 10));
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            tsla.latestRoundData();
        assertEq(roundId, _pid(1));
        assertEq(answer, 382.7e8);
        assertEq(startedAt, START);
        assertEq(updatedAt, START);
        assertEq(startedAt, updatedAt);
        assertEq(answeredInRound, roundId);
        (uint80 rid, int256 a, uint256 s, uint256 u, uint80 air) = tsla.getRoundData(roundId);
        assertEq(rid, roundId);
        assertEq(a, answer);
        assertEq(s, startedAt);
        assertEq(u, updatedAt);
        assertEq(air, roundId);
        (int256 obsAnswer, uint64 observedAt,,) = tsla.latestObservation();
        assertEq(obsAnswer, 382.7e8);
        assertEq(observedAt, START - 10);
    }

    function testRoundIdsMonotonicSinglePhase() public {
        _push(TSLA, 100e8, uint64(START));
        vm.warp(START + 300);
        _push(TSLA, 101e8, uint64(START + 300));
        vm.warp(START + 600);
        _push(TSLA, 102e8, uint64(START + 600));
        (uint80 latest,,,,) = tsla.latestRoundData();
        assertEq(latest, _pid(3));
        assertEq(uint16(latest >> 64), 1);
        (uint80 r1,, uint256 t1,,) = tsla.getRoundData(_pid(1));
        (uint80 r2,, uint256 t2,,) = tsla.getRoundData(_pid(2));
        (uint80 r3,, uint256 t3,,) = tsla.getRoundData(_pid(3));
        assertEq(r1, _pid(1));
        assertEq(r2, _pid(2));
        assertEq(r3, _pid(3));
        assertEq(r2, r1 + 1);
        assertEq(r3, r2 + 1);
        assertLt(t1, t2);
        assertLt(t2, t3);
    }

    function testMissingAndOtherPhaseRoundsAreZero() public {
        _push(TSLA, 100e8, uint64(START));
        (uint80 rid, int256 a,, uint256 u,) = tsla.getRoundData(_pid(9));
        assertEq(rid, _pid(9));
        assertEq(a, 0);
        assertEq(u, 0);
        uint80 phase2 = (uint80(2) << 64) | 1;
        (, int256 a2,, uint256 u2,) = tsla.getRoundData(phase2);
        assertEq(a2, 0);
        assertEq(u2, 0);
    }

    function testDirectReportRejected() public {
        vm.expectRevert(KeeperFeed.NotHub.selector);
        tsla.report(1e8, uint64(START));
    }

    // ───────────────────────── hub roles / bounds ─────────────────────────

    function testStrangerCannotPushOrCreate() public {
        bytes32[] memory ids = new bytes32[](1);
        int256[] memory prices = new int256[](1);
        uint64[] memory obs = new uint64[](1);
        ids[0] = TSLA;
        prices[0] = 1e8;
        obs[0] = uint64(START);
        vm.prank(stranger);
        vm.expectRevert(KeeperFeedHub.NotReporter.selector);
        hub.push(ids, prices, obs);
        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        hub.createFeed("AMD");
        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        hub.forcePush(ids, prices, obs);
    }

    function _pushAs(address who, bytes32 id, int256 price, uint64 observedAt) internal {
        bytes32[] memory ids = new bytes32[](1);
        int256[] memory prices = new int256[](1);
        uint64[] memory obs = new uint64[](1);
        ids[0] = id;
        prices[0] = price;
        obs[0] = observedAt;
        vm.prank(who);
        hub.push(ids, prices, obs);
    }

    function testOwnerCanPushWithoutReporterRole() public {
        hub.setReporter(reporter, false);
        _pushAs(owner, TSLA, 100e8, uint64(START));
        (, int256 answer,,,) = tsla.latestRoundData();
        assertEq(answer, 100e8);
    }

    function testRejectsFutureAndStaleObservedAt() public {
        _push(TSLA, 100e8, uint64(START - 50));
        bytes32[] memory ids = new bytes32[](1);
        int256[] memory prices = new int256[](1);
        uint64[] memory obs = new uint64[](1);
        ids[0] = TSLA;
        prices[0] = 101e8;
        obs[0] = uint64(START + 1);
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(KeeperFeedHub.FutureObservation.selector, TSLA, uint64(START + 1)));
        hub.push(ids, prices, obs);
        obs[0] = uint64(START - 51);
        vm.prank(reporter);
        vm.expectRevert(
            abi.encodeWithSelector(KeeperFeedHub.StaleObservation.selector, TSLA, uint64(START - 51), uint64(START - 50))
        );
        hub.push(ids, prices, obs);
    }

    function testEqualObservedAtIsNotStale() public {
        _push(TSLA, 100e8, uint64(START));
        // same observedAt, different price within bound, heartbeat not elapsed → writes because price changed
        _push(TSLA, 101e8, uint64(START));
        (, int256 answer,,,) = tsla.latestRoundData();
        assertEq(answer, 101e8);
        assertEq(tsla.latestAggRound(), 2);
    }

    function testDeviationBound25Percent() public {
        _push(TSLA, 100e8, uint64(START));
        _push(TSLA, 125e8, uint64(START)); // exactly 25% of 100
        (, int256 answer,,,) = tsla.latestRoundData();
        assertEq(answer, 125e8);

        bytes32[] memory ids = new bytes32[](1);
        int256[] memory prices = new int256[](1);
        uint64[] memory obs = new uint64[](1);
        ids[0] = TSLA;
        prices[0] = 125e8 + (125e8 / 4) + 1; // >25% of 125
        obs[0] = uint64(START);
        vm.prank(reporter);
        vm.expectRevert(
            abi.encodeWithSelector(KeeperFeedHub.DeviationTooLarge.selector, TSLA, int256(125e8), prices[0])
        );
        hub.push(ids, prices, obs);

        // from 100, 25%+1 wei is also rejected (fresh feed)
        KeeperFeed amd = KeeperFeed(hub.createFeed("AMD"));
        _push(AMD, 100e8, uint64(START));
        ids[0] = AMD;
        prices[0] = 125e8 + 1;
        vm.prank(reporter);
        vm.expectRevert(
            abi.encodeWithSelector(KeeperFeedHub.DeviationTooLarge.selector, AMD, int256(100e8), int256(125e8 + 1))
        );
        hub.push(ids, prices, obs);
        assertEq(amd.latestAggRound(), 1);

        _force(TSLA, 200e8, uint64(START)); // owner bypass
        (, answer,,,) = tsla.latestRoundData();
        assertEq(answer, 200e8);
        assertEq(tsla.latestAggRound(), 3);
    }

    function testSkipUnchangedInsideHeartbeat() public {
        _push(TSLA, 100e8, uint64(START));
        vm.expectEmit(true, true, false, true, address(hub));
        emit KeeperFeedHub.PriceSkipped(TSLA, address(tsla), 100e8, uint64(START));
        _push(TSLA, 100e8, uint64(START));
        assertEq(tsla.latestAggRound(), 1);

        vm.warp(START + hub.heartbeat());
        _push(TSLA, 100e8, uint64(START + hub.heartbeat()));
        assertEq(tsla.latestAggRound(), 2);
    }

    function testForcePushWritesEvenWhenUnchanged() public {
        _push(TSLA, 100e8, uint64(START));
        _force(TSLA, 100e8, uint64(START));
        assertEq(tsla.latestAggRound(), 2);
    }

    function testRejectsNonPositiveAndUnknownAndLength() public {
        bytes32[] memory ids = new bytes32[](1);
        int256[] memory prices = new int256[](1);
        uint64[] memory obs = new uint64[](1);
        ids[0] = TSLA;
        prices[0] = 0;
        obs[0] = uint64(START);
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(KeeperFeedHub.InvalidPrice.selector, int256(0)));
        hub.push(ids, prices, obs);

        ids[0] = keccak256("NOPE");
        prices[0] = 1e8;
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(KeeperFeedHub.UnknownFeed.selector, keccak256("NOPE")));
        hub.push(ids, prices, obs);

        int256[] memory bad = new int256[](2);
        vm.prank(reporter);
        vm.expectRevert(KeeperFeedHub.LengthMismatch.selector);
        hub.push(ids, bad, obs);
    }

    function testCannotCreateDuplicate() public {
        vm.expectRevert(abi.encodeWithSelector(KeeperFeedHub.FeedExists.selector, TSLA));
        hub.createFeed("TSLA");
    }

    function testSetHeartbeatAndDeviationAndReporter() public {
        hub.setHeartbeat(1 hours);
        assertEq(hub.heartbeat(), 1 hours);
        hub.setMaxDeviationBps(1_000);
        assertEq(hub.maxDeviationBps(), 1_000);
        hub.setReporter(stranger, true);
        assertTrue(hub.isReporter(stranger));
        vm.expectRevert(abi.encodeWithSelector(KeeperFeedHub.InvalidHeartbeat.selector, uint64(8 days)));
        hub.setHeartbeat(8 days);
        vm.expectRevert(abi.encodeWithSelector(KeeperFeedHub.InvalidDeviation.selector, uint16(0)));
        hub.setMaxDeviationBps(0);
    }

    // ───────────────────────── oracle registration ─────────────────────────

    function testOracleRegistersKeeperFeed() public {
        _seedAndRegister(382.7e8);
        assertTrue(oracle.assetExists(TSLA));
        assertEq(oracle.feedOf(TSLA), address(tsla));
        (uint256 priceWad, uint64 updatedAt) = oracle.latestPrice(TSLA);
        assertEq(priceWad, 382.7e18);
        assertEq(updatedAt, START);
        assertTrue(oracle.isHealthy(TSLA));
    }

    // ───────────────────────── settlement adjacency ─────────────────────────

    function testResolverSelectsFirstRoundAtOrAfterExpiry() public {
        _seedAndRegister(380e8);
        uint64 expiry = uint64(START + 1 hours);

        vm.warp(expiry - 300);
        _push(TSLA, 381e8, uint64(expiry - 300)); // round 2
        vm.warp(expiry + 40);
        _push(TSLA, 390e8, uint64(expiry + 40)); // round 3 — first at/after expiry
        vm.warp(expiry + 700);
        _push(TSLA, 400e8, uint64(expiry + 700)); // round 4
        vm.warp(expiry + 800);

        (uint80 hint, bool found) = resolver.findRound(address(tsla), expiry);
        assertTrue(found);
        assertEq(hint, _pid(3));
        (int256 answer, uint256 updatedAt) = resolver.record(address(tsla), expiry, hint);
        assertEq(answer, 390e8);
        assertEq(updatedAt, expiry + 40);

        bytes memory data = abi.encode(address(oracle), TSLA, uint256(385e18), true, SETTLE_DELAY);
        (bool ready, bool yes) = resolver.resolve(data, expiry);
        assertTrue(ready);
        assertTrue(yes);

        data = abi.encode(address(oracle), TSLA, uint256(385e18), false, SETTLE_DELAY);
        (ready, yes) = resolver.resolve(data, expiry);
        assertTrue(ready);
        assertFalse(yes);
    }

    function testResolverRoundExactlyAtExpiry() public {
        _seedAndRegister(380e8);
        uint64 expiry = uint64(START + 1 hours);
        vm.warp(expiry - 1);
        _push(TSLA, 381e8, uint64(expiry - 1));
        vm.warp(expiry);
        _push(TSLA, 382e8, uint64(expiry));
        vm.warp(expiry + 10);
        _push(TSLA, 383e8, uint64(expiry + 10));

        (uint80 hint, bool found) = resolver.findRound(address(tsla), expiry);
        assertTrue(found);
        assertEq(hint, _pid(3));
        resolver.recordFirstRound(address(tsla), expiry);
        vm.expectRevert(abi.encodeWithSelector(R.AlreadyRecorded.selector, address(tsla), expiry));
        resolver.record(address(tsla), expiry, _pid(4));

        (bool ready, bool yes) =
            resolver.resolve(abi.encode(address(oracle), TSLA, uint256(382e18), true, SETTLE_DELAY), expiry);
        assertTrue(ready);
        assertTrue(yes);
    }

    function testResolverRejectsHintTooEarlyAndNotFirst() public {
        _seedAndRegister(380e8);
        uint64 expiry = uint64(START + 1 hours);
        vm.warp(expiry - 10);
        _push(TSLA, 381e8, uint64(expiry - 10));
        vm.warp(expiry + 5);
        _push(TSLA, 390e8, uint64(expiry + 5));
        uint80 early = _pid(2);
        vm.expectRevert(abi.encodeWithSelector(R.RoundBeforeExpiry.selector, early, uint256(expiry - 10)));
        resolver.record(address(tsla), expiry, early);

        vm.warp(expiry + 50);
        _push(TSLA, 391e8, uint64(expiry + 50));
        uint80 notFirst = _pid(4);
        vm.expectRevert(abi.encodeWithSelector(R.NotFirstRound.selector, notFirst, uint256(expiry + 5)));
        resolver.record(address(tsla), expiry, notFirst);
    }

    function testPhaseIdIsOneSoFirstRoundOfPhaseIsRecordable() public {
        _seedAndRegister(100e8); // round 1 at START
        uint64 expiry = uint64(START - 1); // round 1 is the first at/after expiry
        vm.warp(START + 1);
        (uint80 hint, bool found) = resolver.findRound(address(tsla), expiry);
        assertTrue(found);
        assertEq(hint, _pid(1));
        resolver.record(address(tsla), expiry, hint);
        R.Settlement memory s = resolver.settlement(address(tsla), expiry);
        assertTrue(s.recorded);
        assertEq(s.roundId, _pid(1));
    }

    function testRecordAssetConvenience() public {
        _seedAndRegister(100e8);
        uint64 expiry = uint64(START + 60);
        vm.warp(expiry + 1);
        _push(TSLA, 110e8, uint64(expiry + 1));
        resolver.recordAsset(TSLA, expiry);
        (, uint256 priceWad,,) = resolver.settlementOf(TSLA, expiry);
        assertEq(priceWad, 110e18);
    }

    // ───────────────────────── batch gas ─────────────────────────

    function testBatchPushGas30() public {
        uint256 n = 30;
        bytes32[] memory ids = new bytes32[](n);
        int256[] memory prices = new int256[](n);
        uint64[] memory obs = new uint64[](n);
        string[] memory syms = new string[](n);
        for (uint256 i; i < n; ++i) {
            syms[i] = string.concat("S", vm.toString(i));
            ids[i] = keccak256(bytes(syms[i]));
            prices[i] = int256(100e8) + int256(i * 1e8);
            obs[i] = uint64(block.timestamp);
        }
        hub.createFeeds(syms);

        uint256 g0 = gasleft();
        vm.prank(reporter);
        hub.push(ids, prices, obs);
        uint256 first = g0 - gasleft();

        g0 = gasleft();
        vm.prank(reporter);
        hub.push(ids, prices, obs);
        uint256 skipped = g0 - gasleft();

        vm.warp(block.timestamp + hub.heartbeat());
        for (uint256 i; i < n; ++i) {
            obs[i] = uint64(block.timestamp);
        }
        g0 = gasleft();
        vm.prank(reporter);
        hub.push(ids, prices, obs);
        uint256 heartbeatPush = g0 - gasleft();

        console2.log("gas_push_30_first", first);
        console2.log("gas_push_30_skip_unchanged", skipped);
        console2.log("gas_push_30_heartbeat", heartbeatPush);
        assertGt(first, 500_000);
        assertLt(skipped, first);
        assertGt(heartbeatPush, skipped);
        assertEq(KeeperFeed(hub.feedOf(ids[0])).latestAggRound(), 2);
        assertEq(hub.feedCount(), 31); // TSLA from setUp + 30
    }
}
