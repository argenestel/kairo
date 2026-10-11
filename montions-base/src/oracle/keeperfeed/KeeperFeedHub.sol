// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "solady/auth/Ownable.sol";
import {KeeperFeed} from "./KeeperFeed.sol";

/// @title KeeperFeedHub
/// @notice Owner + reporter hub that deploys `KeeperFeed`s and batch-pushes prices
///         in a single transaction.
/// @dev DEMO ORACLE. A trusted keeper fetches public market data (Yahoo chart API,
///      Nasdaq quote API, optionally Stooq) and calls `push`. Every Kairo series
///      settled off these feeds inherits that keeper trust. The 25% per-push bound
///      and monotonic `observedAt` checks are sanity rails, not a root of trust.
///
///      `push` skips an unchanged price unless `heartbeat` seconds have elapsed
///      (so a close print still lands even when the last tick did not move, as
///      long as the feeder waits the heartbeat — default 5 minutes, matching the
///      in-session cadence). `observedAt` in the future or strictly older than the
///      feed's last observation reverts. `|Δ| > 25%` reverts unless the owner
///      calls `forcePush`.
///
///      Upgrade path: Pyth (Hermes key) or Chainlink Data Streams. This hub is not
///      in that path; new feeds are registered under new asset ids.
contract KeeperFeedHub is Ownable {
    uint16 public constant DEFAULT_MAX_DEVIATION_BPS = 2_500; // 25%
    uint64 public constant DEFAULT_HEARTBEAT = 5 minutes;
    uint16 public constant MAX_DEVIATION_BPS = 10_000;
    uint64 public constant MAX_HEARTBEAT = 7 days;

    uint64 public heartbeat = DEFAULT_HEARTBEAT;
    uint16 public maxDeviationBps = DEFAULT_MAX_DEVIATION_BPS;

    mapping(address reporter => bool allowed) public isReporter;
    mapping(bytes32 id => address feed) public feedOf;
    mapping(bytes32 id => string symbol) public symbolOf;
    mapping(address feed => bytes32 id) public idOf;
    bytes32[] internal _ids;

    error ZeroAddress();
    error EmptySymbol();
    error NotReporter();
    error LengthMismatch();
    error FeedExists(bytes32 id);
    error UnknownFeed(bytes32 id);
    error InvalidPrice(int256 answer);
    error FutureObservation(bytes32 id, uint64 observedAt);
    error StaleObservation(bytes32 id, uint64 observedAt, uint64 lastObservedAt);
    error DeviationTooLarge(bytes32 id, int256 previous, int256 next);
    error InvalidHeartbeat(uint64 heartbeat);
    error InvalidDeviation(uint16 bps);
    error UnknownFeedAddress(address feed);

    event FeedCreated(bytes32 indexed id, address indexed feed, string symbol);
    event FeedRegistered(bytes32 indexed id, address indexed feed, string symbol);
    event ReporterSet(address indexed reporter, bool allowed);
    event HeartbeatSet(uint64 heartbeat);
    event MaxDeviationBpsSet(uint16 bps);
    event PricePushed(
        bytes32 indexed id,
        address indexed feed,
        int256 price,
        uint80 roundId,
        uint64 observedAt,
        uint256 updatedAt,
        bool force
    );
    event PriceSkipped(bytes32 indexed id, address indexed feed, int256 price, uint64 observedAt);

    /// @param owner_ Two-step Ownable owner (Solady). Owner can push without being a reporter.
    /// @param reporter_ Optional initial reporter (`address(0)` to skip).
    constructor(address owner_, address reporter_) {
        if (owner_ == address(0)) revert ZeroAddress();
        _initializeOwner(owner_);
        if (reporter_ != address(0)) {
            isReporter[reporter_] = true;
            emit ReporterSet(reporter_, true);
        }
    }

    modifier onlyReporter() {
        if (msg.sender != owner() && !isReporter[msg.sender]) revert NotReporter();
        _;
    }

    /// @notice Grant or revoke the reporter role (owner always may `push`).
    function setReporter(address reporter, bool allowed) external onlyOwner {
        if (reporter == address(0)) revert ZeroAddress();
        isReporter[reporter] = allowed;
        emit ReporterSet(reporter, allowed);
    }

    /// @notice Unchanged-price skip window. 0 = never skip (every push writes a round).
    function setHeartbeat(uint64 heartbeat_) external onlyOwner {
        if (heartbeat_ > MAX_HEARTBEAT) revert InvalidHeartbeat(heartbeat_);
        heartbeat = heartbeat_;
        emit HeartbeatSet(heartbeat_);
    }

    /// @notice Per-push relative bound in bps of the previous price (1..10000). Owner `forcePush` bypasses it.
    function setMaxDeviationBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > MAX_DEVIATION_BPS) revert InvalidDeviation(bps);
        maxDeviationBps = bps;
        emit MaxDeviationBpsSet(bps);
    }

    /// @notice Deploy a new `KeeperFeed` for `symbol`. Id is `keccak256(bytes(symbol))`.
    function createFeed(string calldata symbol) public onlyOwner returns (address feed) {
        bytes32 id = keccak256(bytes(symbol));
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (feedOf[id] != address(0)) revert FeedExists(id);
        KeeperFeed deployed = new KeeperFeed(address(this), symbol);
        feed = address(deployed);
        feedOf[id] = feed;
        symbolOf[id] = symbol;
        idOf[feed] = id;
        _ids.push(id);
        emit FeedCreated(id, feed, symbol);
    }

    /// @notice Deploy many feeds in one tx.
    function createFeeds(string[] calldata symbols) external onlyOwner returns (address[] memory feeds) {
        uint256 n = symbols.length;
        feeds = new address[](n);
        for (uint256 i; i < n; ++i) {
            feeds[i] = createFeed(symbols[i]);
        }
    }

    /// @notice Register an already-deployed feed that this hub controls (same `hub()`).
    function registerFeed(string calldata symbol, address feed) external onlyOwner {
        if (feed == address(0) || feed.code.length == 0) revert ZeroAddress();
        if (bytes(symbol).length == 0) revert EmptySymbol();
        bytes32 id = keccak256(bytes(symbol));
        if (feedOf[id] != address(0)) revert FeedExists(id);
        if (idOf[feed] != bytes32(0)) revert FeedExists(idOf[feed]);
        if (KeeperFeed(feed).hub() != address(this)) revert UnknownFeedAddress(feed);
        feedOf[id] = feed;
        symbolOf[id] = symbol;
        idOf[feed] = id;
        _ids.push(id);
        emit FeedRegistered(id, feed, symbol);
    }

    /// @notice Batch-update feeds. `ids[i] = keccak256(bytes(symbol))`. Skips unchanged prices inside the heartbeat.
    function push(bytes32[] calldata ids_, int256[] calldata prices, uint64[] calldata observedAts)
        external
        onlyReporter
    {
        _push(ids_, prices, observedAts, false);
    }

    /// @notice Owner-only push that bypasses the 25% bound and the unchanged skip (always writes a round).
    ///         Still rejects future / strictly-older `observedAt` and non-positive prices.
    function forcePush(bytes32[] calldata ids_, int256[] calldata prices, uint64[] calldata observedAts)
        external
        onlyOwner
    {
        _push(ids_, prices, observedAts, true);
    }

    /// @notice Number of registered feeds.
    function feedCount() external view returns (uint256) {
        return _ids.length;
    }

    /// @notice Registered asset ids in creation order (`keccak256(symbol)`).
    function feedIds() external view returns (bytes32[] memory) {
        return _ids;
    }

    /// @notice Convenience: feed address for a ticker string.
    function feedOfSymbol(string calldata symbol) external view returns (address) {
        return feedOf[keccak256(bytes(symbol))];
    }

    function _push(bytes32[] calldata ids_, int256[] calldata prices, uint64[] calldata observedAts, bool force)
        internal
    {
        uint256 n = ids_.length;
        if (n != prices.length || n != observedAts.length) revert LengthMismatch();
        for (uint256 i; i < n; ++i) {
            _pushOne(ids_[i], prices[i], observedAts[i], force);
        }
    }

    function _pushOne(bytes32 id, int256 price, uint64 observedAt, bool force) internal {
        address feedAddr = feedOf[id];
        if (feedAddr == address(0)) revert UnknownFeed(id);
        if (price <= 0) revert InvalidPrice(price);
        if (observedAt > block.timestamp) revert FutureObservation(id, observedAt);

        (int256 lastPrice, uint64 lastObs, uint64 lastTs,) = KeeperFeed(feedAddr).latestObservation();
        if (lastObs != 0 && observedAt < lastObs) revert StaleObservation(id, observedAt, lastObs);
        if (!force && lastPrice > 0 && _exceedsBound(lastPrice, price, maxDeviationBps)) {
            revert DeviationTooLarge(id, lastPrice, price);
        }
        if (!force && lastPrice == price && lastTs != 0 && block.timestamp - lastTs < heartbeat) {
            emit PriceSkipped(id, feedAddr, price, observedAt);
            return;
        }
        uint80 roundId = KeeperFeed(feedAddr).report(price, observedAt);
        emit PricePushed(id, feedAddr, price, roundId, observedAt, block.timestamp, force);
    }

    function _exceedsBound(int256 oldP, int256 newP, uint16 bps) private pure returns (bool) {
        uint256 oldU = uint256(oldP);
        uint256 newU = uint256(newP);
        uint256 delta = oldU > newU ? oldU - newU : newU - oldU;
        return delta * 10_000 > oldU * uint256(bps);
    }
}
