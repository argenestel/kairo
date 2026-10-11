// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockChainlinkAggregator
/// @notice MOCK/TEST ONLY phase aggregator: contiguous rounds 1..n with settable answers and timestamps.
/// @dev Unknown rounds return zeros (OCR2 behaviour) unless `revertOnMissing` is set (legacy "No data present").
contract MockChainlinkAggregator {
    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    mapping(uint64 roundId => Round round) public rounds;
    uint64 public latestRound;
    bool public revertOnMissing;

    error NoDataPresent();

    function setRevertOnMissing(bool v) external {
        revertOnMissing = v;
    }

    /// @notice Append a round with an explicit `updatedAt` (timestamps should be non-decreasing).
    function push(int256 answer, uint256 updatedAt) public returns (uint64 roundId) {
        roundId = ++latestRound;
        rounds[roundId] = Round({answer: answer, startedAt: updatedAt, updatedAt: updatedAt});
    }

    /// @notice Append a round stamped with the current block time.
    function pushNow(int256 answer) external returns (uint64) {
        return push(answer, block.timestamp);
    }

    /// @notice Overwrite a round (tests of incomplete rounds etc.).
    function setRound(uint64 roundId, int256 answer, uint256 updatedAt) external {
        rounds[roundId] = Round({answer: answer, startedAt: updatedAt, updatedAt: updatedAt});
        if (roundId > latestRound) latestRound = roundId;
    }

    function getRoundData(uint80 roundId) public view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[uint64(roundId)];
        if (r.updatedAt == 0 && revertOnMissing) revert NoDataPresent();
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return getRoundData(latestRound);
    }
}

/// @title MockChainlinkProxy
/// @notice MOCK/TEST ONLY EACAggregatorProxy: phase ids, `phaseAggregators`, proxy round ids `(phase << 64) | round`.
contract MockChainlinkProxy {
    uint8 public decimals;
    string public description;
    uint256 public constant version = 4;
    uint16 public phaseId;
    mapping(uint16 phase => MockChainlinkAggregator aggregator) public phaseAggregators;

    constructor(uint8 decimals_, string memory description_) {
        decimals = decimals_;
        description = description_;
        _newPhase();
    }

    /// @notice Point the proxy at a fresh aggregator (new phase) and return it.
    function newPhase() external returns (MockChainlinkAggregator) {
        return _newPhase();
    }

    function setDecimals(uint8 d) external {
        decimals = d;
    }

    function aggregator() external view returns (address) {
        return address(phaseAggregators[phaseId]);
    }

    /// @notice Convenience: append a round to the current phase aggregator.
    function push(int256 answer, uint256 updatedAt) external returns (uint80) {
        uint64 r = phaseAggregators[phaseId].push(answer, updatedAt);
        return (uint80(phaseId) << 64) | r;
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        uint16 phase = uint16(roundId >> 64);
        MockChainlinkAggregator agg = phaseAggregators[phase];
        if (address(agg) == address(0)) return (roundId, 0, 0, 0, roundId);
        (, int256 answer, uint256 startedAt, uint256 updatedAt,) = agg.getRoundData(uint64(roundId));
        return (roundId, answer, startedAt, updatedAt, roundId);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        MockChainlinkAggregator agg = phaseAggregators[phaseId];
        (uint80 r, int256 answer, uint256 startedAt, uint256 updatedAt,) = agg.latestRoundData();
        uint80 id = (uint80(phaseId) << 64) | uint64(r);
        return (id, answer, startedAt, updatedAt, id);
    }

    function _newPhase() private returns (MockChainlinkAggregator agg) {
        agg = new MockChainlinkAggregator();
        phaseAggregators[++phaseId] = agg;
    }
}
