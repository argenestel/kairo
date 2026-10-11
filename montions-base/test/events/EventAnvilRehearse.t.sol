// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IMontionsBook} from "../../src/interfaces/IMontionsBook.sol";
import {MontionsBook} from "../../src/MontionsBook.sol";
import {OptimisticEventResolver} from "../../src/resolvers/OptimisticEventResolver.sol";
import {
    EventRegistration,
    EventOutcome,
    DEFAULT_CHALLENGE_WINDOW
} from "../../src/resolvers/events/EventTypes.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";

/// @notice End-to-end on an anvil fork of Base Sepolia (warps work here; not in forge script broadcast).
/// @dev `anvil --fork-url https://sepolia.base.org --port 8552 --auto-impersonate`
///      `ANVIL_REHEARSE=1 forge test --mp test/events/EventAnvilRehearse.t.sol --skip KeeperFeed -vv`
contract EventAnvilRehearseTest is Test {
    uint256 internal constant UNIT = 1_000_000;
    address internal constant BOOK = 0xB38658485ed69fA70BDe9aC0989926c33506Ac48;
    address internal constant COLLATERAL = 0x844EAC441D9c70Dc6745Ca1a41643995B7B04612;
    address internal constant ADMIN = 0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39;
    address internal constant TRADER = address(0xE2E2);

    function testAnvilForkBuyProposeResolveRedeem() public {
        if (vm.envOr("ANVIL_REHEARSE", uint256(0)) != 1) return;
        vm.createSelectFork(vm.envOr("ANVIL_FORK_URL", string("http://127.0.0.1:8552")));

        MontionsBook book = MontionsBook(BOOK);
        TestUSDC usdc = TestUSDC(COLLATERAL);
        vm.deal(ADMIN, 10 ether);
        vm.deal(TRADER, 1 ether);

        vm.startPrank(ADMIN);
        OptimisticEventResolver resolver = new OptimisticEventResolver(COLLATERAL, ADMIN, ADMIN, ADMIN);
        book.setResolverAllowed(address(resolver), true);
        uint64 closeTime = uint64(block.timestamp + 1 days);
        string memory rules = "YES if the anvil rehearsal flag is set. UTC. Source: this test.";
        resolver.registerEvent(
            EventRegistration({
                key: "ANVIL-REHEARSE",
                question: "Will the anvil rehearsal resolve YES?",
                rules: rules,
                source: "https://example.com/anvil",
                closeTime: closeTime,
                category: "other",
                icon: "x"
            })
        );
        bytes32 eventKey = resolver.eventKeyOf("ANVIL-REHEARSE");
        bytes memory data = resolver.seriesData(eventKey);
        bytes32 seriesId = book.createSeries(address(resolver), data, closeTime);
        usdc.mint(ADMIN, 10_000 * UNIT);
        usdc.mint(TRADER, 10_000 * UNIT);
        usdc.approve(address(book), type(uint256).max);
        usdc.approve(address(resolver), type(uint256).max);
        book.deposit(1_000 * UNIT);
        book.placeOrder(
            IMontionsBook.PlaceParams({
                seriesId: seriesId,
                side: IMontionsBook.Side.Ask,
                tick: 40,
                qty: 10,
                fromHeld: false,
                tif: IMontionsBook.TIF.GTC,
                maxFills: 0
            })
        );
        vm.stopPrank();

        vm.startPrank(TRADER);
        usdc.approve(address(book), type(uint256).max);
        book.deposit(1_000 * UNIT);
        (, uint64 filled,) = book.placeOrder(
            IMontionsBook.PlaceParams({
                seriesId: seriesId,
                side: IMontionsBook.Side.Bid,
                tick: 40,
                qty: 10,
                fromHeld: false,
                tif: IMontionsBook.TIF.GTC,
                maxFills: 0
            })
        );
        vm.stopPrank();
        assertEq(filled, 10);

        vm.warp(closeTime);
        vm.prank(ADMIN);
        resolver.propose(eventKey, EventOutcome.Yes);
        vm.warp(uint256(closeTime) + DEFAULT_CHALLENGE_WINDOW + 1);
        book.resolve(seriesId);
        assertTrue(book.seriesInfo(seriesId).yes);
        resolver.finalize(eventKey);

        vm.prank(TRADER);
        uint256 payout = book.redeem(seriesId, 10, 0);
        assertEq(payout, 10 * UNIT);
    }
}
