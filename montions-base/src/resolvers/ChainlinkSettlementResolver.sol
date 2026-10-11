// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IResolver} from "../interfaces/IResolver.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {IAggregatorProxy, IAggregatorV3} from "../oracle/chainlink/IAggregatorV3.sol";
import {ChainlinkOracle} from "../oracle/chainlink/ChainlinkOracle.sol";
import {LibString} from "solady/utils/LibString.sol";
import {ResolverFormat} from "./ResolverFormat.sol";

/// @title ChainlinkSettlementResolver
/// @notice Settles price-threshold series on the FIRST Chainlink round whose `updatedAt >= expiry`.
/// @dev data = abi.encode(address oracle, bytes32 assetId, uint256 strikeWad, bool above, uint32 maxDelay)
///      (the shared price-series layout, so `Quoter.fair` and `MakerVault` price these series unchanged).
///      `maxDelay` must equal the oracle's one-time `settleDelayOf(assetId)`, so every (asset, strike, expiry)
///      has exactly one canonical series.
///
///      Settlement round selection (nobody can pick the timestamp or the round):
///        Within one aggregator phase, Chainlink round ids are contiguous and `updatedAt` (the block time of the
///        report's transmission) never decreases. So exactly one round R satisfies
///            updatedAt(R) >= expiry  AND  updatedAt(R - 1) < expiry.
///        `record(feed, expiry, hint)` checks both conditions onchain and stores R's answer for (feed, expiry).
///        Any caller can record; a wrong hint simply reverts. `findRound` / `recordFirstRound` compute R onchain.
///      Phases: the hint must be in the proxy's CURRENT phase (rounds of an older phase may keep being written
///        after an aggregator upgrade, which would break uniqueness). The first round of a phase (> 1) has no
///        provable predecessor through the proxy and is rejected. If the previous phase aggregator's latest
///        round has `updatedAt >= expiry`, the proxy was upgraded after expiry: recording fail-closes
///        (`PhaseChangedAfterExpiry`) rather than accepting the new aggregator's pre-seeded history.
///        In all of those cases the series is never recorded and the Book voids it 50/50 after VOID_GRACE
///        (2 days). Phase changes are rare, owner-of-Chainlink events. We do NOT accept a new-phase history
///        that was not the live aggregator at expiry.
///      Validity: answer <= 0, decimals > 18, or `updatedAt > expiry + maxDelay` (feed stalled through expiry)
///        make `resolve` report not-ready forever, so the Book voids after VOID_GRACE.
///      This resolver has NO owner and no admin functions. Residual trust: Chainlink's oracle network and the
///      feed proxy's owner (who could point the proxy at a new aggregator), and the ChainlinkOracle owner's
///      one-time feed registration.
contract ChainlinkSettlementResolver is IResolver {
    uint256 private constant DATA_LENGTH = 160;

    struct Settlement {
        uint80 roundId;
        uint64 updatedAt;
        uint8 decimals;
        bool recorded;
        int256 answer;
    }

    ChainlinkOracle public immutable oracle;
    mapping(address feed => mapping(uint64 expiry => Settlement settlement)) internal _settlements;

    error ZeroAddress();
    error InvalidData();
    error InvalidStrike();
    error InvalidExpiry(uint64 expiry);
    error InvalidMaxDelay(uint32 maxDelay);
    error UntrustedOracle();
    error FeedUnhealthy(bytes32 assetId);
    error UnknownFeed(address feed);
    error NotExpired(uint64 expiry);
    error AlreadyRecorded(address feed, uint64 expiry);
    error NotCurrentPhase(uint16 hintPhase, uint16 currentPhase);
    error FirstRoundOfPhase(uint80 roundId);
    error RoundIncomplete(uint80 roundId);
    error InvalidRound(uint80 roundId, uint80 answeredInRound);
    error RoundBeforeExpiry(uint80 roundId, uint256 updatedAt);
    error RoundInFuture(uint80 roundId, uint256 updatedAt);
    error RoundTimestampOverflow(uint80 roundId, uint256 updatedAt);
    error NotFirstRound(uint80 roundId, uint256 previousUpdatedAt);
    error RoundNotFound(address feed, uint64 expiry);
    error PhaseChangedAfterExpiry(uint16 newPhase, uint256 previousPhaseLatest);
    error OffGridStrike(uint256 strikeWad, uint256 stepWad);
    error StrikeOutOfBand(uint256 strikeWad, uint256 spotWad);

    event RoundRecorded(
        address indexed feed,
        uint64 indexed expiry,
        uint80 roundId,
        int256 answer,
        uint256 updatedAt,
        uint8 decimals,
        address recorder
    );

    /// @param oracle_ The single trusted ChainlinkOracle (A1: series naming another oracle are rejected).
    constructor(address oracle_) {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = ChainlinkOracle(oracle_);
    }

    // ───────────────────────── data layout ─────────────────────────

    /// @notice ABI-encode resolver data using the shared price-series layout.
    function encode(address oracle_, bytes32 assetId, uint256 strikeWad, bool above, uint32 maxDelay)
        external
        pure
        returns (bytes memory)
    {
        return abi.encode(oracle_, assetId, strikeWad, above, maxDelay);
    }

    /// @notice Decode the shared price-series ABI layout.
    function decode(bytes calldata data)
        public
        pure
        returns (address oracle_, bytes32 assetId, uint256 strikeWad, bool above, uint32 maxDelay)
    {
        if (data.length != DATA_LENGTH) revert InvalidData();
        return abi.decode(data, (address, bytes32, uint256, bool, uint32));
    }

    // ───────────────────────── IResolver ─────────────────────────

    /// @inheritdoc IResolver
    /// @dev Requires the trusted oracle, a registered and currently healthy feed, strike > 0, a future expiry and
    ///      `maxDelay == oracle.settleDelayOf(assetId)`. Ladder assets (set via `setMarketPolicy`) must also sit on
    ///      the canonical `k * strikeStep` grid and within seven steps of the current spot, so permissionless
    ///      `createSeries` cannot open stables/off-grid junk the vault would then quote.
    function validate(bytes calldata data, uint64 expiry) external view override {
        (address oracle_, bytes32 assetId, uint256 strikeWad,, uint32 maxDelay) = decode(data);
        if (oracle_ != address(oracle)) revert UntrustedOracle();
        if (strikeWad == 0) revert InvalidStrike();
        if (uint256(expiry) <= block.timestamp) revert InvalidExpiry(expiry);
        uint32 settleDelay = oracle.settleDelayOf(assetId);
        if (settleDelay == 0) revert IPriceOracle.UnknownAsset(assetId);
        if (maxDelay != settleDelay) revert InvalidMaxDelay(maxDelay);
        if (!oracle.isHealthy(assetId)) revert FeedUnhealthy(assetId);
        _validateLadder(assetId, strikeWad);
    }

    /// @inheritdoc IResolver
    function resolve(bytes calldata data, uint64 expiry) external view override returns (bool ready, bool yes) {
        if (block.timestamp <= expiry || data.length != DATA_LENGTH) return (false, false);
        (address oracle_, bytes32 assetId, uint256 strikeWad, bool above, uint32 maxDelay) = decode(data);
        if (oracle_ != address(oracle)) return (false, false);
        address feed = oracle.feedOf(assetId);
        if (feed == address(0)) return (false, false);
        Settlement memory s = _settlements[feed][expiry];
        if (!s.recorded || s.answer <= 0 || s.decimals > 18) return (false, false);
        if (uint256(s.updatedAt) > uint256(expiry) + maxDelay) return (false, false);
        uint256 priceWad = uint256(s.answer) * 10 ** (18 - uint256(s.decimals));
        return (true, above ? priceWad >= strikeWad : priceWad < strikeWad);
    }

    /// @inheritdoc IResolver
    /// @notice e.g. "ETH >= $2500.00 at 2026-10-16 16:00 UTC (first Chainlink round at/after expiry, max 3600s)".
    function describe(bytes calldata data, uint64 expiry) external view override returns (string memory) {
        (, bytes32 assetId, uint256 strikeWad, bool above, uint32 maxDelay) = decode(data);
        string memory symbol = oracle.symbolOf(assetId);
        if (bytes(symbol).length == 0) symbol = LibString.toHexString(uint256(assetId), 32);
        string memory quote = oracle.quoteOf(assetId);
        string memory strike = ResolverFormat.usd(strikeWad);
        if (bytes(quote).length != 0 && keccak256(bytes(quote)) != keccak256("USD")) {
            strike = string.concat(LibString.slice(strike, 1), " ", quote);
        }
        return string.concat(
            symbol,
            above ? " >= " : " < ",
            strike,
            " at ",
            ResolverFormat.utc(expiry),
            " (first Chainlink round at/after expiry, max ",
            LibString.toString(maxDelay),
            "s)"
        );
    }

    // ───────────────────────── recording ─────────────────────────

    /// @notice Record the first round of `feed` with `updatedAt >= expiry`, proven by `roundIdHint`.
    /// @dev Permissionless and idempotent per (feed, expiry): the first valid record is final. A wrong hint
    ///      reverts (too early, not the first round, another phase, first round of a phase, incomplete round).
    /// @param feed A Chainlink proxy registered in the trusted oracle.
    /// @param expiry Series expiry (unix seconds); must be in the past.
    /// @param roundIdHint Proxy round id `(phaseId << 64) | aggregatorRoundId` of the claimed first round.
    function record(address feed, uint64 expiry, uint80 roundIdHint) public returns (int256 answer, uint256 updatedAt) {
        if (block.timestamp <= expiry) revert NotExpired(expiry);
        if (oracle.assetOfFeed(feed) == bytes32(0)) revert UnknownFeed(feed);
        if (_settlements[feed][expiry].recorded) revert AlreadyRecorded(feed, expiry);
        IAggregatorProxy proxy = IAggregatorProxy(feed);

        if (roundIdHint == 0) revert RoundIncomplete(roundIdHint);
        uint16 phase = uint16(roundIdHint >> 64);
        uint64 aggRound = uint64(roundIdHint);
        uint16 current = proxy.phaseId();
        if (phase != current) revert NotCurrentPhase(phase, current);
        if (aggRound == 0) revert RoundIncomplete(roundIdHint);
        _revertIfPhaseChangedAfterExpiry(proxy, current, expiry);

        uint80 rid;
        uint80 answeredInRound;
        (rid, answer,, updatedAt, answeredInRound) = proxy.getRoundData(roundIdHint);
        if (rid != roundIdHint || updatedAt == 0) revert RoundIncomplete(roundIdHint);
        if (answeredInRound < roundIdHint) revert InvalidRound(roundIdHint, answeredInRound);
        if (updatedAt > block.timestamp) revert RoundInFuture(roundIdHint, updatedAt);
        if (updatedAt > type(uint64).max) revert RoundTimestampOverflow(roundIdHint, updatedAt);
        if (updatedAt < expiry) revert RoundBeforeExpiry(roundIdHint, updatedAt);

        if (aggRound > 1) {
            uint80 previousRoundId;
            uint80 previousAnsweredInRound;
            uint256 prevUpdatedAt;
            (previousRoundId,,, prevUpdatedAt, previousAnsweredInRound) = proxy.getRoundData(roundIdHint - 1);
            if (previousRoundId != roundIdHint - 1 || prevUpdatedAt == 0) {
                revert RoundIncomplete(roundIdHint - 1);
            }
            if (previousAnsweredInRound < roundIdHint - 1) {
                revert InvalidRound(roundIdHint - 1, previousAnsweredInRound);
            }
            if (prevUpdatedAt >= expiry) revert NotFirstRound(roundIdHint, prevUpdatedAt);
        } else if (phase > 1) {
            // No provable predecessor through the proxy; see contract NatSpec (the series voids after VOID_GRACE).
            revert FirstRoundOfPhase(roundIdHint);
        }

        uint8 dec = proxy.decimals();
        _settlements[feed][expiry] = Settlement({
            roundId: roundIdHint, updatedAt: uint64(updatedAt), decimals: dec, recorded: true, answer: answer
        });
        emit RoundRecorded(feed, expiry, roundIdHint, answer, updatedAt, dec, msg.sender);
    }

    /// @notice Find the settlement round onchain and record it (no hint needed). Same rules as `record`.
    function recordFirstRound(address feed, uint64 expiry) external returns (int256 answer, uint256 updatedAt) {
        (uint80 roundId, bool found) = findRound(feed, expiry);
        if (!found) revert RoundNotFound(feed, expiry);
        return record(feed, expiry, roundId);
    }

    /// @notice Record by asset id instead of feed address (convenience for keepers and UIs).
    function recordAsset(bytes32 assetId, uint64 expiry) external returns (int256 answer, uint256 updatedAt) {
        address feed = oracle.feedOf(assetId);
        if (feed == address(0)) revert IPriceOracle.UnknownAsset(assetId);
        (uint80 roundId, bool found) = findRound(feed, expiry);
        if (!found) revert RoundNotFound(feed, expiry);
        return record(feed, expiry, roundId);
    }

    /// @notice Locate the first round of the proxy's current phase with `updatedAt >= expiry`.
    /// @dev Galloping search back from the latest round, then binary search; O(log n) `getRoundData` calls.
    ///      `found == false` when no such round exists yet, the candidate is the first round of a phase > 1
    ///      (unrecordable, see NatSpec), or the current phase aggregator was not live at expiry.
    ///      The result is a pure function of Chainlink's history: a hint, not a choice.
    function findRound(address feed, uint64 expiry) public view returns (uint80 roundId, bool found) {
        IAggregatorProxy proxy = IAggregatorProxy(feed);
        uint16 phase = proxy.phaseId();
        if (phase == 0) return (0, false);
        if (_phaseChangedAfterExpiry(proxy, phase, expiry)) return (0, false);
        (bool latestOk, uint80 latestId, uint256 latestUpdatedAt) = _latestRound(proxy);
        if (!latestOk || latestId == 0 || uint16(latestId >> 64) != phase || latestUpdatedAt < expiry) {
            return (0, false);
        }
        if (latestUpdatedAt > block.timestamp) return (0, false);
        uint80 base = uint80(phase) << 64;
        uint64 hi = uint64(latestId); // invariant: updatedAt(hi) >= expiry
        if (hi == 0) return (0, false);
        (uint64 candidate, bool searchOk) = _searchPhase(proxy, base, hi, expiry);
        if (!searchOk || !_candidateIsFirst(proxy, base, candidate, expiry)) return (0, false);
        return (base | candidate, true);
    }

    function _latestRound(IAggregatorProxy proxy) private view returns (bool ok, uint80 roundId, uint256 updatedAt) {
        uint80 answeredInRound;
        (ok, roundId,, updatedAt, answeredInRound) = _latestRoundData(proxy);
        if (!ok || roundId == 0 || answeredInRound < roundId) return (false, roundId, updatedAt);
        return (true, roundId, updatedAt);
    }

    function _searchPhase(IAggregatorProxy proxy, uint80 base, uint64 hi, uint64 expiry)
        private
        view
        returns (uint64 candidate, bool ok)
    {
        uint64 lo;
        uint64 step = 1;
        while (true) {
            if (hi <= step) break;
            uint64 probe = hi - step;
            (bool probeOk,, uint256 t) = _roundUpdatedAt(proxy, base | probe);
            if (!probeOk) return (0, false);
            if (t < expiry) {
                lo = probe;
                break;
            }
            hi = probe;
            if (step < 1 << 32) step <<= 1;
        }
        while (hi - lo > 1) {
            uint64 mid = lo + (hi - lo) / 2;
            (bool midOk,, uint256 t) = _roundUpdatedAt(proxy, base | mid);
            if (!midOk) return (0, false);
            if (t < expiry) lo = mid;
            else hi = mid;
        }
        return (hi, true);
    }

    function _candidateIsFirst(IAggregatorProxy proxy, uint80 base, uint64 candidate, uint64 expiry)
        private
        view
        returns (bool)
    {
        (bool candidateOk,, uint256 candidateUpdatedAt) = _roundUpdatedAt(proxy, base | candidate);
        if (!candidateOk || candidateUpdatedAt < expiry || candidateUpdatedAt > block.timestamp) return false;
        if (candidate == 1) return uint16(base >> 64) == 1;
        (bool predecessorOk,, uint256 predecessorUpdatedAt) = _roundUpdatedAt(proxy, base | (candidate - 1));
        return predecessorOk && predecessorUpdatedAt < expiry;
    }

    function _latestRoundData(IAggregatorProxy proxy)
        private
        view
        returns (bool ok, uint80 roundId, int256 answer, uint256 updatedAt, uint80 answeredInRound)
    {
        try proxy.latestRoundData() returns (
            uint80 returnedRoundId,
            int256 returnedAnswer,
            uint256,
            uint256 returnedUpdatedAt,
            uint80 returnedAnsweredInRound
        ) {
            return (true, returnedRoundId, returnedAnswer, returnedUpdatedAt, returnedAnsweredInRound);
        } catch {
            return (false, 0, 0, 0, 0);
        }
    }

    function _roundUpdatedAt(IAggregatorProxy proxy, uint80 roundId)
        private
        view
        returns (bool ok, uint80 returnedRoundId, uint256 updatedAt)
    {
        try proxy.getRoundData(roundId) returns (
            uint80 returnedId, int256, uint256, uint256 returnedUpdatedAt, uint80 returnedAnsweredInRound
        ) {
            if (returnedId != roundId || returnedUpdatedAt == 0 || returnedAnsweredInRound < returnedId) {
                return (false, returnedId, returnedUpdatedAt);
            }
            return (true, returnedId, returnedUpdatedAt);
        } catch {
            return (false, 0, 0);
        }
    }

    function _validateLadder(bytes32 assetId, uint256 strikeWad) private view {
        if (!oracle.isLadder(assetId)) return;
        uint256 step = oracle.strikeStepOf(assetId);
        if (step == 0 || strikeWad % step != 0) revert OffGridStrike(strikeWad, step);
        (uint256 spot,) = oracle.latestPrice(assetId);
        // 7-strike window is ±3 steps around a coarse-aligned center (4× step). Spot can sit almost
        // 4 steps above that center, so the far wing is up to 7 steps from spot.
        uint256 maxDist = step * 7;
        if (strikeWad + maxDist < spot || spot + maxDist < strikeWad) {
            revert StrikeOutOfBand(strikeWad, spot);
        }
    }

    function _revertIfPhaseChangedAfterExpiry(IAggregatorProxy proxy, uint16 phase, uint64 expiry) private view {
        (bool changed, uint256 prevTs) = _previousPhaseLatest(proxy, phase);
        if (changed && prevTs >= expiry) revert PhaseChangedAfterExpiry(phase, prevTs);
        if (phase > 1 && !changed) revert PhaseChangedAfterExpiry(phase, 0);
    }

    function _phaseChangedAfterExpiry(IAggregatorProxy proxy, uint16 phase, uint64 expiry) private view returns (bool) {
        (bool ok, uint256 prevTs) = _previousPhaseLatest(proxy, phase);
        if (phase <= 1) return false;
        if (!ok) return true; // fail-closed: cannot prove the previous aggregator was dead at expiry
        return prevTs >= expiry;
    }

    function _previousPhaseLatest(IAggregatorProxy proxy, uint16 phase) private view returns (bool ok, uint256 updatedAt) {
        if (phase <= 1) return (false, 0);
        address prevAgg = proxy.phaseAggregators(phase - 1);
        if (prevAgg == address(0) || prevAgg.code.length == 0) return (false, 0);
        try IAggregatorV3(prevAgg).latestRoundData() returns (uint80, int256, uint256, uint256 ts, uint80) {
            return (true, ts);
        } catch {
            return (false, 0);
        }
    }

    // ───────────────────────── views ─────────────────────────

    /// @notice Stored settlement for (feed, expiry).
    function settlement(address feed, uint64 expiry) external view returns (Settlement memory) {
        return _settlements[feed][expiry];
    }

    /// @notice Whether (feed, expiry) has been recorded.
    function isRecorded(address feed, uint64 expiry) external view returns (bool) {
        return _settlements[feed][expiry].recorded;
    }

    /// @notice Recorded settlement for an asset: price in WAD (0 if invalid or not recorded).
    function settlementOf(bytes32 assetId, uint64 expiry)
        external
        view
        returns (bool recorded, uint256 priceWad, uint80 roundId, uint64 updatedAt)
    {
        address feed = oracle.feedOf(assetId);
        if (feed == address(0)) return (false, 0, 0, 0);
        Settlement memory s = _settlements[feed][expiry];
        if (s.recorded) {
            (bool valid, uint256 scaled) = _scale(s.answer, s.decimals);
            if (valid) priceWad = scaled;
        }
        return (s.recorded, priceWad, s.roundId, s.updatedAt);
    }

    function _scale(int256 answer, uint8 decimals_) private pure returns (bool valid, uint256 priceWad) {
        if (answer <= 0 || decimals_ > 18) return (false, 0);
        uint256 multiplier = 10 ** (18 - uint256(decimals_));
        uint256 raw = uint256(answer);
        if (raw > type(uint256).max / multiplier) return (false, 0);
        return (true, raw * multiplier);
    }
}
