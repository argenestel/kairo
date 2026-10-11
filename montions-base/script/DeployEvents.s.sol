// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IMontionsBook} from "../src/interfaces/IMontionsBook.sol";
import {MontionsBook} from "../src/MontionsBook.sol";
import {OptimisticEventResolver} from "../src/resolvers/OptimisticEventResolver.sol";
import {EventRegistration} from "../src/resolvers/events/EventTypes.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";

/// @notice Deploy the Kairo event resolver, allowlist it, register `config/events.json`, create series.
/// @dev Refuses a live broadcast unless FORK=1 (local anvil fork) or chainid 31337.
///      Rehearsal: `anvil --fork-url https://sepolia.base.org --port 8552 --auto-impersonate`
///      then `FORK=1 REHEARSE_E2E=1 forge script script/DeployEvents.s.sol:DeployEvents
///            --rpc-url http://127.0.0.1:8552 --broadcast --unlocked --sender <book owner>`.
///      Writes `deployments/rehearsal/events.json`. Does not touch live manifests.
contract DeployEvents is Script {
    uint256 internal constant _UNIT = 1_000_000;

    struct CatalogEvent {
        string key;
        string question;
        string rules;
        string source;
        uint64 closeTime;
        string category;
        string icon;
    }

    function run() external {
        bool live = _liveMode();
        if (!live) _refuseLive();
        uint256 chainId = block.chainid;
        (address bookAddr, address collateral) = _bookAndCollateral(chainId);
        require(bookAddr != address(0) && collateral != address(0), "DeployEvents: missing Book/collateral");
        MontionsBook book = MontionsBook(bookAddr);
        address admin = book.owner();
        address treasury = vm.envOr("EVENT_TREASURY", admin);
        address arbitrator = vm.envOr("EVENT_ARBITRATOR", admin);
        if (live) {
            require(admin == msg.sender, "DeployEvents: live sender must be Book owner");
            uint256 minReserve = vm.envOr("LIVE_MIN_RESERVE_WEI", uint256(0));
            require(msg.sender.balance > minReserve, "DeployEvents: balance at or below reserve");
            console2.log("LIVE events deploy chainId", chainId);
            console2.log("balance wei", msg.sender.balance);
        } else {
            vm.deal(admin, 10 ether);
        }

        if (live) vm.startBroadcast();
        else vm.startBroadcast(admin);
        OptimisticEventResolver resolver = new OptimisticEventResolver(collateral, admin, treasury, arbitrator);
        book.setResolverAllowed(address(resolver), true);
        uint256 registered;
        uint256 created;
        bytes32 firstSeries;
        uint256 n = _eventCount();
        for (uint256 i; i < n; ++i) {
            CatalogEvent memory ev = _eventAt(i);
            resolver.registerEvent(
                EventRegistration({
                    key: ev.key,
                    question: ev.question,
                    rules: ev.rules,
                    source: ev.source,
                    closeTime: ev.closeTime,
                    category: ev.category,
                    icon: ev.icon
                })
            );
            registered++;
            if (
                ev.closeTime >= block.timestamp + book.MIN_DURATION()
                    && ev.closeTime <= block.timestamp + book.MAX_DURATION()
            ) {
                bytes32 eventKey = resolver.eventKeyOf(ev.key);
                bytes memory data = resolver.seriesData(eventKey);
                bytes32 seriesId = book.createSeries(address(resolver), data, ev.closeTime);
                created++;
                if (firstSeries == bytes32(0)) firstSeries = seriesId;
            } else {
                console2.log("skip series (duration)", ev.key);
            }
        }
        vm.stopBroadcast();

        console2.log("OptimisticEventResolver", address(resolver));
        console2.log("registered", registered);
        console2.log("series created", created);

        if (!live && vm.envOr("REHEARSE_E2E", uint256(1)) == 1 && firstSeries != bytes32(0)) {
            _rehearseBuy(book, TestUSDC(collateral), admin, firstSeries);
        }

        _writeManifest(chainId, bookAddr, collateral, address(resolver), admin, registered, created, firstSeries);
    }

    /// @notice Resume the buy rehearsal against `deployments/rehearsal/events.json` (no re-register).
    function rehearseBuyFromManifest() external {
        _refuseLive();
        string memory man = vm.readFile(string.concat(vm.projectRoot(), "/deployments/rehearsal/events.json"));
        MontionsBook book = MontionsBook(vm.parseJsonAddress(man, ".book"));
        TestUSDC usdc = TestUSDC(vm.parseJsonAddress(man, ".collateral"));
        bytes32 seriesId = vm.parseJsonBytes32(man, ".rehearseSeries");
        address admin = book.owner();
        vm.deal(admin, 10 ether);
        _rehearseBuy(book, usdc, admin, seriesId);
    }

    function _liveMode() internal view returns (bool) {
        if (vm.envOr("FORK", uint256(0)) == 1) return false;
        if (block.chainid != 84532 && block.chainid != 421614) return false;
        return vm.envOr("ALLOW_LIVE_EVENTS", uint256(0)) == 1;
    }

    function _refuseLive() internal view {
        if (vm.envOr("FORK", uint256(0)) == 1) return;
        if (block.chainid == 31337) return;
        revert("DeployEvents: refuses live broadcast; run on anvil with FORK=1 or set ALLOW_LIVE_EVENTS=1");
    }

    function _bookAndCollateral(uint256 chainId) internal view returns (address book, address collateral) {
        book = vm.envOr("BOOK", address(0));
        collateral = vm.envOr("COLLATERAL", address(0));
        if (book != address(0) && collateral != address(0)) return (book, collateral);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(chainId), ".json");
        string memory man = vm.readFile(path);
        if (book == address(0)) book = vm.parseJsonAddress(man, ".contracts.book");
        if (collateral == address(0)) collateral = vm.parseJsonAddress(man, ".contracts.collateral");
    }

    function _catalog() internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), "/config/events.json"));
    }

    function _eventCount() internal view returns (uint256 n) {
        string memory json = _catalog();
        while (vm.keyExistsJson(json, string.concat(".events[", vm.toString(n), "].key"))) n++;
    }

    function _eventAt(uint256 i) internal view returns (CatalogEvent memory ev) {
        string memory json = _catalog();
        string memory p = string.concat(".events[", vm.toString(i), "]");
        ev.key = vm.parseJsonString(json, string.concat(p, ".key"));
        ev.question = vm.parseJsonString(json, string.concat(p, ".question"));
        ev.rules = vm.parseJsonString(json, string.concat(p, ".rules"));
        ev.source = vm.parseJsonString(json, string.concat(p, ".resolutionSource"));
        ev.closeTime = uint64(vm.parseJsonUint(json, string.concat(p, ".closeTime")));
        ev.category = vm.parseJsonString(json, string.concat(p, ".category"));
        if (vm.keyExistsJson(json, string.concat(p, ".icon"))) {
            ev.icon = vm.parseJsonString(json, string.concat(p, ".icon"));
        }
    }

    /// @dev Buy only. Propose/resolve/redeem with warps live in `test/events/EventAnvilRehearse.t.sol`
    ///      because `vm.warp` is not persisted across forge-script's broadcast pass.
    function _rehearseBuy(
        MontionsBook book,
        TestUSDC usdc,
        address admin,
        bytes32 seriesId
    ) internal {
        address trader = address(0xE2E2);
        vm.deal(trader, 1 ether);
        vm.startBroadcast(admin);
        usdc.mint(admin, 10_000 * _UNIT);
        usdc.mint(trader, 10_000 * _UNIT);
        usdc.approve(address(book), type(uint256).max);
        book.deposit(1_000 * _UNIT);
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
        vm.stopBroadcast();

        vm.startBroadcast(trader);
        usdc.approve(address(book), type(uint256).max);
        book.deposit(1_000 * _UNIT);
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
        vm.stopBroadcast();
        console2.log("rehearse filled", filled);
        require(filled == 10, "DeployEvents: buy did not fill");
        console2.log("rehearse buy ok", uint256(seriesId));
    }

    function _writeManifest(
        uint256 chainId,
        address book,
        address collateral,
        address resolver,
        address admin,
        uint256 registered,
        uint256 created,
        bytes32 firstSeries
    ) internal {
        bool live = _liveMode();
        string memory obj = "events";
        vm.serializeUint(obj, "chainId", chainId);
        vm.serializeAddress(obj, "book", book);
        vm.serializeAddress(obj, "collateral", collateral);
        vm.serializeAddress(obj, "eventResolver", resolver);
        vm.serializeAddress(obj, "admin", admin);
        vm.serializeUint(obj, "registered", registered);
        vm.serializeUint(obj, "created", created);
        vm.serializeBytes32(obj, "rehearseSeries", firstSeries);
        string memory jsonOut = vm.serializeUint(obj, "timestamp", block.timestamp);
        string memory out = vm.envOr(
            "OUT",
            live
                ? string.concat("deployments/", vm.toString(chainId), ".events.json")
                : "deployments/rehearsal/events.json"
        );
        if (live) {
            require(
                keccak256(bytes(out)) != keccak256(bytes(string.concat("deployments/", vm.toString(chainId), ".json"))),
                "DeployEvents: refusing to overwrite live manifest"
            );
        }
        vm.writeJson(jsonOut, string.concat(vm.projectRoot(), "/", out));
        console2.log("wrote", out);
    }
}
