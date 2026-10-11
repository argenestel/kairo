// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {ChainlinkOracle} from "../src/oracle/chainlink/ChainlinkOracle.sol";
import {IAggregatorProxy} from "../src/oracle/chainlink/IAggregatorV3.sol";
import {ChainlinkSettlementResolver} from "../src/resolvers/ChainlinkSettlementResolver.sol";
import {MontionsBook} from "../src/MontionsBook.sol";
import {Quoter} from "../src/Quoter.sol";
import {MakerVault} from "../src/MakerVault.sol";
import {KairoBook, KairoQuoter, KairoMakerVault} from "../src/Kairo.sol";

/// @notice Chain-generic Chainlink EVM deployment (Base Sepolia 84532, Arbitrum Sepolia 421614, …).
/// @dev Reads `config/chains.json`, finds the entry whose `chainId` matches `block.chainid` (or `CHAIN_ID`),
///      and registers every live Chainlink feed listed there. HyperCore (oracle "hypercore") is refused —
///      that stack is owned by `script/DeployHyperEVM.s.sol`.
///      Writes `deployments/<chainId>.contracts.json`; `scripts/evm-manifest.mjs` turns it into the SDK/bot
///      manifest. Only `ladder: true` feeds are registered (canonical ETH/BTC/LINK). Feeds that fail the
///      onchain liveness check (description, decimals, positive + fresh latest round) are SKIPPED.
///      ETH, BTC and LINK are required on Chainlink venues.
contract DeployEvm is Script {
    struct Out {
        address usdc;
        address oracle;
        address resolver;
        address book;
        address engine;
        address quoter;
        address vault;
        uint256 startBlock;
        uint256 registered;
        uint256 chainId;
    }

    function run() external {
        uint256 chainId = _targetChainId();
        (string memory cfg, string memory chainPath) = _chainPath(chainId);
        string memory oracleKind = vm.parseJsonString(cfg, string.concat(chainPath, ".oracle"));
        require(keccak256(bytes(oracleKind)) == keccak256("chainlink"), "DeployEvm: oracle is not chainlink");
        require(
            block.chainid == chainId || vm.envOr("ALLOW_ANY_CHAIN", uint256(0)) == 1,
            "DeployEvm: block.chainid does not match target chain"
        );

        address deployer = msg.sender;
        uint256 vaultSeed = vm.envOr("VAULT_SEED_USDC", uint256(1_000_000)) * 1e6;
        uint256 deployerUsdc = vm.envOr("DEPLOYER_USDC", uint256(100_000)) * 1e6;

        Out memory o;
        o.chainId = chainId;
        o.startBlock = block.number;
        vm.startBroadcast(deployer);
        o.usdc = address(new TestUSDC(deployer));
        ChainlinkOracle oracle = new ChainlinkOracle(deployer);
        o.oracle = address(oracle);
        o.registered = _registerFeeds(oracle, cfg, chainPath);
        require(
            oracle.feedOf(keccak256("ETH")) != address(0) && oracle.feedOf(keccak256("BTC")) != address(0)
                && oracle.feedOf(keccak256("LINK")) != address(0),
            "DeployEvm: ETH/BTC/LINK required"
        );
        o.resolver = address(new ChainlinkSettlementResolver(o.oracle));
        MontionsBook book = new KairoBook(o.usdc, deployer);
        o.book = address(book);
        o.engine = book.engine();
        book.setResolverAllowed(o.resolver, true);
        o.quoter = address(new KairoQuoter(o.book, o.resolver));
        MakerVault vault = new KairoMakerVault(o.book, o.quoter, deployer);
        o.vault = address(vault);
        vault.setTrustedResolver(o.resolver);
        vault.setKeeper(deployer);
        vault.setTrustedAsset(keccak256("ETH"), true, 25e18);
        vault.setTrustedAsset(keccak256("BTC"), true, 500e18);
        vault.setTrustedAsset(keccak256("LINK"), true, 0.25e18);
        // Testnet launch caps: 15 bps of NAV per series lets the 63-market ETH/BTC/LINK ladder
        // (3 assets x 7 strikes x 3 expiries) sit well under the 30% global exposure cap.
        vault.setCaps(15, 3000, 2000);
        vault.setMaxTotalAssets(5_000_000e6);
        book.setCollateralCap(50_000_000e6);
        book.setSeriesPoolCap(1_000_000e6);
        TestUSDC(o.usdc).mint(deployer, vaultSeed + deployerUsdc);
        if (vaultSeed != 0) {
            TestUSDC(o.usdc).approve(o.vault, vaultSeed);
            vault.deposit(vaultSeed, deployer);
        }
        vm.stopBroadcast();

        _writeContracts(o);
        console2.log("DEPLOYED chainId", o.chainId);
        console2.log("tUSDC", o.usdc);
        console2.log("ChainlinkOracle", o.oracle);
        console2.log("ChainlinkSettlementResolver", o.resolver);
        console2.log("MontionsBook", o.book);
        console2.log("MontionsBookEngine", o.engine);
        console2.log("Quoter", o.quoter);
        console2.log("MakerVault", o.vault);
        console2.log("feeds registered", o.registered);
    }

    function _targetChainId() internal view returns (uint256 chainId) {
        chainId = vm.envOr("CHAIN_ID", uint256(0));
        if (chainId == 0) chainId = block.chainid;
    }

    function _chainPath(uint256 chainId) internal view returns (string memory cfg, string memory chainPath) {
        cfg = vm.readFile(string.concat(vm.projectRoot(), "/config/chains.json"));
        for (uint256 i; vm.keyExistsJson(cfg, string.concat(".chains[", vm.toString(i), "].chainId")); ++i) {
            string memory path = string.concat(".chains[", vm.toString(i), "]");
            if (vm.parseJsonUint(cfg, string.concat(path, ".chainId")) == chainId) {
                return (cfg, path);
            }
        }
        revert("DeployEvm: chainId not in config/chains.json");
    }

    function _registerFeeds(ChainlinkOracle oracle, string memory cfg, string memory chainPath)
        internal
        returns (uint256 registered)
    {
        for (
            uint256 i;
            vm.keyExistsJson(cfg, string.concat(chainPath, ".assets[", vm.toString(i), "].symbol"));
            ++i
        ) {
            if (_tryRegister(oracle, cfg, string.concat(chainPath, ".assets[", vm.toString(i), "]"))) {
                ++registered;
            }
        }
    }

    function _tryRegister(ChainlinkOracle oracle, string memory cfg, string memory k) internal returns (bool) {
        string memory symbol = vm.parseJsonString(cfg, string.concat(k, ".symbol"));
        bool ladder = vm.keyExistsJson(cfg, string.concat(k, ".ladder"))
            && vm.parseJsonBool(cfg, string.concat(k, ".ladder"));
        if (!ladder) {
            console2.log("SKIP (not a ladder asset)", symbol);
            return false;
        }
        if (!vm.keyExistsJson(cfg, string.concat(k, ".feed"))) {
            console2.log("SKIP (no Chainlink feed)", symbol);
            return false;
        }
        address feed = vm.parseJsonAddress(cfg, string.concat(k, ".feed"));
        uint32 maxStaleness = uint32(vm.parseJsonUint(cfg, string.concat(k, ".maxStaleness")));
        if (!_live(feed, cfg, k, maxStaleness)) {
            console2.log("SKIP (not live / mismatch)", symbol, feed);
            return false;
        }
        _setFeed(oracle, cfg, k, symbol, feed, maxStaleness);
        console2.log("registered", symbol, feed);
        return true;
    }

    function _setFeed(
        ChainlinkOracle oracle,
        string memory cfg,
        string memory k,
        string memory symbol,
        address feed,
        uint32 maxStaleness
    ) internal {
        bytes32 assetId = keccak256(bytes(symbol));
        oracle.setFeed(
            assetId,
            feed,
            vm.parseJsonString(cfg, string.concat(k, ".display")),
            vm.parseJsonString(cfg, string.concat(k, ".quote")),
            uint32(vm.parseJsonUint(cfg, string.concat(k, ".settleDelay"))),
            vm.parseJsonUint(cfg, string.concat(k, ".volWad")),
            maxStaleness
        );
        uint32 heartbeat = uint32(vm.parseJsonUint(cfg, string.concat(k, ".heartbeat")));
        oracle.setMarketPolicy(assetId, heartbeat, _strikeStepWad(symbol), true);
    }

    function _strikeStepWad(string memory symbol) internal pure returns (uint256) {
        bytes32 s = keccak256(bytes(symbol));
        if (s == keccak256("ETH")) return 25e18;
        if (s == keccak256("BTC")) return 500e18;
        if (s == keccak256("LINK")) return 0.25e18;
        if (s == keccak256("SOL")) return 1e18;
        return 0;
    }

    function _live(address feed, string memory cfg, string memory k, uint32 maxStaleness) internal view returns (bool) {
        if (feed.code.length == 0) return false;
        try IAggregatorProxy(feed).description() returns (string memory d) {
            if (keccak256(bytes(d)) != keccak256(bytes(vm.parseJsonString(cfg, string.concat(k, ".description"))))) {
                return false;
            }
        } catch {
            return false;
        }
        if (IAggregatorProxy(feed).decimals() != uint8(vm.parseJsonUint(cfg, string.concat(k, ".decimals")))) {
            return false;
        }
        (, int256 answer,, uint256 updatedAt,) = IAggregatorProxy(feed).latestRoundData();
        return
            answer > 0 && updatedAt != 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= maxStaleness;
    }

    function _writeContracts(Out memory o) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "book", o.book);
        vm.serializeAddress(c, "bookEngine", o.engine);
        vm.serializeAddress(c, "quoter", o.quoter);
        vm.serializeAddress(c, "collateral", o.usdc);
        vm.serializeAddress(c, "vault", o.vault);
        vm.serializeAddress(c, "chainlinkOracle", o.oracle);
        string memory contracts = vm.serializeAddress(c, "chainlinkResolver", o.resolver);
        string memory root = "root";
        vm.serializeUint(root, "chainId", o.chainId);
        vm.serializeUint(root, "startBlock", o.startBlock);
        vm.serializeUint(root, "feedsRegistered", o.registered);
        string memory json = vm.serializeString(root, "contracts", contracts);
        string memory out =
            vm.envOr("CONTRACTS_OUT", string.concat("deployments/", vm.toString(o.chainId), ".contracts.json"));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/", out));
    }
}
