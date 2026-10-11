// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KeeperFeed} from "../../src/oracle/keeperfeed/KeeperFeed.sol";
import {KeeperFeedHub} from "../../src/oracle/keeperfeed/KeeperFeedHub.sol";
import {ChainlinkOracle} from "../../src/oracle/chainlink/ChainlinkOracle.sol";
import {ChainlinkSettlementResolver} from "../../src/resolvers/ChainlinkSettlementResolver.sol";
import {MontionsBook} from "../../src/MontionsBook.sol";
import {Quoter} from "../../src/Quoter.sol";
import {MakerVault} from "../../src/MakerVault.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";
import {IMontionsBook} from "../../src/interfaces/IMontionsBook.sol";
import {IQuoter} from "../../src/interfaces/IQuoter.sol";

/// @notice Series on a KeeperFeed asset → vault quotes → buy → push past expiry → record → resolve → redeem.
contract KeeperFeedBookTest is Test {
    uint256 internal constant START = 1_700_000_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant UNIT = 1e6;
    uint32 internal constant SETTLE_DELAY = 3600;
    uint32 internal constant STALENESS = 2 days;
    uint256 internal constant VOL = 0.41e18;
    bytes32 internal constant TSLA = keccak256("TSLA");

    address internal constant OWNER = address(0x0E);
    address internal constant KEEPER = address(0x4EE9);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    KeeperFeedHub internal hub;
    KeeperFeed internal tsla;
    ChainlinkOracle internal oracle;
    ChainlinkSettlementResolver internal resolver;
    TestUSDC internal usdc;
    MontionsBook internal book;
    Quoter internal quoter;
    MakerVault internal vault;
    uint64 internal expiry;
    bytes32 internal seriesId;

    function setUp() public {
        vm.warp(START);
        hub = new KeeperFeedHub(address(this), KEEPER);
        tsla = KeeperFeed(hub.createFeed("TSLA"));
        _push(382.7e8, uint64(START));

        oracle = new ChainlinkOracle(address(this));
        oracle.setFeed(TSLA, address(tsla), "TSLA", "USD", SETTLE_DELAY, VOL, STALENESS);
        resolver = new ChainlinkSettlementResolver(address(oracle));

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
        seriesId = book.createSeries(
            address(resolver), abi.encode(address(oracle), TSLA, uint256(385e18), true, SETTLE_DELAY), expiry
        );
    }

    function _push(int256 price, uint64 observedAt) internal {
        bytes32[] memory ids = new bytes32[](1);
        int256[] memory prices = new int256[](1);
        uint64[] memory obs = new uint64[](1);
        ids[0] = TSLA;
        prices[0] = price;
        obs[0] = observedAt;
        vm.prank(KEEPER);
        hub.push(ids, prices, obs);
    }

    function _buy(address user, bool yes, uint8 limitTick, uint64 qty) internal returns (uint64 filled) {
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

    function testQuoterPricesKeeperFeedSeries() public view {
        (uint8 fairTick, uint256 probWad, uint256 volWad, uint256 spotWad) = quoter.fair(seriesId);
        assertEq(spotWad, 382.7e18);
        assertEq(volWad, VOL);
        assertGt(fairTick, 0);
        assertGt(probWad, 0);
        IQuoter.Snapshot memory s = quoter.snapshot(seriesId);
        assertEq(s.fairTick, fairTick);
        // Resolver copy is unchanged (still says "Chainlink round"); the feed description is keeper-reported.
        assertTrue(_contains(s.title, "TSLA"));
        assertTrue(_contains(s.title, "$385.00"));
    }

    function testEndToEndBuyPushRecordResolveRedeem() public {
        vm.prank(KEEPER);
        vault.refresh(seriesId);
        (uint8 bid,, uint8 ask,) = book.bestBidAsk(seriesId);
        assertGt(bid, 0);
        assertGt(ask, bid);

        IQuoter.Quote memory q = quoter.quoteBuy(seriesId, true, 10, 99);
        assertEq(q.filled, 10);
        assertEq(_buy(ALICE, true, q.worstTick, 10), 10);
        IMontionsBook.SeriesInfo memory info = book.seriesInfo(seriesId);
        assertEq(book.balanceOf(ALICE, info.yesId), 10);

        IQuoter.Quote memory qn = quoter.quoteBuy(seriesId, false, 5, 99);
        assertEq(_buy(BOB, false, qn.worstTick, 5), 5);
        assertEq(book.balanceOf(BOB, info.noId), 5);

        vm.warp(expiry - 200);
        _push(384e8, uint64(expiry - 200));
        vm.warp(expiry + 10);
        vm.expectRevert(IMontionsBook.NotExpired.selector);
        book.resolve(seriesId);

        vm.warp(expiry + 40);
        _push(400e8, uint64(expiry + 40));
        resolver.recordAsset(TSLA, expiry);
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
        uint256 navBefore = vault.totalAssets();
        uint256 vaultCashBefore = book.cash(address(vault));
        uint256 vaultLockedBefore = book.lockedCash(address(vault));
        assertEq(vault.redeemSeries(seriesId), vaultYes * UNIT);
        assertEq(book.cash(address(vault)), vaultCashBefore + vaultLockedBefore + vaultYes * UNIT);
        assertEq(vault.totalAssets(), navBefore);
        assertEq(book.pool(seriesId), 0);
    }

    function testEndToEndNoWinsWhenKeeperPrintsBelowStrike() public {
        vm.prank(KEEPER);
        vault.refresh(seriesId);
        IQuoter.Quote memory qn = quoter.quoteBuy(seriesId, false, 3, 99);
        assertEq(_buy(BOB, false, qn.worstTick, 3), 3);
        vm.warp(expiry + 1);
        _push(370e8, uint64(expiry + 1));
        resolver.recordFirstRound(address(tsla), expiry);
        book.resolve(seriesId);
        assertFalse(book.seriesInfo(seriesId).yes);
        vm.prank(BOB);
        assertEq(book.redeem(seriesId, 0, 3), 3 * UNIT);
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i; i <= h.length - n.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
