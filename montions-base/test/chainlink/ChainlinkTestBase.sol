// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChainlinkOracle} from "../../src/oracle/chainlink/ChainlinkOracle.sol";
import {ChainlinkSettlementResolver} from "../../src/resolvers/ChainlinkSettlementResolver.sol";
import {MockChainlinkProxy} from "../../src/mocks/MockChainlinkFeed.sol";

abstract contract ChainlinkTestBase is Test {
    uint256 internal constant START = 1_700_000_000; // 2023-11-14 22:13:20 UTC
    uint256 internal constant WAD = 1e18;
    bytes32 internal constant ETH = keccak256("ETH");
    bytes32 internal constant LINKETH = keccak256("LINK/ETH");
    uint32 internal constant SETTLE_DELAY = 3600;
    uint32 internal constant STALENESS = 3600;
    uint256 internal constant ETH_VOL = 0.6e18;

    MockChainlinkProxy internal ethFeed;
    MockChainlinkProxy internal linkEthFeed;
    ChainlinkOracle internal oracle;
    ChainlinkSettlementResolver internal resolver;

    function setUp() public virtual {
        vm.warp(START);
        ethFeed = new MockChainlinkProxy(8, "ETH / USD");
        ethFeed.push(2500e8, START - 60);
        linkEthFeed = new MockChainlinkProxy(18, "LINK / ETH");
        linkEthFeed.push(0.00518e18, START - 30);
        oracle = new ChainlinkOracle(address(this));
        oracle.setFeed(ETH, address(ethFeed), "ETH", "USD", SETTLE_DELAY, ETH_VOL, STALENESS);
        oracle.setFeed(LINKETH, address(linkEthFeed), "LINK", "ETH", SETTLE_DELAY, 0.5e18, STALENESS);
        resolver = new ChainlinkSettlementResolver(address(oracle));
    }

    function _data(bytes32 assetId, uint256 strikeWad, bool above) internal view returns (bytes memory) {
        return abi.encode(address(oracle), assetId, strikeWad, above, SETTLE_DELAY);
    }

    function _pid(MockChainlinkProxy feed, uint64 aggRound) internal view returns (uint80) {
        return (uint80(feed.phaseId()) << 64) | aggRound;
    }
}
