// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMontionsBook} from "../interfaces/IMontionsBook.sol";
import {TickBitmap} from "../libs/TickBitmap.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {MontionsBookStorage} from "./MontionsBookStorage.sol";

/// @title MontionsBookEngine
/// @notice Order placement, price-time matching and cancellation for MontionsBook.
/// @dev Executed ONLY via `delegatecall` from `MontionsBook` (its `placeOrder`, `cancelOrder` and `cancelOrders`
///      stubs forward the original calldata unchanged), so every read and write below hits the Book's storage,
///      `msg.sender` is the Book's caller and events are emitted by the Book's address. Direct calls revert.
///      The code is the Book's original matching engine moved verbatim (types qualified, storage names prefixed);
///      semantics are those of docs/SPEC.md §4.3 and amendments A3/A4/A7. The matching loop makes no external calls.
contract MontionsBookEngine is MontionsBookStorage, ReentrancyGuard {
    using TickBitmap for uint128;

    address private immutable _self;

    /// @notice The engine was called directly instead of through the Book.
    error DirectCallNotAllowed();
    /// @dev Same selectors as the Book's errors of the same name.
    error MaxFillsTooHigh(uint16 maxFills);
    error Paused();

    constructor() {
        _self = address(this);
    }

    modifier onlyDelegated() {
        if (address(this) == _self) revert DirectCallNotAllowed();
        _;
    }

    /// @notice See `IMontionsBook.placeOrder` and `MontionsBook.placeOrder`.
    function placeOrder(IMontionsBook.PlaceParams calldata p)
        external
        onlyDelegated
        nonReentrant
        returns (uint64 orderId, uint64 filled, uint64 resting)
    {
        if (_paused) revert Paused();
        _prepareOrder(p);
        orderId = _recordIncoming(p);
        uint256 takerCollateralConsumed;
        (filled, resting, takerCollateralConsumed) = _matchOrder(p);
        resting = _finishIncoming(p, orderId, resting);
        _settleTakerFee(p, takerCollateralConsumed);
    }

    /// @notice See `IMontionsBook.cancelOrder`.
    function cancelOrder(uint64 orderId) external onlyDelegated nonReentrant {
        StoredOrder storage order = _orders[orderId];
        if (order.maker == address(0)) revert IMontionsBook.OrderNotOpen();
        if (order.maker != msg.sender) revert IMontionsBook.NotOrderOwner();
        if (!order.open) revert IMontionsBook.OrderNotOpen();
        _cancelResting(orderId);
    }

    /// @notice See `IMontionsBook.cancelOrders`.
    function cancelOrders(uint64[] calldata orderIds) external onlyDelegated nonReentrant {
        for (uint256 i; i < orderIds.length; ++i) {
            StoredOrder storage order = _orders[orderIds[i]];
            if (order.maker == address(0)) revert IMontionsBook.OrderNotOpen();
            if (order.maker != msg.sender) revert IMontionsBook.NotOrderOwner();
            if (!order.open) revert IMontionsBook.OrderNotOpen();
            _cancelResting(orderIds[i]);
        }
    }

    function _prepareOrder(IMontionsBook.PlaceParams calldata p) private {
        IMontionsBook.SeriesInfo storage info = _series[p.seriesId];
        if (info.status == IMontionsBook.Status.None) revert IMontionsBook.SeriesUnknown();
        if (info.status != IMontionsBook.Status.Open) revert IMontionsBook.SeriesNotOpen();
        if (block.timestamp >= info.expiry) revert IMontionsBook.Expired();
        if (p.tick == 0 || p.tick >= _TICKS) revert IMontionsBook.BadTick();
        if (p.qty == 0 || p.qty > _MAX_ORDER_QTY) revert IMontionsBook.BadQty();
        if (p.maxFills > _MAX_FILLS) revert MaxFillsTooHigh(p.maxFills);

        if (p.tif == IMontionsBook.TIF.POST_ONLY && _wouldCross(p.seriesId, p.side, p.tick)) {
            revert IMontionsBook.WouldCross();
        }

        uint256 escrow = _orderEscrow(p.side, p.tick, p.qty, p.fromHeld);
        uint256 feeReserve = p.fromHeld ? 0 : _feeFor(escrow);
        uint256 requiredCash = escrow + feeReserve;
        uint256 free = _cash[msg.sender];
        if (free < requiredCash) revert IMontionsBook.InsufficientCash();

        if (p.fromHeld) {
            uint256 tokenId = p.side == IMontionsBook.Side.Bid ? info.noId : info.yesId;
            if (_outcomeBalance(msg.sender, tokenId) < p.qty) revert IMontionsBook.InsufficientTokens();
            _transferOutcome(msg.sender, address(this), tokenId, p.qty);
        }
        if (requiredCash != 0) {
            unchecked {
                _cash[msg.sender] = free - requiredCash;
            }
            _lockedCash[msg.sender] += requiredCash;
        }
    }

    function _recordIncoming(IMontionsBook.PlaceParams calldata p) private returns (uint64 orderId) {
        orderId = ++_orderCount;
        _orders[orderId] = StoredOrder({
            maker: msg.sender,
            seriesId: p.seriesId,
            qty: p.qty,
            origQty: p.qty,
            placedAt: uint64(block.timestamp),
            prev: 0,
            next: 0,
            tick: p.tick,
            side: p.side,
            fromHeld: p.fromHeld,
            open: false
        });
        _userOrders[msg.sender].push(orderId);
        emit IMontionsBook.OrderPlaced(orderId, p.seriesId, msg.sender, p.side, p.tick, p.qty, p.fromHeld);
    }

    function _matchOrder(IMontionsBook.PlaceParams calldata p)
        private
        returns (uint64 filled, uint64 remaining, uint256 takerCollateralConsumed)
    {
        remaining = p.qty;
        // Lazy initialization avoids cap reads on orders that do not reach a pair-minting match.
        uint256 pairCapacity = type(uint256).max;
        uint16 maxFills = p.maxFills == 0 ? _DEFAULT_MAX_FILLS : p.maxFills;
        uint16 attempts;
        while (remaining != 0 && attempts < maxFills) {
            (uint8 makerTick, uint64 makerId) = _bestCrossingOrder(p.seriesId, p.side, p.tick);
            if (makerId == 0) break;

            StoredOrder storage maker = _orders[makerId];
            if (maker.maker == msg.sender) {
                _cancelResting(makerId);
                ++attempts;
                continue;
            }
            uint64 fillLimit = remaining;
            bool createsPair = !p.fromHeld && !maker.fromHeld;
            if (createsPair) {
                if (pairCapacity == type(uint256).max) {
                    uint256 currentPool = _pool[p.seriesId];
                    uint256 cap = _seriesPoolCap;
                    pairCapacity = currentPool >= cap ? 0 : (cap - currentPool) / _UNIT;
                }
                if (pairCapacity == 0) break;
                if (pairCapacity < fillLimit) fillLimit = uint64(pairCapacity);
            }
            uint64 fillQty = _matchCandidate(p, makerId, makerTick, fillLimit);
            remaining -= fillQty;
            filled += fillQty;
            takerCollateralConsumed += _takerCollateralConsumed(p, makerTick, fillQty);
            if (createsPair) pairCapacity -= fillQty;
            ++attempts;
        }
    }

    function _finishIncoming(IMontionsBook.PlaceParams calldata p, uint64 orderId, uint64 remaining)
        private
        returns (uint64 resting)
    {
        StoredOrder storage incoming = _orders[orderId];
        incoming.qty = remaining;
        if (remaining == 0) return 0;

        bool mayRest = p.tif == IMontionsBook.TIF.GTC || p.tif == IMontionsBook.TIF.POST_ONLY;
        bool stillCrosses = _wouldCross(p.seriesId, p.side, p.tick);
        if (mayRest && !stillCrosses) {
            incoming.open = true;
            _enqueue(orderId);
            return remaining;
        }

        _refundIncoming(p, remaining);
        incoming.qty = 0;
        incoming.open = false;
        emit IMontionsBook.OrderCancelled(orderId, p.seriesId, remaining);
        return 0;
    }

    function _executeFill(
        IMontionsBook.PlaceParams calldata p,
        uint64 makerId,
        uint64 qty,
        uint8 price,
        bool takerIsBuyer
    ) private {
        StoredOrder storage maker = _orders[makerId];
        uint256 premium = uint256(qty) * price * _TICK_UNIT;

        if (takerIsBuyer) {
            if (p.fromHeld) _executeCloseNoBid(p, maker, qty, price, premium);
            else _executeRegularBid(p, maker, qty, price, premium);
        } else if (maker.fromHeld) {
            if (p.fromHeld) _executeHeldAskAgainstCloseNo(p, maker, qty, premium);
            else _executeWriteAskAgainstCloseNo(p, maker, qty, price, premium);
        } else if (p.fromHeld) {
            _executeHeldAsk(p, maker, qty, premium);
        } else {
            _executeWriteAsk(p, maker, qty, price, premium);
        }
    }

    function _executeRegularBid(
        IMontionsBook.PlaceParams calldata p,
        StoredOrder storage maker,
        uint64 qty,
        uint8 price,
        uint256 premium
    ) private {
        uint256 reserved = uint256(qty) * p.tick * _TICK_UNIT;
        _lockedCash[msg.sender] -= reserved;
        _cash[msg.sender] += reserved - premium;

        if (maker.fromHeld) {
            _cash[maker.maker] += premium;
            _transferOutcome(address(this), msg.sender, _series[p.seriesId].yesId, qty);
        } else {
            _lockedCash[maker.maker] -= uint256(qty) * (_TICKS - price) * _TICK_UNIT;
            _pool[p.seriesId] += uint256(qty) * _UNIT;
            _mintOutcome(msg.sender, _series[p.seriesId].yesId, qty);
            _mintOutcome(maker.maker, _series[p.seriesId].noId, qty);
        }
    }

    /// @dev Close-NO pays the bid premium to a held-YES seller or creates and immediately
    ///      merges a written pair. In either case the escrowed NO and acquired YES are burned;
    ///      the pool and both supplies return to their pre-fill values.
    function _executeCloseNoBid(
        IMontionsBook.PlaceParams calldata p,
        StoredOrder storage maker,
        uint64 qty,
        uint8 price,
        uint256 premium
    ) private {
        IMontionsBook.SeriesInfo storage info = _series[p.seriesId];
        uint256 reserved = uint256(qty) * p.tick * _TICK_UNIT;
        uint256 payout = uint256(qty) * _UNIT;
        _lockedCash[msg.sender] -= reserved;
        _cash[msg.sender] += reserved - premium;

        if (maker.fromHeld) {
            _cash[maker.maker] += premium;
            _burnOutcome(address(this), info.yesId, qty);
        } else {
            _lockedCash[maker.maker] -= uint256(qty) * (_TICKS - price) * _TICK_UNIT;
            _pool[p.seriesId] += payout;
            _mintOutcome(msg.sender, info.yesId, qty);
            _mintOutcome(maker.maker, info.noId, qty);
            _burnOutcome(msg.sender, info.yesId, qty);
        }
        _burnOutcome(address(this), info.noId, qty);
        _pool[p.seriesId] -= payout;
        _cash[msg.sender] += payout;
    }

    function _executeHeldAsk(
        IMontionsBook.PlaceParams calldata p,
        StoredOrder storage maker,
        uint64 qty,
        uint256 premium
    ) private {
        _lockedCash[maker.maker] -= premium;
        _cash[msg.sender] += premium;
        _transferOutcome(address(this), maker.maker, _series[p.seriesId].yesId, qty);
    }

    function _executeWriteAsk(
        IMontionsBook.PlaceParams calldata p,
        StoredOrder storage maker,
        uint64 qty,
        uint8 price,
        uint256 premium
    ) private {
        _lockedCash[maker.maker] -= premium;
        uint256 reserved = uint256(qty) * (_TICKS - p.tick) * _TICK_UNIT;
        uint256 writeCollateral = uint256(qty) * (_TICKS - price) * _TICK_UNIT;
        _lockedCash[msg.sender] -= reserved;
        _cash[msg.sender] += reserved - writeCollateral;
        _pool[p.seriesId] += uint256(qty) * _UNIT;
        _mintOutcome(maker.maker, _series[p.seriesId].yesId, qty);
        _mintOutcome(msg.sender, _series[p.seriesId].noId, qty);
    }

    function _executeHeldAskAgainstCloseNo(
        IMontionsBook.PlaceParams calldata p,
        StoredOrder storage maker,
        uint64 qty,
        uint256 premium
    ) private {
        IMontionsBook.SeriesInfo storage info = _series[p.seriesId];
        uint256 payout = uint256(qty) * _UNIT;
        _lockedCash[maker.maker] -= premium;
        _cash[msg.sender] += premium;
        _burnOutcome(address(this), info.yesId, qty);
        _burnOutcome(address(this), info.noId, qty);
        _pool[p.seriesId] -= payout;
        _cash[maker.maker] += payout;
    }

    function _executeWriteAskAgainstCloseNo(
        IMontionsBook.PlaceParams calldata p,
        StoredOrder storage maker,
        uint64 qty,
        uint8 price,
        uint256 premium
    ) private {
        IMontionsBook.SeriesInfo storage info = _series[p.seriesId];
        uint256 payout = uint256(qty) * _UNIT;
        uint256 reserved = uint256(qty) * (_TICKS - p.tick) * _TICK_UNIT;
        uint256 writeCollateral = uint256(qty) * (_TICKS - price) * _TICK_UNIT;
        _lockedCash[maker.maker] -= premium;
        _lockedCash[msg.sender] -= reserved;
        _cash[msg.sender] += reserved - writeCollateral;
        _pool[p.seriesId] += payout;
        _mintOutcome(maker.maker, info.yesId, qty);
        _mintOutcome(msg.sender, info.noId, qty);
        _burnOutcome(maker.maker, info.yesId, qty);
        _burnOutcome(address(this), info.noId, qty);
        _pool[p.seriesId] -= payout;
        _cash[maker.maker] += payout;
    }

    function _matchCandidate(IMontionsBook.PlaceParams calldata p, uint64 makerId, uint8 makerTick, uint64 remaining)
        private
        returns (uint64 fillQty)
    {
        StoredOrder storage maker = _orders[makerId];
        fillQty = maker.qty < remaining ? maker.qty : remaining;
        bool takerIsBuyer = p.side == IMontionsBook.Side.Bid;
        address makerAddress = maker.maker;
        _executeFill(p, makerId, fillQty, makerTick, takerIsBuyer);
        _consumeResting(makerId, fillQty);
        _recordTrade(p.seriesId, makerTick, fillQty, takerIsBuyer);
        emit IMontionsBook.Trade(p.seriesId, makerId, makerAddress, msg.sender, makerTick, fillQty, takerIsBuyer);
    }

    function _takerCollateralConsumed(IMontionsBook.PlaceParams calldata p, uint8 price, uint64 qty)
        private
        pure
        returns (uint256)
    {
        uint256 perContract;
        if (p.side == IMontionsBook.Side.Bid) perContract = p.fromHeld ? _TICKS - price : price;
        else perContract = p.fromHeld ? price : _TICKS - price;
        return uint256(qty) * perContract * _TICK_UNIT;
    }

    function _settleTakerFee(IMontionsBook.PlaceParams calldata p, uint256 consumed) private {
        uint256 fee = _feeFor(consumed);
        if (p.fromHeld) {
            if (fee != 0) {
                uint256 free = _cash[msg.sender];
                if (free < fee) revert IMontionsBook.InsufficientCash();
                unchecked {
                    _cash[msg.sender] = free - fee;
                }
                _protocolFees += fee;
            }
            return;
        }

        uint256 reserve = _feeFor(_orderEscrow(p.side, p.tick, p.qty, false));
        if (reserve != 0) {
            _lockedCash[msg.sender] -= reserve;
            _cash[msg.sender] += reserve - fee;
        }
        _protocolFees += fee;
    }

    function _refundIncoming(IMontionsBook.PlaceParams calldata p, uint64 qty) private {
        uint256 amount = _orderEscrow(p.side, p.tick, qty, p.fromHeld);
        if (amount != 0) {
            _lockedCash[msg.sender] -= amount;
            _cash[msg.sender] += amount;
        }
        if (p.fromHeld) {
            uint256 tokenId =
                p.side == IMontionsBook.Side.Bid ? _series[p.seriesId].noId : _series[p.seriesId].yesId;
            _transferOutcome(address(this), msg.sender, tokenId, qty);
        }
    }

    function _cancelResting(uint64 orderId) private {
        StoredOrder storage order = _orders[orderId];
        uint64 qty = order.qty;
        uint256 amount = _orderEscrow(order.side, order.tick, qty, order.fromHeld);
        if (amount != 0) {
            _lockedCash[order.maker] -= amount;
            _cash[order.maker] += amount;
        }
        if (order.fromHeld) {
            IMontionsBook.SeriesInfo storage info = _series[order.seriesId];
            uint256 tokenId = order.side == IMontionsBook.Side.Bid ? info.noId : info.yesId;
            _transferOutcome(address(this), order.maker, tokenId, qty);
        }
        _removeFromLevel(orderId, qty);
        order.qty = 0;
        order.open = false;
        emit IMontionsBook.OrderCancelled(orderId, order.seriesId, qty);
    }

    function _consumeResting(uint64 orderId, uint64 qty) private {
        StoredOrder storage order = _orders[orderId];
        TickLevel storage level = _level(order.seriesId, order.side, order.tick);
        level.qty -= uint128(qty);
        order.qty -= qty;
        if (order.qty == 0) {
            _unlink(orderId, level);
            order.open = false;
        }
        if (level.qty == 0) _setOccupied(order.seriesId, order.side, order.tick, false);
    }

    function _removeFromLevel(uint64 orderId, uint64 qty) private {
        StoredOrder storage order = _orders[orderId];
        TickLevel storage level = _level(order.seriesId, order.side, order.tick);
        level.qty -= uint128(qty);
        _unlink(orderId, level);
        if (level.qty == 0) _setOccupied(order.seriesId, order.side, order.tick, false);
    }

    function _enqueue(uint64 orderId) private {
        StoredOrder storage order = _orders[orderId];
        TickLevel storage level = _level(order.seriesId, order.side, order.tick);
        if (level.qty == 0) _setOccupied(order.seriesId, order.side, order.tick, true);
        uint64 oldTail = level.tail;
        order.prev = oldTail;
        order.next = 0;
        if (oldTail == 0) level.head = orderId;
        else _orders[oldTail].next = orderId;
        level.tail = orderId;
        level.qty += uint128(order.qty);
    }

    function _unlink(uint64 orderId, TickLevel storage level) private {
        StoredOrder storage order = _orders[orderId];
        uint64 prev = order.prev;
        uint64 next = order.next;
        if (prev == 0) level.head = next;
        else _orders[prev].next = next;
        if (next == 0) level.tail = prev;
        else _orders[next].prev = prev;
        order.prev = 0;
        order.next = 0;
    }

    function _recordTrade(bytes32 seriesId, uint8 tick, uint64 qty, bool takerIsBuyer) private {
        uint8 index = _tradeNext[seriesId];
        _tradeRing[seriesId][index] =
            IMontionsBook.TradeView({ts: uint64(block.timestamp), tick: tick, qty: qty, takerIsBuyer: takerIsBuyer});
        _tradeNext[seriesId] = (index + 1) & (_TRADE_RING_SIZE - 1);
        if (_tradeCount[seriesId] < _TRADE_RING_SIZE) ++_tradeCount[seriesId];
        _lastTradeTick[seriesId] = tick;
        _volume[seriesId] += qty;
    }

    function _wouldCross(bytes32 seriesId, IMontionsBook.Side side, uint8 tick) private view returns (bool) {
        if (side == IMontionsBook.Side.Bid) {
            uint8 ask = _askBitmap[seriesId].lowestSetBit();
            return ask != 0 && ask <= tick;
        }
        uint8 bid = _bidBitmap[seriesId].highestSetBit();
        return bid != 0 && bid >= tick;
    }

    function _bestCrossingOrder(bytes32 seriesId, IMontionsBook.Side takerSide, uint8 limit)
        private
        view
        returns (uint8 tick, uint64 orderId)
    {
        if (takerSide == IMontionsBook.Side.Bid) {
            tick = _askBitmap[seriesId].lowestSetBit();
            if (tick != 0 && tick <= limit) orderId = _askLevels[seriesId][tick].head;
        } else {
            tick = _bidBitmap[seriesId].highestSetBit();
            if (tick != 0 && tick >= limit) orderId = _bidLevels[seriesId][tick].head;
        }
        if (orderId == 0) tick = 0;
    }

    function _orderEscrow(IMontionsBook.Side side, uint8 tick, uint64 qty, bool fromHeld)
        private
        pure
        returns (uint256)
    {
        if (fromHeld && side == IMontionsBook.Side.Ask) return 0;
        uint256 perContract = side == IMontionsBook.Side.Bid ? tick : _TICKS - tick;
        return uint256(qty) * perContract * _TICK_UNIT;
    }

    function _feeFor(uint256 collateralConsumed) private view returns (uint256) {
        uint16 bps = _takerFeeBps;
        if (bps == 0 || collateralConsumed == 0) return 0;
        return (collateralConsumed * bps + 9_999) / 10_000;
    }

    function _level(bytes32 seriesId, IMontionsBook.Side side, uint8 tick)
        private
        view
        returns (TickLevel storage level)
    {
        if (side == IMontionsBook.Side.Bid) return _bidLevels[seriesId][tick];
        return _askLevels[seriesId][tick];
    }

    function _setOccupied(bytes32 seriesId, IMontionsBook.Side side, uint8 tick, bool occupied) private {
        if (side == IMontionsBook.Side.Bid) {
            _bidBitmap[seriesId] = occupied ? _bidBitmap[seriesId].set(tick) : _bidBitmap[seriesId].unset(tick);
        } else {
            _askBitmap[seriesId] = occupied ? _askBitmap[seriesId].set(tick) : _askBitmap[seriesId].unset(tick);
        }
    }
}
