// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ChainlinkTestBase} from "./ChainlinkTestBase.sol";
import {ChainlinkSettlementResolver as R} from "../../src/resolvers/ChainlinkSettlementResolver.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {MockChainlinkProxy, MockChainlinkAggregator} from "../../src/mocks/MockChainlinkFeed.sol";

contract ChainlinkSettlementResolverTest is ChainlinkTestBase {
    uint64 internal expiry;

    function setUp() public override {
        super.setUp();
        expiry = uint64(START + 1 hours);
    }

    // rounds: r1 at START-60 (setUp), r2 at expiry-300, r3 at expiry+40 (first at/after expiry), r4 at expiry+700
    function _timeline() internal {
        ethFeed.push(2490e8, expiry - 300);
        ethFeed.push(2510e8, expiry + 40);
        ethFeed.push(2600e8, expiry + 700);
        vm.warp(expiry + 800);
    }

    // ───────────────────────── validate ─────────────────────────

    function testValidateAcceptsCanonicalSeries() public view {
        resolver.validate(_data(ETH, 2500e18, true), expiry);
    }

    function testValidateRejections() public {
        vm.expectRevert(R.InvalidData.selector);
        resolver.validate(abi.encode(address(oracle), ETH, uint256(1)), expiry);
        vm.expectRevert(R.UntrustedOracle.selector);
        resolver.validate(abi.encode(address(0xBEEF), ETH, 2500e18, true, SETTLE_DELAY), expiry);
        vm.expectRevert(R.InvalidStrike.selector);
        resolver.validate(_data(ETH, 0, true), expiry);
        vm.expectRevert(abi.encodeWithSelector(R.InvalidExpiry.selector, uint64(START)));
        resolver.validate(_data(ETH, 1e18, true), uint64(START));
        vm.expectRevert(abi.encodeWithSelector(R.InvalidMaxDelay.selector, uint32(300)));
        resolver.validate(abi.encode(address(oracle), ETH, 2500e18, true, uint32(300)), expiry);
        bytes32 sol = keccak256("SOL");
        vm.expectRevert(abi.encodeWithSelector(IPriceOracle.UnknownAsset.selector, sol));
        resolver.validate(abi.encode(address(oracle), sol, 2500e18, true, SETTLE_DELAY), expiry);
    }

    function testValidateRejectsUnhealthyFeed() public {
        vm.warp(START - 60 + STALENESS + 1);
        vm.expectRevert(abi.encodeWithSelector(R.FeedUnhealthy.selector, ETH));
        resolver.validate(_data(ETH, 2500e18, true), uint64(block.timestamp + 1 days));
    }

    function testValidateLadderRequiresOnGridInBandStrike() public {
        oracle.setMarketPolicy(ETH, 1200, 25e18, true);
        resolver.validate(_data(ETH, 2500e18, true), expiry); // on grid, ATM
        resolver.validate(_data(ETH, 2425e18, true), expiry); // −3 steps
        vm.expectRevert(abi.encodeWithSelector(R.OffGridStrike.selector, uint256(2512e18), uint256(25e18)));
        resolver.validate(_data(ETH, 2512e18, true), expiry);
        vm.expectRevert(abi.encodeWithSelector(R.StrikeOutOfBand.selector, uint256(2700e18), uint256(2500e18)));
        resolver.validate(_data(ETH, 2700e18, true), expiry); // +8 steps > 7-step band
    }

    function testEncodeDecodeRoundTrip() public view {
        bytes memory d = resolver.encode(address(oracle), ETH, 2500e18, true, SETTLE_DELAY);
        assertEq(d, _data(ETH, 2500e18, true));
        (address o, bytes32 a, uint256 k, bool above, uint32 delay) = resolver.decode(d);
        assertEq(o, address(oracle));
        assertEq(a, ETH);
        assertEq(k, 2500e18);
        assertTrue(above);
        assertEq(delay, SETTLE_DELAY);
    }

    // ───────────────────────── describe ─────────────────────────

    function testDescribeUsd() public view {
        assertEq(
            resolver.describe(_data(ETH, 2500e18, true), uint64(1_700_150_400)),
            "ETH >= $2500.00 at 2023-11-16 16:00 UTC (first Chainlink round at/after expiry, max 3600s)"
        );
        assertEq(
            resolver.describe(_data(ETH, 2512.5e18, false), uint64(1_700_150_400)),
            "ETH < $2512.50 at 2023-11-16 16:00 UTC (first Chainlink round at/after expiry, max 3600s)"
        );
    }

    function testDescribeRatioQuote() public view {
        assertEq(
            resolver.describe(_data(LINKETH, 0.00518e18, true), uint64(1_700_150_400)),
            "LINK >= 0.00518 ETH at 2023-11-16 16:00 UTC (first Chainlink round at/after expiry, max 3600s)"
        );
    }

    // ───────────────────────── record ─────────────────────────

    function testRecordsFirstRoundAtOrAfterExpiry() public {
        _timeline();
        (uint80 hint, bool found) = resolver.findRound(address(ethFeed), expiry);
        assertTrue(found);
        assertEq(hint, _pid(ethFeed, 3));
        (int256 answer, uint256 updatedAt) = resolver.record(address(ethFeed), expiry, hint);
        assertEq(answer, 2510e8);
        assertEq(updatedAt, expiry + 40);
        R.Settlement memory s = resolver.settlement(address(ethFeed), expiry);
        assertTrue(s.recorded);
        assertEq(s.roundId, hint);
        assertEq(s.decimals, 8);
        (bool recorded, uint256 priceWad,,) = resolver.settlementOf(ETH, expiry);
        assertTrue(recorded);
        assertEq(priceWad, 2510e18);
        vm.expectRevert(abi.encodeWithSelector(R.AlreadyRecorded.selector, address(ethFeed), expiry));
        resolver.record(address(ethFeed), expiry, hint);
    }

    function testRoundExactlyAtExpiryCounts() public {
        ethFeed.push(2490e8, expiry - 1);
        ethFeed.push(2495e8, expiry);
        vm.warp(expiry + 1);
        (uint80 hint, bool found) = resolver.findRound(address(ethFeed), expiry);
        assertTrue(found);
        assertEq(hint, _pid(ethFeed, 3));
        resolver.record(address(ethFeed), expiry, hint);
        (bool ready, bool yes) = resolver.resolve(_data(ETH, 2495e18, true), expiry);
        assertTrue(ready);
        assertTrue(yes); // price >= strike at equality
        (ready, yes) = resolver.resolve(_data(ETH, 2495e18, false), expiry);
        assertTrue(ready);
        assertFalse(yes);
    }

    function testRejectsHintTooEarly() public {
        _timeline();
        uint80 hint = _pid(ethFeed, 2);
        vm.expectRevert(abi.encodeWithSelector(R.RoundBeforeExpiry.selector, hint, expiry - 300));
        resolver.record(address(ethFeed), expiry, hint);
    }

    function testRejectsHintNotFirst() public {
        _timeline();
        uint80 hint = _pid(ethFeed, 4);
        vm.expectRevert(abi.encodeWithSelector(R.NotFirstRound.selector, hint, expiry + 40));
        resolver.record(address(ethFeed), expiry, hint);
    }

    function testRejectsMissingRound() public {
        _timeline();
        uint80 h9 = _pid(ethFeed, 9);
        uint80 h0 = _pid(ethFeed, 0);
        vm.expectRevert(abi.encodeWithSelector(R.RoundIncomplete.selector, h9));
        resolver.record(address(ethFeed), expiry, h9);
        vm.expectRevert(abi.encodeWithSelector(R.RoundIncomplete.selector, h0));
        resolver.record(address(ethFeed), expiry, h0);
    }

    function testRejectsLiteralZeroHint() public {
        _timeline();
        vm.expectRevert(abi.encodeWithSelector(R.RoundIncomplete.selector, uint80(0)));
        resolver.record(address(ethFeed), expiry, 0);
    }

    function testRejectsBeforeExpiryAndUnknownFeed() public {
        uint80 h1 = _pid(ethFeed, 1);
        vm.expectRevert(abi.encodeWithSelector(R.NotExpired.selector, expiry));
        resolver.record(address(ethFeed), expiry, h1);
        vm.warp(expiry + 1);
        MockChainlinkProxy rogue = new MockChainlinkProxy(8, "ROGUE");
        rogue.push(1, expiry);
        uint80 r1 = _pid(rogue, 1);
        vm.expectRevert(abi.encodeWithSelector(R.UnknownFeed.selector, address(rogue)));
        resolver.record(address(rogue), expiry, r1);
    }

    function testNotFoundBeforeAnyRoundAfterExpiry() public {
        ethFeed.push(2490e8, expiry - 10);
        vm.warp(expiry + 500);
        (, bool found) = resolver.findRound(address(ethFeed), expiry);
        assertFalse(found);
        vm.expectRevert(abi.encodeWithSelector(R.RoundNotFound.selector, address(ethFeed), expiry));
        resolver.recordFirstRound(address(ethFeed), expiry);
        (bool ready,) = resolver.resolve(_data(ETH, 2500e18, true), expiry);
        assertFalse(ready);
    }

    function testRejectsOtherPhase() public {
        ethFeed.push(2490e8, expiry - 300);
        ethFeed.push(2510e8, expiry + 40); // phase 1 round 3: would have been the answer
        MockChainlinkAggregator next = ethFeed.newPhase(); // phase 2 becomes current
        next.push(2400e8, expiry - 100);
        next.push(2420e8, expiry + 90); // phase 2 round 2 — pre-seeded history, not live at expiry
        vm.warp(expiry + 200);
        vm.expectRevert(abi.encodeWithSelector(R.NotCurrentPhase.selector, uint16(1), uint16(2)));
        resolver.record(address(ethFeed), expiry, (uint80(1) << 64) | 3);
        // Previous phase still has a round at/after expiry: fail-closed, do not take 2420.
        (, bool found) = resolver.findRound(address(ethFeed), expiry);
        assertFalse(found);
        vm.expectRevert(abi.encodeWithSelector(R.PhaseChangedAfterExpiry.selector, uint16(2), uint256(expiry + 40)));
        resolver.record(address(ethFeed), expiry, (uint80(2) << 64) | 2);
        (bool ready,) = resolver.resolve(_data(ETH, 2500e18, true), expiry);
        assertFalse(ready);
    }

    function testAcceptsPhaseUpgradeThatHappenedBeforeExpiry() public {
        ethFeed.push(2490e8, expiry - 400); // last print of phase 1 is before expiry
        MockChainlinkAggregator next = ethFeed.newPhase();
        next.push(2500e8, expiry - 50);
        next.push(2510e8, expiry + 40); // first phase-2 round at/after expiry, predecessor in-phase
        vm.warp(expiry + 80);
        (uint80 hint, bool found) = resolver.findRound(address(ethFeed), expiry);
        assertTrue(found);
        assertEq(hint, (uint80(2) << 64) | 2);
        resolver.record(address(ethFeed), expiry, hint);
        (, uint256 priceWad,,) = resolver.settlementOf(ETH, expiry);
        assertEq(priceWad, 2510e18);
    }

    function testRejectsFirstRoundOfLaterPhase() public {
        MockChainlinkAggregator next = ethFeed.newPhase();
        next.push(2420e8, expiry + 90); // phase 2 round 1, no provable predecessor
        vm.warp(expiry + 200);
        uint80 hint = (uint80(2) << 64) | 1;
        vm.expectRevert(abi.encodeWithSelector(R.FirstRoundOfPhase.selector, hint));
        resolver.record(address(ethFeed), expiry, hint);
        (, bool found) = resolver.findRound(address(ethFeed), expiry);
        assertFalse(found);
    }

    function testGenesisRoundOfPhaseOneIsAccepted() public {
        // the only phase-1 round (START-60) is after an expiry in the past -> it is the first round at/after it
        uint64 early = uint64(START - 100);
        (uint80 hint, bool found) = resolver.findRound(address(ethFeed), early);
        assertTrue(found);
        assertEq(hint, _pid(ethFeed, 1));
        resolver.record(address(ethFeed), early, hint);
    }

    function testRevertingMissingRoundsAreHandled() public {
        _timeline();
        MockChainlinkAggregator agg = ethFeed.phaseAggregators(1);
        agg.setRevertOnMissing(true);
        uint80 h9 = _pid(ethFeed, 9);
        vm.expectRevert(MockChainlinkAggregator.NoDataPresent.selector);
        resolver.record(address(ethFeed), expiry, h9);
        resolver.recordFirstRound(address(ethFeed), expiry);
    }

    function testFindRoundDoesNotTreatMissingPredecessorAsBeforeExpiry() public {
        MockChainlinkProxy feed = new MockChainlinkProxy(8, "GAP / USD");
        MockChainlinkAggregator agg = feed.phaseAggregators(1);
        agg.push(1000e8, expiry - 1);
        agg.setRevertOnMissing(true);
        agg.setRound(3, 1100e8, expiry + 1);
        vm.warp(expiry + 2);
        oracle.setFeed(keccak256("GAP"), address(feed), "GAP", "USD", SETTLE_DELAY, ETH_VOL, 2 days);
        (, bool found) = resolver.findRound(address(feed), expiry);
        assertFalse(found);
        vm.expectRevert(abi.encodeWithSelector(R.RoundNotFound.selector, address(feed), expiry));
        resolver.recordFirstRound(address(feed), expiry);
    }

    function testRejectsRoundReportedInTheFuture() public {
        ethFeed.push(2510e8, expiry + 40);
        vm.warp(expiry + 10);
        uint80 hint = _pid(ethFeed, 2);
        vm.expectRevert(abi.encodeWithSelector(R.RoundInFuture.selector, hint, expiry + 40));
        resolver.record(address(ethFeed), expiry, hint);
    }

    function testRecordAssetConvenience() public {
        _timeline();
        resolver.recordAsset(ETH, expiry);
        assertTrue(resolver.isRecorded(address(ethFeed), expiry));
        vm.expectRevert(abi.encodeWithSelector(IPriceOracle.UnknownAsset.selector, keccak256("SOL")));
        resolver.recordAsset(keccak256("SOL"), expiry);
    }

    // ───────────────────────── resolve ─────────────────────────

    function testResolveAboveAndBelow() public {
        _timeline();
        (bool ready,) = resolver.resolve(_data(ETH, 2500e18, true), expiry);
        assertFalse(ready, "not ready before record");
        resolver.recordFirstRound(address(ethFeed), expiry); // 2510
        bool yes;
        (ready, yes) = resolver.resolve(_data(ETH, 2500e18, true), expiry);
        assertTrue(ready && yes);
        (ready, yes) = resolver.resolve(_data(ETH, 2510e18, true), expiry);
        assertTrue(ready && yes);
        (ready, yes) = resolver.resolve(_data(ETH, 2510.01e18, true), expiry);
        assertTrue(ready && !yes);
        (ready, yes) = resolver.resolve(_data(ETH, 2600e18, false), expiry);
        assertTrue(ready && yes);
    }

    function testResolveNotReadyCases() public {
        _timeline();
        resolver.recordFirstRound(address(ethFeed), expiry);
        (bool ready,) = resolver.resolve(abi.encode(address(0xBEEF), ETH, 2500e18, true, SETTLE_DELAY), expiry);
        assertFalse(ready, "foreign oracle");
        (ready,) = resolver.resolve(hex"1234", expiry);
        assertFalse(ready, "bad length");
        (ready,) = resolver.resolve(abi.encode(address(oracle), keccak256("SOL"), 1e18, true, SETTLE_DELAY), expiry);
        assertFalse(ready, "unknown asset");
        vm.warp(expiry);
        (ready,) = resolver.resolve(_data(ETH, 2500e18, true), expiry);
        assertFalse(ready, "at expiry");
    }

    function testNegativeAnswerRecordedButNeverReady() public {
        ethFeed.push(2490e8, expiry - 300);
        ethFeed.push(-1, expiry + 40);
        vm.warp(expiry + 100);
        resolver.recordFirstRound(address(ethFeed), expiry);
        (bool recorded, uint256 priceWad,,) = resolver.settlementOf(ETH, expiry);
        assertTrue(recorded);
        assertEq(priceWad, 0);
        (bool ready,) = resolver.resolve(_data(ETH, 1, true), expiry);
        assertFalse(ready);
    }

    function testUnsupportedDecimalsRecordedButNeverReady() public {
        ethFeed.push(2510e8, expiry + 40);
        vm.warp(expiry + 100);
        ethFeed.setDecimals(19);
        resolver.recordFirstRound(address(ethFeed), expiry);
        (bool recorded, uint256 priceWad,,) = resolver.settlementOf(ETH, expiry);
        assertTrue(recorded);
        assertEq(priceWad, 0);
        (bool ready,) = resolver.resolve(_data(ETH, 1, true), expiry);
        assertFalse(ready);
    }

    function testFeedStalledBeyondMaxDelayNeverReady() public {
        ethFeed.push(2490e8, expiry - 300);
        ethFeed.push(2510e8, expiry + SETTLE_DELAY + 1);
        vm.warp(expiry + SETTLE_DELAY + 10);
        resolver.recordFirstRound(address(ethFeed), expiry);
        (bool ready,) = resolver.resolve(_data(ETH, 2500e18, true), expiry);
        assertFalse(ready);
    }

    function testFeedJustWithinMaxDelayIsReady() public {
        ethFeed.push(2490e8, expiry - 300);
        ethFeed.push(2510e8, expiry + SETTLE_DELAY);
        vm.warp(expiry + SETTLE_DELAY + 10);
        resolver.recordFirstRound(address(ethFeed), expiry);
        (bool ready, bool yes) = resolver.resolve(_data(ETH, 2500e18, true), expiry);
        assertTrue(ready && yes);
    }

    function testEighteenDecimalRatioFeedResolves() public {
        uint256 t0 = block.timestamp;
        linkEthFeed.push(0.005e18, t0 + 100);
        linkEthFeed.push(0.0053e18, expiry + 5);
        vm.warp(expiry + 6);
        resolver.recordFirstRound(address(linkEthFeed), expiry);
        (bool ready, bool yes) = resolver.resolve(_data(LINKETH, 0.00518e18, true), expiry);
        assertTrue(ready && yes);
    }

    // ───────────────────────── uniqueness property ─────────────────────────

    /// @notice For any round timeline and expiry, at most one hint records, it is the first round with
    ///         updatedAt >= expiry, and `findRound` returns exactly that hint.
    function testFuzzExactlyOneHintRecords(uint256 seed, uint256 expiryOffset, uint8 n) public {
        n = uint8(bound(n, 1, 24));
        MockChainlinkProxy feed = new MockChainlinkProxy(8, "FUZZ / USD");
        uint256 t = START + 1;
        uint256[] memory times = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            // gaps 0..1200s; zero gaps model several reports in one block
            t += uint256(keccak256(abi.encode(seed, i))) % 1201;
            times[i] = t;
            feed.push(int256(2000e8 + i), t);
        }
        oracle.setFeed(keccak256("FUZZ"), address(feed), "FUZZ", "USD", SETTLE_DELAY, ETH_VOL, 2 days);
        uint64 exp = uint64(START + 1 + bound(expiryOffset, 0, t - START + 100));
        vm.warp(t > exp ? t + 1 : exp + 1);

        uint64 expected; // 0 = none
        for (uint256 i; i < n; ++i) {
            if (times[i] >= exp) {
                expected = uint64(i + 1);
                break;
            }
        }
        (uint80 found, bool ok) = resolver.findRound(address(feed), exp);
        assertEq(ok, expected != 0);
        if (ok) assertEq(found, _pid(feed, expected));

        uint256 successes;
        for (uint64 r = 1; r <= n + 1; ++r) {
            uint256 snap = vm.snapshotState();
            try resolver.record(address(feed), exp, _pid(feed, r)) {
                ++successes;
                assertEq(r, expected, "only the first round at/after expiry may record");
            } catch {}
            vm.revertToState(snap);
        }
        assertEq(successes, expected == 0 ? 0 : 1);
    }

    function testFindRoundOverManyRounds() public {
        MockChainlinkProxy feed = new MockChainlinkProxy(8, "MANY / USD");
        for (uint256 i = 1; i <= 600; ++i) {
            feed.push(int256(1000e8 + i), START + i * 600);
        }
        oracle.setFeed(keccak256("MANY"), address(feed), "MANY", "USD", SETTLE_DELAY, ETH_VOL, 2 days);
        vm.warp(START + 601 * 600);
        uint64[4] memory targets =
            [uint64(START + 1), uint64(START + 600 * 37 + 1), uint64(START + 600 * 300), uint64(START + 600 * 599 + 5)];
        uint64[4] memory want = [uint64(1), 38, 300, 600];
        for (uint256 i; i < 4; ++i) {
            (uint80 hint, bool found) = resolver.findRound(address(feed), targets[i]);
            assertTrue(found);
            assertEq(hint, _pid(feed, want[i]));
        }
    }
}
