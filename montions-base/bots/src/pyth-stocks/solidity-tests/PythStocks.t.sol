// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {DeployPythStocks} from "../../../../script/DeployPythStocks.s.sol";
import {MockPyth} from "../../../../test/pyth/mocks/MockPyth.sol";
import {MontionsBook} from "../../../../src/MontionsBook.sol";
import {IMontionsBook} from "../../../../src/interfaces/IMontionsBook.sol";
import {TestUSDC} from "../../../../test/book/mocks/TestUSDC.sol";
import {PythOracle} from "../../../../src/oracle/pyth/PythOracle.sol";
import {PythSettlementResolver} from "../../../../src/resolvers/PythSettlementResolver.sol";

contract PythStocksHarness is DeployPythStocks {
    function deployConfigured(address pyth, address owner, address book, string memory json) external {
        _deployConfigured(pyth, owner, book, json);
    }
}

contract PythStocksTest is Test {
    MockPyth pyth;
    MontionsBook book;
    PythStocksHarness deployer;
    string catalog;

    function setUp() public {
        vm.warp(1791811800);
        catalog = vm.readFile("config/pyth-stocks.json");
        pyth = new MockPyth();
        for (uint256 i; i < 29; ++i) {
            string memory path = string.concat(".assets[", vm.toString(i), "].feedId");
            pyth.setPrice(vm.parseJsonBytes32(catalog, path), 38270000000, 10000000, -8, block.timestamp);
        }
        deployer = new PythStocksHarness();
        book = new MontionsBook(address(new TestUSDC(address(this))), address(deployer));
    }

    function _deploy() internal {
        // Harness calls Book as itself; temporarily set it as Book owner using Solady transferOwnership.
        deployer.deployConfigured(address(pyth), address(deployer), address(book), catalog);
    }

    function testRegistersEveryStockAndRejectsLaterPrintOnRealBook() public {
        _deploy();
        PythOracle oracle = deployer.oracle();
        PythSettlementResolver resolver = deployer.resolver();
        assertTrue(book.resolverAllowed(address(resolver)));
        for (uint256 i; i < 29; ++i) {
            string memory k = string.concat(".assets[", vm.toString(i), "]");
            bytes32 id = keccak256(bytes(vm.parseJsonString(catalog, string.concat(k, ".symbol"))));
            assertTrue(oracle.assetExists(id));
            assertEq(oracle.feedIdOf(id), vm.parseJsonBytes32(catalog, string.concat(k, ".feedId")));
        }
        bytes32 asset = keccak256("TSLA");
        bytes32 feed = oracle.feedIdOf(asset);
        uint64 expiry = uint64(block.timestamp + 600);
        bytes32 yesSeries =
            book.createSeries(address(resolver), abi.encode(address(oracle), asset, 380e18, true, uint32(300)), expiry);
        bytes32 noSeries =
            book.createSeries(address(resolver), abi.encode(address(oracle), asset, 390e18, true, uint32(300)), expiry);
        pyth.setFee(10);
        pyth.setPrice(feed, 38270000000, 10000000, -8, expiry);
        uint256 first = pyth.historyLength(feed) - 1;
        pyth.setPrice(feed, 40000000000, 10000000, -8, expiry + 30);
        bytes[] memory data = new bytes[](1);
        data[0] = pyth.updateDataAt(feed, first + 1);
        vm.warp(expiry + 31);
        vm.expectRevert(MockPyth.PriceFeedNotFoundWithinRange.selector);
        resolver.settle{value: 10}(asset, expiry, data);
        data[0] = pyth.updateDataAt(feed, first);
        resolver.settle{value: 10}(asset, expiry, data);
        book.resolve(yesSeries);
        book.resolve(noSeries);
        assertTrue(book.seriesInfo(yesSeries).yes);
        assertFalse(book.seriesInfo(noSeries).yes);
        assertEq(uint256(book.seriesInfo(noSeries).status), uint256(IMontionsBook.Status.Resolved));
    }

    function testRegistrationRequiresInitialPriceFeed() public {
        MockPyth empty = new MockPyth();
        vm.expectRevert(
            abi.encodeWithSelector(PythOracle.UnknownFeed.selector, vm.parseJsonBytes32(catalog, ".assets[0].feedId"))
        );
        deployer.deployConfigured(address(empty), address(deployer), address(book), catalog);
    }
}
