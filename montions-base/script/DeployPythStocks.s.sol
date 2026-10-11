// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Script, console2} from "forge-std/Script.sol";
import {PythOracle} from "../src/oracle/pyth/PythOracle.sol";
import {PythSettlementResolver} from "../src/resolvers/PythSettlementResolver.sol";
import {IPyth} from "../src/oracle/pyth/IPyth.sol";
import {IMontionsBook} from "../src/interfaces/IMontionsBook.sol";

/// @notice Kairo stock adapter deployment. Default execution selects an isolated fork and never broadcasts.
/// @dev PYTH_BOOK must explicitly identify the post-evm-ship2 Book. No live manifest is written.
contract DeployPythStocks is Script {
    PythOracle public oracle;
    PythSettlementResolver public resolver;
    function run() external {
        uint256 chainId = vm.envOr("PYTH_CHAIN_ID", uint256(84532));
        require(chainId == 84532 || chainId == 421614, "unsupported chain");
        bool live = vm.envOr("ALLOW_LIVE_PYTH_STOCKS", false);
        if (!live) {
            vm.createSelectFork(vm.envOr("PYTH_RPC_URL", chainId == 84532
                ? string("https://sepolia.base.org") : string("https://arbitrum-sepolia-rpc.publicnode.com")));
        }
        require(block.chainid == chainId, "chain mismatch");
        address owner = vm.envAddress("PYTH_OWNER");
        address book = vm.envAddress("PYTH_BOOK");
        require(book.code.length > 0 && IMontionsBook(book).owner() == owner, "Book/owner mismatch");
        // The brief targets the new Book: explicitly reject the old CONTEXT item 11 deployments.
        require(book != 0xB38658485ed69fA70BDe9aC0989926c33506Ac48
            && book != 0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e, "use post-evm-ship2 Book");
        if (live) {
            require(msg.sender == owner, "broadcast sender must own Book");
            uint256 budget = vm.envUint("PYTH_DEPLOY_BUDGET_WEI");
            uint256 reserve = vm.envUint("PYTH_MIN_RESERVE_WEI");
            require(budget > 0 && reserve > 0 && owner.balance >= budget + reserve, "insufficient reserve/budget");
            console2.log("Kairo Pyth deploy maximum budget wei", budget);
            vm.startBroadcast(owner);
        } else { vm.deal(address(this), owner.balance); vm.startPrank(owner); }
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/config/pyth-stocks.json"));
        address pyth = vm.parseJsonAddress(json, string.concat(".chains.", vm.toString(chainId), ".pyth"));
        require(pyth.code.length > 0, "missing Pyth code");
        _bootstrap(pyth);
        oracle = new PythOracle(pyth, owner);
        resolver = new PythSettlementResolver(pyth, address(oracle), owner);
        IMontionsBook(book).setResolverAllowed(address(resolver), true);
        for (uint256 i; i < 29; ++i) {
            string memory k = string.concat(".assets[", vm.toString(i), "]");
            string memory symbol = vm.parseJsonString(json, string.concat(k, ".symbol"));
            bytes32 id = keccak256(bytes(symbol));
            bytes32 feed = vm.parseJsonBytes32(json, string.concat(k, ".feedId"));
            uint256 vol = vm.parseUint(vm.parseJsonString(json, string.concat(k, ".volWad")));
            uint32 age = uint32(vm.parseJsonUint(json, string.concat(k, ".maxAge")));
            oracle.setFeed(id, feed, vol, age);
            resolver.setSymbol(id, symbol);
        }
        require(!vm.keyExistsJson(json, ".assets[29]"), "expected 29 stocks");
        if (live) { vm.stopBroadcast(); } else { vm.stopPrank(); }
        console2.log("Kairo Pyth stock oracle", address(oracle));
        console2.log("Kairo Pyth stock resolver", address(resolver));
    }
    function _bootstrap(address pyth) internal {
        // PythOracle.setFeed requires feeds to exist first. File is JSON {"updateData":["0x..."]}.
        string memory file = vm.envOr("PYTH_BOOTSTRAP_FILE", string(""));
        if (bytes(file).length == 0) return;
        bytes[] memory data = abi.decode(vm.parseJson(vm.readFile(file), ".updateData"), (bytes[]));
        uint256 fee = IPyth(pyth).getUpdateFee(data);
        (bool ok,) = pyth.call{value: fee}(abi.encodeWithSignature("updatePriceFeeds(bytes[])", data));
        require(ok, "bootstrap failed");
    }
}
