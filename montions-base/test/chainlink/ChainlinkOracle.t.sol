// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ChainlinkTestBase} from "./ChainlinkTestBase.sol";
import {ChainlinkOracle} from "../../src/oracle/chainlink/ChainlinkOracle.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {MockChainlinkProxy} from "../../src/mocks/MockChainlinkFeed.sol";
import {Ownable} from "solady/auth/Ownable.sol";

contract ChainlinkOracleTest is ChainlinkTestBase {
    function testRegistersFeedWithMetadata() public view {
        assertTrue(oracle.assetExists(ETH));
        assertFalse(oracle.assetExists(keccak256("SOL")));
        assertEq(oracle.feedOf(ETH), address(ethFeed));
        assertEq(oracle.assetOfFeed(address(ethFeed)), ETH);
        assertEq(oracle.symbolOf(ETH), "ETH");
        assertEq(oracle.quoteOf(LINKETH), "ETH");
        assertEq(oracle.settleDelayOf(ETH), SETTLE_DELAY);
        assertEq(oracle.assetCount(), 2);
        assertEq(oracle.assets()[1], LINKETH);
        ChainlinkOracle.FeedConfig memory c = oracle.feedConfig(ETH);
        assertEq(c.decimals, 8);
        assertEq(c.volWad, ETH_VOL);
        assertEq(c.maxStaleness, STALENESS);
    }

    function testScalesEightDecimalsToWad() public view {
        (uint256 price, uint64 updatedAt) = oracle.latestPrice(ETH);
        assertEq(price, 2500e18);
        assertEq(updatedAt, START - 60);
        assertEq(oracle.scale(123_456_789, 8), 1.23456789e18);
        assertEq(oracle.scale(1, 0), 1e18);
    }

    function testScalesEighteenDecimalsAsIs() public view {
        (uint256 price,) = oracle.latestPrice(LINKETH);
        assertEq(price, 0.00518e18);
    }

    function testFuzzScale(uint64 answer, uint8 dec) public view {
        dec = uint8(bound(dec, 0, 18));
        vm.assume(answer > 0);
        assertEq(oracle.scale(int256(uint256(answer)), dec), uint256(answer) * 10 ** (18 - uint256(dec)));
    }

    function testStalePriceReverts() public {
        vm.warp(START - 60 + STALENESS + 1);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.StalePrice.selector, ETH, START - 60));
        oracle.latestPrice(ETH);
        assertFalse(oracle.isHealthy(ETH));
        vm.warp(START - 60 + STALENESS);
        assertTrue(oracle.isHealthy(ETH));
    }

    function testFutureTimestampIsStale() public {
        ethFeed.push(2501e8, START + 100);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.StalePrice.selector, ETH, START + 100));
        oracle.latestPrice(ETH);
        assertFalse(oracle.isHealthy(ETH));
    }

    function testNegativeOrZeroAnswerReverts() public {
        ethFeed.push(-1, START);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidPrice.selector, int256(-1)));
        oracle.latestPrice(ETH);
        assertFalse(oracle.isHealthy(ETH));
        ethFeed.push(0, START);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidPrice.selector, int256(0)));
        oracle.latestPrice(ETH);
    }

    function testHealthRejectsUnsupportedLiveDecimals() public {
        ethFeed.setDecimals(19);
        assertFalse(oracle.isHealthy(ETH));
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidDecimals.selector, uint8(19)));
        oracle.latestPrice(ETH);
        ethFeed.setDecimals(8);
        assertTrue(oracle.isHealthy(ETH));
    }

    function testUnknownAssetReverts() public {
        bytes32 sol = keccak256("SOL");
        vm.expectRevert(abi.encodeWithSelector(IPriceOracle.UnknownAsset.selector, sol));
        oracle.latestPrice(sol);
        vm.expectRevert(abi.encodeWithSelector(IPriceOracle.UnknownAsset.selector, sol));
        oracle.realizedVol(sol, 1, 1);
        assertFalse(oracle.isHealthy(sol));
    }

    function testRealizedVolIsConfiguredAndTwapUnavailable() public {
        assertEq(oracle.realizedVol(ETH, 6 hours, 5 minutes), ETH_VOL);
        vm.expectRevert(abi.encodeWithSelector(IPriceOracle.HistoryUnavailable.selector, ETH, uint64(START)));
        oracle.twapAt(ETH, uint64(START), 60);
    }

    function testRegistrationIsOneTime() public {
        MockChainlinkProxy other = new MockChainlinkProxy(8, "X");
        other.push(1e8, START);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.AssetAlreadyRegistered.selector, ETH));
        oracle.setFeed(ETH, address(other), "ETH", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.FeedAlreadyRegistered.selector, address(ethFeed)));
        oracle.setFeed(keccak256("ETH2"), address(ethFeed), "ETH", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
    }

    function testSetFeedValidation() public {
        bytes32 id = keccak256("X");
        MockChainlinkProxy f = new MockChainlinkProxy(8, "X");
        f.push(1e8, START);
        vm.expectRevert(ChainlinkOracle.ZeroAddress.selector);
        oracle.setFeed(id, address(0), "X", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
        vm.expectRevert(ChainlinkOracle.ZeroAddress.selector);
        oracle.setFeed(id, address(0xdead), "X", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
        vm.expectRevert(ChainlinkOracle.EmptySymbol.selector);
        oracle.setFeed(id, address(f), "", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
        vm.expectRevert(ChainlinkOracle.EmptySymbol.selector);
        oracle.setFeed(id, address(f), "X", "", SETTLE_DELAY, ETH_VOL, STALENESS);
        vm.expectRevert(ChainlinkOracle.ZeroAssetId.selector);
        oracle.setFeed(bytes32(0), address(f), "X", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidSettleDelay.selector, uint32(59)));
        oracle.setFeed(id, address(f), "X", "USD", 59, ETH_VOL, STALENESS);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidVolatility.selector, uint256(6e18)));
        oracle.setFeed(id, address(f), "X", "USD", SETTLE_DELAY, 6e18, STALENESS);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidStaleness.selector, uint32(30)));
        oracle.setFeed(id, address(f), "X", "USD", SETTLE_DELAY, ETH_VOL, 30);
        f.setDecimals(19);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidDecimals.selector, uint8(19)));
        oracle.setFeed(id, address(f), "X", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
        f.setDecimals(8);
        f.push(-5, START);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidPrice.selector, int256(-5)));
        oracle.setFeed(id, address(f), "X", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
    }

    function testOnlyOwnerConfigures() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(Ownable.Unauthorized.selector);
        oracle.setRisk(ETH, 0.7e18, 600);
        MockChainlinkProxy f = new MockChainlinkProxy(8, "X");
        f.push(1e8, START);
        vm.prank(address(0xBAD));
        vm.expectRevert(Ownable.Unauthorized.selector);
        oracle.setFeed(keccak256("X"), address(f), "X", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
    }

    function testSetRiskChangesQuotingOnly() public {
        oracle.setRisk(ETH, 0.9e18, 120);
        assertEq(oracle.realizedVol(ETH, 0, 0), 0.9e18);
        assertEq(oracle.feedConfig(ETH).maxStaleness, 120);
        assertEq(oracle.feedOf(ETH), address(ethFeed));
        assertEq(oracle.settleDelayOf(ETH), SETTLE_DELAY);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidVolatility.selector, uint256(0)));
        oracle.setRisk(ETH, 0, 120);
    }

    function testScaleRejectsOverflow() public {
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.PriceOverflow.selector, type(int256).max, uint8(17)));
        oracle.scale(type(int256).max, 17);
    }

    function testHeartbeatTightensQuoteStaleness() public {
        oracle.setMarketPolicy(ETH, 1200, 25e18, true);
        assertEq(oracle.heartbeatOf(ETH), 1200);
        assertEq(oracle.strikeStepOf(ETH), 25e18);
        assertTrue(oracle.isLadder(ETH));
        assertEq(oracle.quoteMaxAge(ETH), 2400); // 2× heartbeat

        vm.warp(START - 60 + 2400);
        assertTrue(oracle.isHealthy(ETH));
        oracle.latestPrice(ETH);

        vm.warp(START - 60 + 2401);
        assertFalse(oracle.isHealthy(ETH));
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.StalePrice.selector, ETH, START - 60));
        oracle.latestPrice(ETH);
    }

    function testMarketPolicyValidation() public {
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidStrikeStep.selector, uint256(0)));
        oracle.setMarketPolicy(ETH, 1200, 0, true);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidHeartbeat.selector, uint32(3 days)));
        oracle.setMarketPolicy(ETH, uint32(3 days), 25e18, true);
        vm.prank(address(0xBAD));
        vm.expectRevert(Ownable.Unauthorized.selector);
        oracle.setMarketPolicy(ETH, 1200, 25e18, true);
    }
}
