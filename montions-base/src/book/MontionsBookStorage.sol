// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMontionsBook} from "../interfaces/IMontionsBook.sol";
import {OutcomeToken1155} from "../libs/OutcomeToken1155.sol";

/// @title MontionsBookStorage
/// @notice Single source of truth for the MontionsBook storage layout.
/// @dev Base Sepolia (and every chain with the EIP-170 24 KB code limit) cannot hold the whole Book in one
///      contract, so the Book is split in two pieces that run against ONE storage:
///        - `MontionsBook` (deployed at the public address): custody, series, settlement, outcome tokens, views.
///        - `MontionsBookEngine` (deployed by the Book's constructor): order placement, matching and cancellation,
///          reached only through `delegatecall` from the Book's `placeOrder` / `cancelOrder` / `cancelOrders` stubs.
///      Both inherit this contract and declare NO state variables of their own, so their layouts are identical by
///      construction. Solady's `Ownable` and `ReentrancyGuard` use fixed slots, which are shared the same way, so a
///      single reentrancy lock covers every entry point of both pieces.
abstract contract MontionsBookStorage is OutcomeToken1155 {
    uint256 internal constant _UNIT = 1_000_000;
    uint256 internal constant _TICK_UNIT = 10_000;
    uint256 internal constant _TICKS = 100;
    uint16 internal constant _DEFAULT_MAX_FILLS = 32;
    uint16 internal constant _MAX_FILLS = 256;
    uint64 internal constant _MAX_ORDER_QTY = (uint64(1) << 40) - 1;
    uint8 internal constant _TRADE_RING_SIZE = 64;

    struct StoredOrder {
        address maker;
        bytes32 seriesId;
        uint64 qty;
        uint64 origQty;
        uint64 placedAt;
        uint64 prev;
        uint64 next;
        uint8 tick;
        IMontionsBook.Side side;
        bool fromHeld;
        bool open;
    }

    struct TickLevel {
        uint64 head;
        uint64 tail;
        uint128 qty;
    }

    /// @dev Taker fee in basis points, capped at 100.
    uint16 internal _takerFeeBps;
    /// @dev Accrued fee collateral awaiting withdrawal.
    uint256 internal _protocolFees;
    /// @dev Destination used by permissionless fee withdrawal.
    address internal _feeRecipient;
    /// @dev True when operations that add new risk are paused.
    bool internal _paused;
    /// @dev Maximum collateral tracked by the Book. Lowering below usage only blocks new deposits.
    uint256 internal _collateralCap = type(uint256).max;
    /// @dev Maximum collateral pool for any one series. Lowering below usage only blocks new pair risk.
    uint256 internal _seriesPoolCap = type(uint256).max;
    /// @dev Running sum of user cash, locked cash, series pools, and protocol fees.
    uint256 internal _totalCollateral;

    mapping(address user => uint256 amount) internal _cash;
    mapping(address user => uint256 amount) internal _lockedCash;
    mapping(address resolver => bool allowed) internal _resolverAllowed;
    mapping(bytes32 seriesId => uint256 amount) internal _pool;

    mapping(bytes32 seriesId => IMontionsBook.SeriesInfo info) internal _series;
    bytes32[] internal _seriesList;

    mapping(uint64 orderId => StoredOrder order) internal _orders;
    mapping(address user => uint64[] ids) internal _userOrders;
    mapping(bytes32 seriesId => mapping(uint8 tick => TickLevel level)) internal _bidLevels;
    mapping(bytes32 seriesId => mapping(uint8 tick => TickLevel level)) internal _askLevels;
    mapping(bytes32 seriesId => uint128 bitmap) internal _bidBitmap;
    mapping(bytes32 seriesId => uint128 bitmap) internal _askBitmap;
    /// @dev Highest order id ever assigned; ids start at one.
    uint64 internal _orderCount;

    mapping(bytes32 seriesId => IMontionsBook.TradeView[64] trades) internal _tradeRing;
    mapping(bytes32 seriesId => uint8 nextIndex) internal _tradeNext;
    mapping(bytes32 seriesId => uint8 count) internal _tradeCount;
    mapping(bytes32 seriesId => uint8 tick) internal _lastTradeTick;
    mapping(bytes32 seriesId => uint256 contractsTraded) internal _volume;
}
