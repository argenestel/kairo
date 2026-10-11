// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {KeeperFeedHub} from "../src/oracle/keeperfeed/KeeperFeedHub.sol";
import {ChainlinkOracle} from "../src/oracle/chainlink/ChainlinkOracle.sol";
import {MakerVault} from "../src/MakerVault.sol";
import {MontionsBook} from "../src/MontionsBook.sol";
import {Quoter} from "../src/Quoter.sol";

/// @notice Deploy KeeperFeedHub + per-symbol feeds, register them on the Kairo
///         ChainlinkOracle, allowlist them on MakerVault, and (optionally) open
///         one smoke-test TSLA series.
/// @dev Rehearsal default: on chain 84532/421614 require `FORK_REHEARSAL=1` and
///      write `deployments/rehearsal/stocks-<chainId>.json` (never the live
///      manifest). Live mode: `ALLOW_LIVE_STOCKS=1` plus a reserve/balance
///      check; writes `deployments/<chainId>.stocks.json` sidecar only.
contract DeployStocks is Script {
    struct Asset {
        string symbol;
        uint256 volWad;
        int256 priceE8;
        uint256 strikeStepWad;
    }

    uint256 internal chainId;
    bool internal live;
    uint32 internal settleDelay;
    uint32 internal maxStaleness;
    uint64 internal heartbeat;
    uint64 internal observedAt;
    address internal oracleAddr;
    address internal bookAddr;
    address internal resolverAddr;
    address internal quoterAddr;
    address internal vaultAddr;
    address internal reporter;
    KeeperFeedHub internal hub;
    uint256 internal registered;
    uint256 internal trusted;
    bytes32 internal seriesId;
    uint64 internal expiry;
    uint8 internal fairTick;
    uint256 internal spotWad;
    Asset[] internal assets;
    address[] internal feeds;
    bytes32[] internal ids;

    function run() external {
        chainId = block.chainid;
        live = _isLiveTarget();
        if (chainId == 84532 || chainId == 421614) {
            if (live) {
                require(
                    vm.envOr("ALLOW_LIVE_STOCKS", uint256(0)) == 1,
                    "DeployStocks: live chainId requires ALLOW_LIVE_STOCKS=1"
                );
                uint256 minReserve = vm.envOr("LIVE_MIN_RESERVE_WEI", uint256(0));
                require(msg.sender.balance > minReserve, "DeployStocks: balance at or below reserve");
                console2.log("LIVE stocks deploy chainId", chainId);
                console2.log("balance wei", msg.sender.balance);
                console2.log("minReserve wei", minReserve);
            } else {
                require(
                    vm.envOr("FORK_REHEARSAL", uint256(0)) == 1,
                    "DeployStocks: live chainId requires FORK_REHEARSAL=1 (anvil fork) or ALLOW_LIVE_STOCKS=1"
                );
            }
        }
        _loadConfig();
        require(assets.length == 29, "DeployStocks: expected 29 symbols");

        vm.startBroadcast();
        _deployFeeds();
        _registerOracle();
        _trustVault();
        _maybeCreateSeries();
        vm.stopBroadcast();

        _writeOut();
        console2.log("hub", address(hub));
        console2.log("feeds", assets.length);
        console2.log("registered", registered);
        console2.log("trusted", trusted);
        console2.log("fairTick", fairTick);
        console2.log("spotWad", spotWad);
    }

    function _isLiveTarget() internal view returns (bool) {
        if (chainId != 84532 && chainId != 421614) return false;
        if (vm.envOr("FORK_REHEARSAL", uint256(0)) == 1) return false;
        if (vm.envOr("ALLOW_LIVE_STOCKS", uint256(0)) == 1) return true;
        return false;
    }

    function _loadConfig() internal {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/config/stocks.json"));
        settleDelay = uint32(vm.parseJsonUint(json, ".oracle.settleDelay"));
        maxStaleness = uint32(vm.parseJsonUint(json, ".oracle.maxStaleness"));
        heartbeat = uint64(vm.parseJsonUint(json, ".oracle.heartbeatSeconds"));
        uint64 observedAtCfg = uint64(vm.parseJsonUint(json, ".priceObservedAt"));
        observedAt = observedAtCfg > uint64(block.timestamp) ? uint64(block.timestamp) : observedAtCfg;
        _readAssets(json);
        oracleAddr = vm.envOr("ORACLE", _manifestAddress("chainlinkOracle"));
        bookAddr = vm.envOr("BOOK", _manifestAddress("book"));
        resolverAddr = vm.envOr("RESOLVER", _manifestAddress("chainlinkResolver"));
        quoterAddr = vm.envOr("QUOTER", _manifestAddress("quoter"));
        vaultAddr = vm.envOr("VAULT", _manifestAddress("vault"));
        reporter = vm.envOr("REPORTER", msg.sender);
    }

    function _deployFeeds() internal {
        hub = new KeeperFeedHub(msg.sender, reporter);
        if (heartbeat != hub.heartbeat()) hub.setHeartbeat(heartbeat);
        uint256 n = assets.length;
        int256[] memory prices = new int256[](n);
        uint64[] memory obs = new uint64[](n);
        for (uint256 i; i < n; ++i) {
            address feed = hub.createFeed(assets[i].symbol);
            feeds.push(feed);
            ids.push(keccak256(bytes(assets[i].symbol)));
            prices[i] = assets[i].priceE8;
            obs[i] = observedAt;
            console2.log("feed", assets[i].symbol, feed);
        }
        hub.push(ids, prices, obs);
    }

    function _registerOracle() internal {
        if (oracleAddr == address(0)) {
            console2.log("SKIP setFeed: no ORACLE");
            return;
        }
        ChainlinkOracle oracle = ChainlinkOracle(oracleAddr);
        if (oracle.owner() != msg.sender) {
            console2.log("SKIP setFeed: msg.sender is not ChainlinkOracle owner", oracle.owner());
            return;
        }
        for (uint256 i; i < assets.length; ++i) {
            if (oracle.feedOf(ids[i]) != address(0)) {
                console2.log("SKIP already registered", assets[i].symbol);
                continue;
            }
            oracle.setFeed(ids[i], feeds[i], assets[i].symbol, "USD", settleDelay, assets[i].volWad, maxStaleness);
            // heartbeat 0: quoting uses maxStaleness (2 days) so a weekend heartbeat stays quotable.
            oracle.setMarketPolicy(ids[i], 0, assets[i].strikeStepWad, true);
            ++registered;
            console2.log("registered", assets[i].symbol);
        }
    }

    function _trustVault() internal {
        if (vaultAddr == address(0)) {
            console2.log("SKIP setTrustedAsset: no VAULT");
            return;
        }
        MakerVault vault = MakerVault(vaultAddr);
        if (vault.owner() != msg.sender) {
            console2.log("SKIP setTrustedAsset: not vault owner", vault.owner());
            return;
        }
        if (vault.trustedAssetCount() == 0) {
            console2.log("SKIP setTrustedAsset: empty allowlist quotes every series");
            return;
        }
        for (uint256 i; i < assets.length; ++i) {
            if (vault.isTrustedAsset(ids[i])) continue;
            vault.setTrustedAsset(ids[i], true, assets[i].strikeStepWad);
            ++trusted;
            console2.log("trusted", assets[i].symbol);
        }
    }

    function _maybeCreateSeries() internal {
        uint256 defaultCreate = live ? 0 : 1;
        if (vm.envOr("CREATE_SERIES", defaultCreate) != 1) return;
        if (bookAddr == address(0) || resolverAddr == address(0) || oracleAddr == address(0)) return;
        if (ChainlinkOracle(oracleAddr).feedOf(ids[0]) != feeds[0]) return;
        expiry = _nextFridayClose(uint64(block.timestamp));
        if (expiry < uint64(block.timestamp) + 120) expiry += 7 days;
        uint256 strikeWad = uint256(uint256(assets[0].priceE8) * 1e10);
        uint256 step = assets[0].strikeStepWad;
        if (step == 0) step = 5e18;
        strikeWad = ((strikeWad + step / 2) / step) * step;
        bytes memory data = abi.encode(oracleAddr, ids[0], strikeWad, true, settleDelay);
        seriesId = MontionsBook(bookAddr).createSeries(resolverAddr, data, expiry);
        console2.log("series", vm.toString(seriesId));
        console2.log("expiry", expiry);
        console2.log("strikeWad", strikeWad);
        if (quoterAddr == address(0)) return;
        (fairTick,,,) = Quoter(quoterAddr).fair(seriesId);
        (spotWad,) = ChainlinkOracle(oracleAddr).latestPrice(ids[0]);
    }

    function _readAssets(string memory json) internal {
        uint256 n;
        while (vm.keyExistsJson(json, string.concat(".assets[", vm.toString(n), "].symbol"))) {
            ++n;
        }
        for (uint256 i; i < n; ++i) {
            string memory k = string.concat(".assets[", vm.toString(i), "]");
            assets.push(
                Asset({
                    symbol: vm.parseJsonString(json, string.concat(k, ".symbol")),
                    volWad: vm.parseJsonUint(json, string.concat(k, ".volWad")),
                    priceE8: int256(vm.parseJsonUint(json, string.concat(k, ".priceE8"))),
                    strikeStepWad: vm.parseJsonUint(json, string.concat(k, ".strikeStepWad"))
                })
            );
        }
    }

    function _manifestAddress(string memory key) internal view returns (address) {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(chainId), ".json");
        string memory rehearsal = string.concat(vm.projectRoot(), "/deployments/rehearsal/", vm.toString(chainId), ".json");
        if (_tryAddress(path, key) != address(0)) return _tryAddress(path, key);
        return _tryAddress(rehearsal, key);
    }

    function _tryAddress(string memory path, string memory key) internal view returns (address) {
        try vm.readFile(path) returns (string memory m) {
            string memory jp = string.concat(".contracts.", key);
            if (!vm.keyExistsJson(m, jp)) return address(0);
            return vm.parseJsonAddress(m, jp);
        } catch {
            return address(0);
        }
    }

    function _nextFridayClose(uint64 nowTs) internal pure returns (uint64) {
        uint256 unixDays = uint256(nowTs) / 1 days;
        uint256 weekday = (unixDays + 4) % 7;
        uint256 daysUntilFriday = (5 + 7 - weekday) % 7;
        uint256 friday = (unixDays + daysUntilFriday) * 1 days + 20 hours;
        if (friday <= nowTs) friday += 7 days;
        return uint64(friday);
    }

    function _writeOut() internal {
        string memory root = "root";
        vm.serializeUint(root, "chainId", chainId);
        vm.serializeAddress(root, "hub", address(hub));
        vm.serializeAddress(root, "reporter", reporter);
        vm.serializeUint(root, "registered", registered);
        vm.serializeUint(root, "trusted", trusted);
        vm.serializeBytes32(root, "demoSeriesId", seriesId);
        vm.serializeUint(root, "demoExpiry", expiry);
        vm.serializeUint(root, "demoFairTick", fairTick);
        vm.serializeUint(root, "demoSpotWad", spotWad);
        string memory feedsObj = "feeds";
        string memory inner;
        for (uint256 i; i < assets.length; ++i) {
            inner = vm.serializeAddress(feedsObj, assets[i].symbol, feeds[i]);
        }
        string memory jsonOut = vm.serializeString(root, "feeds", inner);
        string memory out = vm.envOr(
            "OUT",
            live
                ? string.concat("deployments/", vm.toString(chainId), ".stocks.json")
                : string.concat("deployments/rehearsal/stocks-", vm.toString(chainId), ".json")
        );
        if (live) {
            require(
                keccak256(bytes(out)) != keccak256(bytes(string.concat("deployments/", vm.toString(chainId), ".json"))),
                "DeployStocks: refusing to overwrite live manifest"
            );
        }
        vm.writeJson(jsonOut, string.concat(vm.projectRoot(), "/", out));
        console2.log("wrote", out);
    }
}
