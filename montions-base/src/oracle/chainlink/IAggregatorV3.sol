// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Chainlink AggregatorV3Interface (read side).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Chainlink EACAggregatorProxy extras. Proxy round ids are `(uint80(phaseId) << 64) | aggregatorRoundId`;
///         `getRoundData` on the proxy routes to `phaseAggregators(phaseId)`.
interface IAggregatorProxy is IAggregatorV3 {
    function phaseId() external view returns (uint16);
    function phaseAggregators(uint16 phaseId) external view returns (address);
    function aggregator() external view returns (address);
}
