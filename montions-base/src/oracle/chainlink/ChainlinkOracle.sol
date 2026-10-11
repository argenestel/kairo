// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";
import {IAggregatorProxy} from "./IAggregatorV3.sol";
import {Ownable} from "solady/auth/Ownable.sol";

/// @title ChainlinkOracle
/// @notice WAD-normalising `IPriceOracle` adapter over Chainlink AggregatorV3 proxies (Base Sepolia data feeds).
/// @dev Mirrors `PythOracle`: spot = `latestRoundData` scaled to 1e18 with positive/complete/staleness checks;
///      `twapAt` is unavailable (settlement uses `ChainlinkSettlementResolver`, the first round at/after expiry);
///      `realizedVol` returns a static annualised operator input, NOT measured volatility.
///      Trust split (what the owner can and cannot change):
///        - ONE-TIME per asset (immutable after `setFeed`): the feed proxy, display symbol, quote label and the
///          settlement delay used by the resolver. An owner can never re-point an existing market at another feed.
///        - Adjustable (quoting/display only, never outcomes): `volWad` and `maxStaleness` via `setRisk`.
///      Prices are "quote units per one whole asset": USD for X/USD feeds, ETH for X/ETH feeds (see `quoteOf`).
contract ChainlinkOracle is IPriceOracle, Ownable {
    uint256 private constant WAD = 1e18;
    uint256 public constant MIN_VOL = 0.01e18;
    uint256 public constant MAX_VOL = 5e18;
    uint32 public constant MIN_STALENESS = 60;
    uint32 public constant MAX_STALENESS = 2 days;
    uint32 public constant MIN_SETTLE_DELAY = 60;
    uint32 public constant MAX_SETTLE_DELAY = 2 days;
    uint32 public constant MIN_HEARTBEAT = 1;
    uint32 public constant MAX_HEARTBEAT = 2 days;
    /// @notice Quoting refuses a print older than this many heartbeats (when `heartbeat` is set).
    uint32 public constant QUOTE_STALE_HEARTBEATS = 2;

    struct FeedConfig {
        address feed; // Chainlink proxy (EACAggregatorProxy)
        uint32 maxStaleness; // seconds; spot older than this is "unhealthy" and `latestPrice` reverts
        uint32 settleDelay; // seconds; series must encode this as maxDelay (first round must land within it)
        uint8 decimals; // feed decimals at registration (informational; live value is re-read)
        uint256 volWad; // static annualised volatility for the Quoter (1e18 = 100%)
        uint32 heartbeat; // feed cadence in seconds; 0 = unknown (quoting uses maxStaleness only)
        uint256 strikeStepWad; // canonical grid spacing; 0 = any strike
        bool ladder; // when true, the settlement resolver only validates on-grid, in-band series
    }

    mapping(bytes32 assetId => FeedConfig config) internal _config;
    mapping(address feed => bytes32 assetId) public assetOfFeed;
    mapping(bytes32 assetId => string symbol) public symbolOf;
    mapping(bytes32 assetId => string quote) public quoteOf;
    bytes32[] internal _assets;

    error ZeroAddress();
    error AssetAlreadyRegistered(bytes32 assetId);
    error FeedAlreadyRegistered(address feed);
    error InvalidVolatility(uint256 volWad);
    error InvalidStaleness(uint32 maxStaleness);
    error InvalidSettleDelay(uint32 settleDelay);
    error InvalidDecimals(uint8 decimals);
    error InvalidPrice(int256 answer);
    error InvalidRound(uint80 roundId, uint80 answeredInRound);
    error PriceOverflow(int256 answer, uint8 decimals);
    error StalePrice(bytes32 assetId, uint256 updatedAt);
    error EmptySymbol();
    error ZeroAssetId();
    error InvalidHeartbeat(uint32 heartbeat);
    error InvalidStrikeStep(uint256 strikeStepWad);

    event FeedRegistered(
        bytes32 indexed assetId,
        address indexed feed,
        string symbol,
        string quote,
        uint8 decimals,
        uint32 settleDelay,
        uint256 volWad,
        uint32 maxStaleness
    );
    event RiskSet(bytes32 indexed assetId, uint256 volWad, uint32 maxStaleness);
    event MarketPolicySet(bytes32 indexed assetId, uint32 heartbeat, uint256 strikeStepWad, bool ladder);

    /// @param owner_ Initial configuration owner (two-step handover via Solady Ownable).
    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        _initializeOwner(owner_);
    }

    /// @notice Register a Chainlink proxy for `assetId` (one-time; the feed can never be changed afterwards).
    /// @dev Sanity-checks the feed onchain: decimals <= 18 and a positive, complete latest round.
    /// @param assetId keccak256(symbol) by convention.
    /// @param feed Chainlink EACAggregatorProxy address.
    /// @param symbol Display symbol, e.g. "ETH".
    /// @param quote Quote label, e.g. "USD" (USD feeds) or "ETH" (ratio feeds).
    /// @param settleDelay Seconds after expiry within which the first round must land (>= feed heartbeat).
    /// @param volWad Static annualised volatility for quoting (1%..500%).
    /// @param maxStaleness Max age of the spot price for quoting/display (60 s .. 2 days).
    function setFeed(
        bytes32 assetId,
        address feed,
        string calldata symbol,
        string calldata quote,
        uint32 settleDelay,
        uint256 volWad,
        uint32 maxStaleness
    ) external onlyOwner {
        if (feed == address(0) || feed.code.length == 0) revert ZeroAddress();
        if (assetId == bytes32(0)) revert ZeroAssetId();
        if (_config[assetId].feed != address(0)) revert AssetAlreadyRegistered(assetId);
        if (assetOfFeed[feed] != bytes32(0)) revert FeedAlreadyRegistered(feed);
        if (bytes(symbol).length == 0 || bytes(quote).length == 0) revert EmptySymbol();
        if (settleDelay < MIN_SETTLE_DELAY || settleDelay > MAX_SETTLE_DELAY) revert InvalidSettleDelay(settleDelay);
        _checkRisk(volWad, maxStaleness);
        uint8 dec = IAggregatorProxy(feed).decimals();
        if (dec > 18) revert InvalidDecimals(dec);
        _checkRegistrationRound(feed);

        _config[assetId] = FeedConfig({
            feed: feed,
            maxStaleness: maxStaleness,
            settleDelay: settleDelay,
            decimals: dec,
            volWad: volWad,
            heartbeat: 0,
            strikeStepWad: 0,
            ladder: false
        });
        assetOfFeed[feed] = assetId;
        symbolOf[assetId] = symbol;
        quoteOf[assetId] = quote;
        _assets.push(assetId);
        emit FeedRegistered(assetId, feed, symbol, quote, dec, settleDelay, volWad, maxStaleness);
    }

    /// @notice Adjust the quoting volatility and spot staleness bound. Never affects settlement.
    function setRisk(bytes32 assetId, uint256 volWad, uint32 maxStaleness) external onlyOwner {
        FeedConfig storage c = _configOf(assetId);
        _checkRisk(volWad, maxStaleness);
        c.volWad = volWad;
        c.maxStaleness = maxStaleness;
        emit RiskSet(assetId, volWad, maxStaleness);
    }

    /// @notice Set the feed heartbeat, strike grid and ladder flag. Never re-points the feed.
    /// @dev `heartbeat` tightens `latestPrice` to 2× cadence (still capped by `maxStaleness`).
    ///      `ladder` + `strikeStepWad` are read by the settlement resolver at `validate`.
    function setMarketPolicy(bytes32 assetId, uint32 heartbeat, uint256 strikeStepWad, bool ladder)
        external
        onlyOwner
    {
        FeedConfig storage c = _configOf(assetId);
        _checkMarketPolicy(heartbeat, strikeStepWad, ladder);
        c.heartbeat = heartbeat;
        c.strikeStepWad = strikeStepWad;
        c.ladder = ladder;
        emit MarketPolicySet(assetId, heartbeat, strikeStepWad, ladder);
    }

    /// @notice Full configuration of `assetId` (zero struct if unknown).
    function feedConfig(bytes32 assetId) external view returns (FeedConfig memory) {
        return _config[assetId];
    }

    /// @notice Chainlink proxy for `assetId` (zero if unknown).
    function feedOf(bytes32 assetId) external view returns (address) {
        return _config[assetId].feed;
    }

    /// @notice Settlement delay (seconds) that every series on `assetId` must encode (zero if unknown).
    function settleDelayOf(bytes32 assetId) external view returns (uint32) {
        return _config[assetId].settleDelay;
    }

    /// @notice Configured feed heartbeat in seconds (zero if unknown).
    function heartbeatOf(bytes32 assetId) external view returns (uint32) {
        return _config[assetId].heartbeat;
    }

    /// @notice Canonical strike spacing in WAD (zero if the asset is not on a grid).
    function strikeStepOf(bytes32 assetId) external view returns (uint256) {
        return _config[assetId].strikeStepWad;
    }

    /// @notice Whether `assetId` is part of the seeded ETH/BTC/LINK (etc.) ladder.
    function isLadder(bytes32 assetId) external view returns (bool) {
        return _config[assetId].ladder;
    }

    /// @notice Max age of a print the Quoter should treat as a good quote (0 = use the Quoter default).
    /// @dev When `heartbeat` is set this is `min(maxStaleness, 2 * heartbeat)`.
    function quoteMaxAge(bytes32 assetId) external view returns (uint32) {
        FeedConfig storage c = _configOf(assetId);
        if (c.heartbeat == 0) return 0;
        return _quoteMaxAge(c);
    }

    /// @notice Number of registered assets.
    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    /// @notice Registered asset ids in registration order.
    function assets() external view returns (bytes32[] memory) {
        return _assets;
    }

    /// @inheritdoc IPriceOracle
    function assetExists(bytes32 assetId) external view override returns (bool) {
        return _config[assetId].feed != address(0);
    }

    /// @inheritdoc IPriceOracle
    /// @dev Reverts `StalePrice` when the latest round is older than `maxStaleness` and `InvalidPrice` when
    ///      the answer is not positive or the round is incomplete; the Quoter treats a revert as "no model".
    function latestPrice(bytes32 assetId) external view override returns (uint256 priceWad, uint64 updatedAt) {
        FeedConfig storage c = _configOf(assetId);
        IAggregatorProxy feed = IAggregatorProxy(c.feed);
        (uint80 roundId, int256 answer,, uint256 ts, uint80 answeredInRound) = feed.latestRoundData();
        if (roundId == 0 || answeredInRound < roundId) revert InvalidRound(roundId, answeredInRound);
        if (answer <= 0 || ts == 0) revert InvalidPrice(answer);
        if (ts > type(uint64).max || ts > block.timestamp || block.timestamp - ts > _quoteMaxAge(c)) {
            revert StalePrice(assetId, ts);
        }
        return (scale(answer, feed.decimals()), uint64(ts));
    }

    /// @inheritdoc IPriceOracle
    /// @notice Always reverts: settlement uses the first Chainlink round at/after expiry, not a TWAP.
    function twapAt(bytes32 assetId, uint64 t, uint32) external pure override returns (uint256) {
        revert HistoryUnavailable(assetId, t);
    }

    /// @inheritdoc IPriceOracle
    /// @notice Static annualised volatility configured by the owner; `lookback`/`step` are ignored.
    function realizedVol(bytes32 assetId, uint32, uint32) external view override returns (uint256 volWad) {
        return _configOf(assetId).volWad;
    }

    /// @notice True when the feed is registered and its latest round is complete, positive and fresh.
    function isHealthy(bytes32 assetId) external view returns (bool) {
        FeedConfig storage c = _config[assetId];
        if (c.feed == address(0)) return false;
        try IAggregatorProxy(c.feed).latestRoundData() returns (
            uint80 roundId, int256 answer, uint256, uint256 ts, uint80 answeredInRound
        ) {
            if (
                roundId == 0 || answeredInRound < roundId || answer <= 0 || ts == 0 || ts > block.timestamp
                    || block.timestamp - ts > _quoteMaxAge(c)
            ) return false;
            try IAggregatorProxy(c.feed).decimals() returns (uint8 dec) {
                return dec <= 18;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }

    /// @notice Scale a Chainlink answer with `decimals` (<= 18) to WAD. Reverts on non-positive answers.
    function scale(int256 answer, uint8 decimals_) public pure returns (uint256) {
        if (answer <= 0) revert InvalidPrice(answer);
        if (decimals_ > 18) revert InvalidDecimals(decimals_);
        uint256 multiplier = 10 ** (18 - uint256(decimals_));
        if (uint256(answer) > type(uint256).max / multiplier) revert PriceOverflow(answer, decimals_);
        return uint256(answer) * multiplier;
    }

    function _configOf(bytes32 assetId) private view returns (FeedConfig storage c) {
        c = _config[assetId];
        if (c.feed == address(0)) revert UnknownAsset(assetId);
    }

    function _checkRegistrationRound(address feed) private view {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IAggregatorProxy(feed).latestRoundData();
        if (roundId == 0 || answeredInRound < roundId) revert InvalidRound(roundId, answeredInRound);
        if (answer <= 0 || updatedAt == 0) revert InvalidPrice(answer);
    }

    function _checkRisk(uint256 volWad, uint32 maxStaleness) private pure {
        if (volWad < MIN_VOL || volWad > MAX_VOL) revert InvalidVolatility(volWad);
        if (maxStaleness < MIN_STALENESS || maxStaleness > MAX_STALENESS) revert InvalidStaleness(maxStaleness);
    }

    function _checkMarketPolicy(uint32 heartbeat, uint256 strikeStepWad, bool ladder) private pure {
        if (heartbeat != 0 && (heartbeat < MIN_HEARTBEAT || heartbeat > MAX_HEARTBEAT)) {
            revert InvalidHeartbeat(heartbeat);
        }
        if (ladder && strikeStepWad == 0) revert InvalidStrikeStep(strikeStepWad);
    }

    /// @dev Heartbeat 0 keeps the historical `maxStaleness` bound so existing tests and live oracles
    ///      without `setMarketPolicy` behave as before. Once a heartbeat is set, quoting refuses
    ///      prints older than two heartbeats (still never looser than `maxStaleness`).
    function _quoteMaxAge(FeedConfig storage c) private view returns (uint32) {
        if (c.heartbeat == 0) return c.maxStaleness;
        uint256 hbCap = uint256(c.heartbeat) * uint256(QUOTE_STALE_HEARTBEATS);
        return hbCap < c.maxStaleness ? uint32(hbCap) : c.maxStaleness;
    }
}
