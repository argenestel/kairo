// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAggregatorProxy} from "../chainlink/IAggregatorV3.sol";

/// @title KeeperFeed
/// @notice Single-symbol AggregatorV3 / EACAggregatorProxy lookalike whose rounds are
///         written by a trusted keeper via `KeeperFeedHub`.
/// @dev DEMO ORACLE. Prices are reported by a trusted keeper from public market data
///      (Yahoo / Nasdaq / similar). Settlement through `ChainlinkSettlementResolver`
///      inherits that trust: the first keeper-reported round with `updatedAt >= expiry`
///      is the print. This is NOT a Chainlink Data Feed.
///
///      Round ids use Chainlink proxy encoding in a SINGLE phase:
///          roundId = (uint80(phaseId) << 64) | aggregatorRoundId
///      with `phaseId() == 1` forever and aggregator rounds 1, 2, 3, … contiguous.
///      That is the encoding `ChainlinkSettlementResolver` and the EVM keeper prove
///      against (`getRoundData(R)` and `getRoundData(R - 1)` in the current phase).
///
///      `startedAt == updatedAt == block.timestamp` of the hub push (on-chain report
///      time, not the Wall-Street `observedAt`). `answeredInRound == roundId`.
///
///      Upgrade path: replace these feeds with Pyth equity feeds (Hermes API key) or
///      Chainlink Data Streams (Streams API key) and point `ChainlinkOracle.setFeed`
///      at the new proxies — `setFeed` is one-time per asset, so a new asset id / new
///      oracle is required for a live market.
contract KeeperFeed is IAggregatorProxy {
    uint8 public constant override decimals = 8;
    uint256 public constant override version = 1;
    uint16 public constant PHASE_ID = 1;

    /// @notice Hub allowed to call `report`. Immutable; a new feed is a new address.
    address public immutable hub;
    /// @notice Ticker, e.g. "TSLA".
    string public symbol;
    /// @notice e.g. "TSLA / USD (keeper-reported)".
    string public override description;

    struct Round {
        int256 answer;
        uint64 startedAt;
        uint64 updatedAt;
        uint64 observedAt;
    }

    mapping(uint64 aggregatorRoundId => Round round) internal _rounds;
    uint64 public latestAggRound;

    error ZeroAddress();
    error EmptySymbol();
    error NotHub();
    error InvalidPrice(int256 answer);
    error InvalidObservedAt(uint64 observedAt);

    /// @notice Chainlink-compatible: new answer for `roundId` at `updatedAt`.
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    /// @notice Chainlink-compatible: round `roundId` started by `startedBy` at `startedAt`.
    event NewRound(uint256 indexed roundId, address indexed startedBy, uint256 startedAt);

    constructor(address hub_, string memory symbol_) {
        if (hub_ == address(0)) revert ZeroAddress();
        if (bytes(symbol_).length == 0) revert EmptySymbol();
        hub = hub_;
        symbol = symbol_;
        description = string.concat(symbol_, " / USD (keeper-reported)");
    }

    modifier onlyHub() {
        if (msg.sender != hub) revert NotHub();
        _;
    }

    /// @notice Append a round. `startedAt` and `updatedAt` are `block.timestamp`.
    /// @param answer Price in 8-decimal USD (must be > 0).
    /// @param observedAt Wall-clock observation time from the keeper (must be > 0 and not in the future).
    function report(int256 answer, uint64 observedAt) external onlyHub returns (uint80 roundId) {
        if (answer <= 0) revert InvalidPrice(answer);
        if (observedAt == 0 || observedAt > block.timestamp) revert InvalidObservedAt(observedAt);
        uint64 agg = ++latestAggRound;
        uint64 ts = uint64(block.timestamp);
        _rounds[agg] = Round({answer: answer, startedAt: ts, updatedAt: ts, observedAt: observedAt});
        roundId = _proxyId(agg);
        emit AnswerUpdated(answer, roundId, ts);
        emit NewRound(roundId, msg.sender, ts);
    }

    /// @notice Latest round. Zeros if the keeper has never pushed.
    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint64 agg = latestAggRound;
        if (agg == 0) return (0, 0, 0, 0, 0);
        Round memory r = _rounds[agg];
        roundId = _proxyId(agg);
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    /// @notice Round lookup. Unknown / other-phase rounds return zeros (OCR2 empty-round
    ///         behaviour) so `ChainlinkSettlementResolver.findRound` can search without reverting.
    function getRoundData(uint80 roundId)
        external
        view
        override
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint16 phase = uint16(roundId >> 64);
        uint64 agg = uint64(roundId);
        if (phase != PHASE_ID || agg == 0 || agg > latestAggRound) {
            return (roundId, 0, 0, 0, roundId);
        }
        Round memory r = _rounds[agg];
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    function phaseId() external pure override returns (uint16) {
        return PHASE_ID;
    }

    function aggregator() external view override returns (address) {
        return address(this);
    }

    function phaseAggregators(uint16 phaseId_) external view override returns (address) {
        return phaseId_ == PHASE_ID ? address(this) : address(0);
    }

    /// @notice Latest answer plus the keeper's observation time (0s if no round yet).
    function latestObservation()
        external
        view
        returns (int256 answer, uint64 observedAt, uint64 updatedAt, uint80 roundId)
    {
        uint64 agg = latestAggRound;
        if (agg == 0) return (0, 0, 0, 0);
        Round memory r = _rounds[agg];
        return (r.answer, r.observedAt, r.updatedAt, _proxyId(agg));
    }

    /// @notice Observation time stored for aggregator round `aggRoundId` (0 if unknown).
    function observedAtOf(uint64 aggRoundId) external view returns (uint64) {
        return _rounds[aggRoundId].observedAt;
    }

    function _proxyId(uint64 agg) private pure returns (uint80) {
        return (uint80(PHASE_ID) << 64) | uint80(agg);
    }
}
