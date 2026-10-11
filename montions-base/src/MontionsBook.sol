// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMontionsBook} from "./interfaces/IMontionsBook.sol";
import {IResolver} from "./interfaces/IResolver.sol";
import {TickBitmap} from "./libs/TickBitmap.sol";
import {MontionsBookStorage} from "./book/MontionsBookStorage.sol";
import {MontionsBookEngine} from "./book/MontionsBookEngine.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {Multicallable} from "solady/utils/Multicallable.sol";
import {Ownable} from "solady/auth/Ownable.sol";

/// @title MontionsBook
/// @notice Fully collateralized binary outcome series and onchain price-time CLOB.
/// @dev Matching and internal outcome-token movements make no external calls.
///      EIP-170 split (Base and other 24 KB-limit chains): order placement, matching and cancellation live in
///      `MontionsBookEngine`, deployed by this constructor and reached by `delegatecall` from the `placeOrder`,
///      `cancelOrder` and `cancelOrders` stubs below. Both contracts share `MontionsBookStorage`, so the engine
///      reads and writes this Book's storage, sees the original `msg.sender`, emits events from this address and
///      shares this Book's reentrancy lock. The engine address is immutable; nobody can swap it.
contract MontionsBook is IMontionsBook, MontionsBookStorage, ReentrancyGuard, Multicallable, Ownable {
    using TickBitmap for uint128;

    /// @notice Collateral units paid per winning contract.
    uint256 public constant override UNIT = _UNIT;
    /// @notice Collateral units per price tick.
    uint256 public constant override TICK_UNIT = _TICK_UNIT;
    /// @notice Number of ticks in a full YES price.
    uint256 public constant override TICKS = _TICKS;
    /// @notice Minimum series duration in seconds.
    uint64 public constant override MIN_DURATION = 120;
    /// @notice Maximum series duration in seconds.
    uint64 public constant override MAX_DURATION = 90 days;
    /// @notice Delay after expiry before a not-ready resolver causes a void.
    uint64 public constant override VOID_GRACE = 2 days;
    uint256 private constant _RESOLVE_GAS = 500_000;

    /// @notice Six-decimal exact-transfer, non-rebasing collateral token deposited into the Book.
    /// @dev Decimal count is checked at construction; exact transfer is checked on each deposit.
    address public immutable override collateral;
    /// @notice Matching engine executed via delegatecall against this Book's storage (immutable).
    address public immutable engine;

    error ResolverValidationFailed();
    error BadFeeRecipient();
    error NotAuthorized();
    error ZeroAddress();
    error DataTooLong(uint256 length);
    error MaxFillsTooHigh(uint16 maxFills);
    error CollateralTransferMismatch(uint256 expected, uint256 received);
    error InvalidCollateralDecimals();
    error Paused();
    error CollateralCapExceeded();
    error SeriesCapExceeded();
    error TwoStepOwnershipRequired();
    error OwnershipRenunciationDisabled();
    error NativeTransferRejected();

    /// @notice Emitted when new-risk operations are paused or resumed.
    event PausedSet(bool paused);
    /// @notice Emitted when the aggregate collateral cap changes.
    event CollateralCapSet(uint256 cap);
    /// @notice Emitted when the per-series pool cap changes.
    event SeriesPoolCapSet(uint256 cap);
    /// @notice Emitted when native currency is swept from the Book.
    event NativeSwept(address indexed to, uint256 amount);

    /// @notice Deploys the Book (and its matching engine) for a collateral token and initial administrator.
    /// @param collateral_ Six-decimal ERC20 collateral used for deposits and payouts.
    /// @param owner_ Initial administrator for resolver and fee configuration.
    constructor(address collateral_, address owner_) {
        if (collateral_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        (bool decimalsOk, bytes memory decimalsResult) =
            collateral_.staticcall(abi.encodeWithSelector(IERC20Decimals.decimals.selector));
        if (!decimalsOk || decimalsResult.length < 32 || abi.decode(decimalsResult, (uint256)) != 6) {
            revert InvalidCollateralDecimals();
        }
        collateral = collateral_;
        engine = address(new MontionsBookEngine());
        _initializeOwner(owner_);
        _feeRecipient = owner_;
    }

    // ───────────────────────── storage getters ─────────────────────────

    /// @notice Taker fee in basis points, capped at 100.
    function takerFeeBps() external view override returns (uint16) {
        return _takerFeeBps;
    }

    /// @notice Accrued fee collateral awaiting withdrawal.
    function protocolFees() external view override returns (uint256) {
        return _protocolFees;
    }

    /// @notice Destination used by permissionless fee withdrawal.
    function feeRecipient() external view returns (address) {
        return _feeRecipient;
    }

    /// @notice True when operations that add new risk are paused.
    function paused() external view returns (bool) {
        return _paused;
    }

    /// @notice Maximum collateral tracked by the Book. Lowering below usage only blocks new deposits.
    function collateralCap() external view returns (uint256) {
        return _collateralCap;
    }

    /// @notice Maximum collateral pool for any one series. Lowering below usage only blocks new pair risk.
    function seriesPoolCap() external view returns (uint256) {
        return _seriesPoolCap;
    }

    /// @notice Running sum of user cash, locked cash, series pools, and protocol fees.
    function totalCollateral() external view returns (uint256) {
        return _totalCollateral;
    }

    /// @notice User free collateral available for orders and withdrawal.
    function cash(address user) external view override returns (uint256) {
        return _cash[user];
    }

    /// @notice User collateral escrowed in open write or bid orders.
    function lockedCash(address user) external view override returns (uint256) {
        return _lockedCash[user];
    }

    /// @notice Resolver allowlist controlled by the owner.
    function resolverAllowed(address resolver) external view override returns (bool) {
        return _resolverAllowed[resolver];
    }

    /// @notice Collateral backing outcome tokens for each series.
    function pool(bytes32 seriesId) external view override returns (uint256) {
        return _pool[seriesId];
    }

    /// @notice Highest order id ever assigned; ids start at one.
    function orderCount() external view override returns (uint64) {
        return _orderCount;
    }

    // ───────────────────────── ownership & admin ─────────────────────────

    /// @notice Returns the current owner (Solady Ownable compatibility with IMontionsBook).
    function owner() public view override(IMontionsBook, Ownable) returns (address) {
        return Ownable.owner();
    }

    /// @notice Disables Solady's direct one-step ownership transfer; use the handover flow.
    function transferOwnership(address) public payable override onlyOwner {
        revert TwoStepOwnershipRequired();
    }

    /// @notice Disables renunciation so administrative safety controls cannot be stranded.
    function renounceOwnership() public payable override onlyOwner {
        revert OwnershipRenunciationDisabled();
    }

    /// @notice Requests a two-step ownership handover as the prospective owner.
    function requestOwnershipHandover() public payable override nonReentrant {
        Ownable.requestOwnershipHandover();
    }

    /// @notice Cancels the caller's pending ownership handover request.
    function cancelOwnershipHandover() public payable override nonReentrant {
        Ownable.cancelOwnershipHandover();
    }

    /// @notice Completes the requested two-step ownership handover.
    function completeOwnershipHandover(address pendingOwner) public payable override onlyOwner nonReentrant {
        Ownable.completeOwnershipHandover(pendingOwner);
    }

    /// @notice Allows or disallows a resolver for permissionless series creation.
    /// @param resolver Resolver contract address.
    /// @param allowed Whether the resolver may be used.
    function setResolverAllowed(address resolver, bool allowed) external override onlyOwner nonReentrant {
        if (resolver == address(0)) revert ZeroAddress();
        _resolverAllowed[resolver] = allowed;
    }

    /// @notice Sets the taker fee and destination for accrued protocol fees.
    /// @param takerFeeBps_ Fee in basis points, capped at 100.
    /// @param recipient Fee recipient. Must be nonzero when fees are enabled.
    function setFee(uint16 takerFeeBps_, address recipient) external override onlyOwner nonReentrant {
        if (takerFeeBps_ > 100) revert FeeTooHigh();
        if (takerFeeBps_ != 0 && recipient == address(0)) revert BadFeeRecipient();
        _takerFeeBps = takerFeeBps_;
        _feeRecipient = recipient == address(0) ? owner() : recipient;
    }

    /// @notice Pauses or resumes operations that add new risk. Exits are never paused.
    /// @param paused_ True to pause create, trade, split, and deposits.
    function setPaused(bool paused_) external onlyOwner nonReentrant {
        _paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice Sets the maximum aggregate collateral the Book may account for.
    /// @dev A cap below current usage is allowed and only blocks future deposits.
    function setCollateralCap(uint256 cap) external onlyOwner nonReentrant {
        _collateralCap = cap;
        emit CollateralCapSet(cap);
    }

    /// @notice Sets the maximum pool amount per series.
    /// @dev A cap below current usage is allowed and only blocks future pair creation.
    function setSeriesPoolCap(uint256 cap) external onlyOwner nonReentrant {
        _seriesPoolCap = cap;
        emit SeriesPoolCapSet(cap);
    }

    /// @notice Returns the aggregate and per-series collateral caps.
    /// @return collateralCap_ Maximum aggregate tracked collateral.
    /// @return seriesPoolCap_ Maximum collateral pool in one series.
    function caps() external view returns (uint256 collateralCap_, uint256 seriesPoolCap_) {
        return (_collateralCap, _seriesPoolCap);
    }

    /// @notice Withdraws all accidentally received native currency, never ERC20 collateral or outcomes.
    /// @param to Destination for the native balance.
    function sweepNative(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        SafeTransferLib.safeTransferETH(to, amount);
        emit NativeSwept(to, amount);
    }

    /// @notice Rejects plain native transfers; payable multicall can still receive native currency.
    /// @dev A nonpayable fallback is used instead of `receive()` to keep the contract type
    ///      nonpayable for existing deploy scripts; empty-calldata value transfers still revert.
    fallback() external {
        revert NativeTransferRejected();
    }

    /// @notice Withdraws accrued fees to the configured fee recipient.
    /// @dev Anyone may trigger the transfer, but cannot choose its destination.
    function withdrawFees() external override nonReentrant {
        uint256 amount = _protocolFees;
        if (amount == 0) return;
        address recipient = _feeRecipient;
        _protocolFees = 0;
        _totalCollateral -= amount;
        SafeTransferLib.safeTransfer(collateral, recipient, amount);
    }

    // ───────────────────────── cash account ─────────────────────────

    /// @notice Deposits collateral into the caller's free cash account.
    /// @param amount Collateral amount in the token's smallest unit.
    function deposit(uint256 amount) external override nonReentrant {
        if (_paused) revert Paused();
        _depositCollateral(msg.sender, amount);
    }

    /// @notice Deposits collateral using an EIP-2612 permit in the same transaction.
    /// @param amount Collateral amount in the token's smallest unit.
    /// @param deadline Permit expiry timestamp.
    /// @param v Signature recovery id.
    /// @param r Signature component.
    /// @param s Signature component.
    function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        override
        nonReentrant
    {
        if (_paused) revert Paused();
        IERC20Permit(collateral).permit(msg.sender, address(this), amount, deadline, v, r, s);
        _depositCollateral(msg.sender, amount);
    }

    /// @notice Withdraws free collateral from the caller's cash account.
    /// @param amount Collateral amount in the token's smallest unit.
    function withdraw(uint256 amount) external override nonReentrant {
        uint256 available = _cash[msg.sender];
        if (available < amount) revert InsufficientCash();
        unchecked {
            _cash[msg.sender] = available - amount;
            _totalCollateral -= amount;
        }
        SafeTransferLib.safeTransfer(collateral, msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    // ───────────────────────── series ─────────────────────────

    /// @notice Computes the deterministic id for resolver data and expiry.
    /// @param resolver Resolver contract.
    /// @param data Resolver-specific series description.
    /// @param expiry Unix timestamp when trading expires.
    /// @return seriesId Deterministic series id.
    function seriesIdOf(address resolver, bytes calldata data, uint64 expiry)
        external
        pure
        override
        returns (bytes32 seriesId)
    {
        return keccak256(abi.encode(resolver, data, expiry));
    }

    /// @notice Creates a permissionless market using an owner-approved resolver.
    /// @param resolver Resolver contract.
    /// @param data Resolver-specific market definition.
    /// @param expiry Unix timestamp when trading expires.
    /// @return seriesId Newly created series id.
    function createSeries(address resolver, bytes calldata data, uint64 expiry)
        external
        override
        nonReentrant
        returns (bytes32 seriesId)
    {
        if (_paused) revert Paused();
        if (data.length > 512) revert DataTooLong(data.length);
        if (!_resolverAllowed[resolver] || resolver.code.length == 0) revert ResolverNotAllowed();
        if (expiry < block.timestamp + MIN_DURATION || expiry > block.timestamp + MAX_DURATION) revert BadExpiry();
        try IResolver(resolver).validate(data, expiry) {}
        catch {
            revert ResolverValidationFailed();
        }

        seriesId = keccak256(abi.encode(resolver, data, expiry));
        if (_series[seriesId].status != Status.None) revert SeriesExists();

        uint256 yesId = uint256(keccak256(abi.encode(seriesId, "YES")));
        uint256 noId = uint256(keccak256(abi.encode(seriesId, "NO")));
        _series[seriesId] = SeriesInfo({
            resolver: resolver,
            data: data,
            expiry: expiry,
            status: Status.Open,
            yes: false,
            yesId: yesId,
            noId: noId,
            createdAt: uint64(block.timestamp)
        });
        _seriesList.push(seriesId);
        emit SeriesCreated(seriesId, resolver, expiry, yesId, noId);
    }

    /// @notice Returns stored metadata for a series.
    /// @param seriesId Series identifier.
    /// @return info Resolver data, status, expiry, and outcome-token ids.
    function seriesInfo(bytes32 seriesId) external view override returns (SeriesInfo memory info) {
        info = _series[seriesId];
        if (info.status == Status.None) revert SeriesUnknown();
    }

    /// @notice Returns the number of created series.
    /// @return count Total number of series.
    function seriesCount() external view override returns (uint256 count) {
        return _seriesList.length;
    }

    /// @notice Returns a series id by its zero-based creation index.
    /// @param index Series index.
    /// @return seriesId Series identifier.
    function seriesIdAt(uint256 index) external view override returns (bytes32 seriesId) {
        if (index >= _seriesList.length) revert SeriesUnknown();
        return _seriesList[index];
    }

    /// @notice Pages the series ids in creation order.
    /// @param offset First zero-based series index.
    /// @param limit Maximum number of ids to return.
    /// @return ids Series identifiers.
    function seriesIds(uint256 offset, uint256 limit) external view override returns (bytes32[] memory ids) {
        uint256 count = _seriesList.length;
        if (offset >= count || limit == 0) return new bytes32[](0);
        uint256 length = count - offset;
        if (length > limit) length = limit;
        ids = new bytes32[](length);
        for (uint256 i; i < length; ++i) {
            ids[i] = _seriesList[offset + i];
        }
    }

    // ───────────────────────── trading (delegated to the engine) ─────────────────────────

    /// @notice Places a limit order and applies maker price-time priority.
    /// @dev Executed by `MontionsBookEngine` via delegatecall (EIP-170 split; same storage, sender and events).
    ///      A Bid with `fromHeld=true` escrows NO plus bid-limit cash to acquire YES and merge the pair;
    ///      it earns UNIT minus the resting YES tick per fill. Against a write-Ask, the writer receives
    ///      newly minted NO while the acquired YES and escrowed NO are burned together; against a held-YES
    ///      Ask, both existing legs are burned and the pool releases UNIT. The taker fee is one ceil on
    ///      collateral consumed across all fills. Bids and write-Asks reserve the maximum fee up front and
    ///      release the unused reserve when the taker phase ends; held-token sellers pay from proceeds.
    ///      At the `maxFills` bound, a still-crossing GTC remainder is refunded and returned with
    ///      `resting == 0`; only a non-crossing remainder joins the book. A pair-minting fill is
    ///      truncated to remaining whole-contract series-cap capacity, then matching stops. The
    ///      remainder follows normal TIF handling: a still-crossing GTC remainder is refunded,
    ///      while a non-crossing GTC remainder may rest.
    ///      The reentrancy lock is taken inside the engine (a modifier here could not be released, since the
    ///      stub returns straight from assembly).
    /// @return orderId Sequential id assigned to this submission.
    /// @return filled Contracts matched immediately.
    /// @return resting Contracts left open on the book.
    function placeOrder(PlaceParams calldata)
        external
        override
        returns (uint64 orderId, uint64 filled, uint64 resting)
    {
        _delegateToEngine();
        return (orderId, filled, resting); // unreachable: the engine's return data is returned verbatim
    }

    /// @notice Cancels one open order owned by the caller, including after expiry (executed by the engine).
    function cancelOrder(uint64) external override {
        _delegateToEngine();
    }

    /// @notice Cancels several caller-owned orders atomically (executed by the engine).
    function cancelOrders(uint64[] calldata) external override {
        _delegateToEngine();
    }

    /// @dev Forwards the full calldata to the immutable engine and returns or reverts with its exact return data.
    function _delegateToEngine() private {
        address target = engine;
        assembly {
            let ptr := mload(0x40)
            calldatacopy(ptr, 0, calldatasize())
            let ok := delegatecall(gas(), target, ptr, calldatasize(), 0, 0)
            let size := returndatasize()
            returndatacopy(ptr, 0, size)
            if iszero(ok) { revert(ptr, size) }
            return(ptr, size)
        }
    }

    // ───────────────────────── split / merge / settlement ─────────────────────────

    /// @notice Splits collateral into one YES and one NO token per contract.
    /// @param seriesId Open series id.
    /// @param qty Number of paired contracts to create.
    function split(bytes32 seriesId, uint64 qty) external override nonReentrant {
        if (_paused) revert Paused();
        SeriesInfo storage info = _series[seriesId];
        if (info.status == Status.None) revert SeriesUnknown();
        if (info.status != Status.Open) revert SeriesNotOpen();
        if (block.timestamp >= info.expiry) revert Expired();
        if (qty == 0 || qty > _MAX_ORDER_QTY) revert BadQty();
        uint256 amount = uint256(qty) * UNIT;
        if (amount > _seriesPoolCap || _pool[seriesId] > _seriesPoolCap - amount) revert SeriesCapExceeded();
        uint256 free = _cash[msg.sender];
        if (free < amount) revert InsufficientCash();
        unchecked {
            _cash[msg.sender] = free - amount;
        }
        _pool[seriesId] += amount;
        _mintOutcome(msg.sender, info.yesId, qty);
        _mintOutcome(msg.sender, info.noId, qty);
        emit Split(seriesId, msg.sender, qty);
    }

    /// @notice Burns equal YES and NO amounts to return their paired collateral.
    /// @param seriesId Open series id.
    /// @param qty Number of pairs to merge.
    function merge(bytes32 seriesId, uint64 qty) external override nonReentrant {
        SeriesInfo storage info = _series[seriesId];
        if (info.status == Status.None) revert SeriesUnknown();
        if (info.status != Status.Open) revert SeriesNotOpen();
        if (qty == 0 || qty > _MAX_ORDER_QTY) revert BadQty();
        uint256 amount = uint256(qty) * UNIT;
        if (_outcomeBalance(msg.sender, info.yesId) < qty || _outcomeBalance(msg.sender, info.noId) < qty) {
            revert InsufficientTokens();
        }
        if (_pool[seriesId] < amount) revert InsufficientCash();
        _burnOutcome(msg.sender, info.yesId, qty);
        _burnOutcome(msg.sender, info.noId, qty);
        _pool[seriesId] -= amount;
        _cash[msg.sender] += amount;
        emit Merge(seriesId, msg.sender, qty);
    }

    /// @notice Resolves an expired series or voids it after the resolver grace period.
    /// @param seriesId Expired series id.
    function resolve(bytes32 seriesId) external override nonReentrant {
        SeriesInfo storage info = _series[seriesId];
        if (info.status == Status.None) revert SeriesUnknown();
        if (info.status != Status.Open) revert AlreadySettled();
        if (block.timestamp <= info.expiry) revert NotExpired();

        (bool success, bytes memory result) =
            info.resolver.staticcall{gas: _RESOLVE_GAS}(abi.encodeCall(IResolver.resolve, (info.data, info.expiry)));
        bool ready;
        bool yes;
        if (success && result.length >= 64) {
            uint256 readyWord;
            uint256 yesWord;
            assembly {
                readyWord := mload(add(result, 0x20))
                yesWord := mload(add(result, 0x40))
            }
            if (readyWord <= 1 && yesWord <= 1) {
                ready = readyWord == 1;
                yes = yesWord == 1;
            }
        }

        if (ready) {
            info.status = Status.Resolved;
            info.yes = yes;
            emit SeriesResolved(seriesId, yes);
            return;
        }
        if (block.timestamp < uint256(info.expiry) + VOID_GRACE) revert NotExpired();
        info.status = Status.Void;
        emit SeriesVoided(seriesId);
    }

    /// @notice Burns the caller's outcome tokens and credits the settlement payout.
    /// @param seriesId Settled series id.
    /// @param yesQty YES amount to redeem.
    /// @param noQty NO amount to redeem.
    /// @return payout Collateral credited to caller.
    function redeem(bytes32 seriesId, uint256 yesQty, uint256 noQty)
        external
        override
        nonReentrant
        returns (uint256 payout)
    {
        SeriesInfo storage info = _series[seriesId];
        if (info.status == Status.None) revert SeriesUnknown();
        if (info.status == Status.Open) revert SeriesNotOpen();
        if (yesQty == 0 && noQty == 0) revert BadQty();
        if (_outcomeBalance(msg.sender, info.yesId) < yesQty || _outcomeBalance(msg.sender, info.noId) < noQty) {
            revert InsufficientTokens();
        }

        if (info.status == Status.Resolved) {
            payout = (info.yes ? yesQty : noQty) * UNIT;
        } else {
            payout = (yesQty + noQty) * UNIT / 2;
        }
        if (_pool[seriesId] < payout) revert InsufficientCash();

        if (yesQty != 0) _burnOutcome(msg.sender, info.yesId, yesQty);
        if (noQty != 0) _burnOutcome(msg.sender, info.noId, noQty);
        _pool[seriesId] -= payout;
        _cash[msg.sender] += payout;
        emit Redeemed(seriesId, msg.sender, yesQty, noQty, payout);
    }

    // ───────────────────────── views ─────────────────────────

    /// @notice Returns the best bid and ask prices with their aggregate quantities.
    /// @param seriesId Series to inspect.
    /// @return bidTick Highest bid tick, or zero if absent.
    /// @return bidQty Quantity at the best bid.
    /// @return askTick Lowest ask tick, or zero if absent.
    /// @return askQty Quantity at the best ask.
    function bestBidAsk(bytes32 seriesId)
        external
        view
        override
        returns (uint8 bidTick, uint64 bidQty, uint8 askTick, uint64 askQty)
    {
        bidTick = _bidBitmap[seriesId].highestSetBit();
        askTick = _askBitmap[seriesId].lowestSetBit();
        if (bidTick != 0) bidQty = uint64(_bidLevels[seriesId][bidTick].qty);
        if (askTick != 0) askQty = uint64(_askLevels[seriesId][askTick].qty);
    }

    /// @notice Returns aggregate levels best price first for one side.
    /// @param seriesId Series to inspect.
    /// @param side Bid or ask side.
    /// @param maxLevels Maximum number of nonempty levels.
    /// @return levels Aggregated quantities ordered by price priority.
    function depth(bytes32 seriesId, Side side, uint8 maxLevels)
        external
        view
        override
        returns (Level[] memory levels)
    {
        if (maxLevels == 0) return new Level[](0);
        uint128 bitmap = side == Side.Bid ? _bidBitmap[seriesId] : _askBitmap[seriesId];
        levels = new Level[](maxLevels);
        uint256 count;
        while (bitmap != 0 && count < maxLevels) {
            uint8 tick = side == Side.Bid ? bitmap.highestSetBit() : bitmap.lowestSetBit();
            uint128 qty = side == Side.Bid ? _bidLevels[seriesId][tick].qty : _askLevels[seriesId][tick].qty;
            levels[count++] = Level({tick: tick, qty: uint64(qty)});
            bitmap = bitmap.unset(tick);
        }
        assembly {
            mstore(levels, count)
        }
    }

    /// @notice Returns an order's current and original quantity plus status.
    /// @param orderId Order id.
    /// @return order Stored order metadata, or a zero-valued view for an unknown id.
    function orderInfo(uint64 orderId) external view override returns (OrderView memory order) {
        return _orderView(orderId);
    }

    /// @notice Returns the number of order ids ever assigned to a user.
    /// @param user User address.
    /// @return count Number of submitted orders.
    function userOrderCount(address user) external view override returns (uint256 count) {
        return _userOrders[user].length;
    }

    /// @notice Pages a user's orders newest first, including closed orders.
    /// @param user User address.
    /// @param offset Number of newest orders to skip.
    /// @param limit Maximum number of orders to return.
    /// @return orders Order views in descending creation order.
    function ordersOf(address user, uint256 offset, uint256 limit)
        external
        view
        override
        returns (OrderView[] memory orders)
    {
        uint256 length = _userOrders[user].length;
        if (offset >= length || limit == 0) return new OrderView[](0);
        uint256 count = length - offset;
        if (count > limit) count = limit;
        orders = new OrderView[](count);
        for (uint256 i; i < count; ++i) {
            uint64 id = _userOrders[user][length - 1 - offset - i];
            orders[i] = _orderView(id);
        }
    }

    /// @notice Returns up to `n` most recent trades for a series, newest first.
    /// @param seriesId Series to inspect.
    /// @param n Maximum number of trades, capped at the 64-entry ring size.
    /// @return trades Recent trade records.
    function recentTrades(bytes32 seriesId, uint8 n) external view override returns (TradeView[] memory trades) {
        uint8 count = _tradeCount[seriesId];
        if (n > count) n = count;
        trades = new TradeView[](n);
        uint8 next = _tradeNext[seriesId];
        for (uint8 i; i < n; ++i) {
            uint8 index = uint8((uint256(next) + _TRADE_RING_SIZE - 1 - i) & (_TRADE_RING_SIZE - 1));
            trades[i] = _tradeRing[seriesId][index];
        }
    }

    /// @notice Returns the most recent trade tick, or zero when no trade occurred.
    /// @param seriesId Series to inspect.
    /// @return tick Most recent executed tick.
    function lastTradeTick(bytes32 seriesId) external view override returns (uint8 tick) {
        return _lastTradeTick[seriesId];
    }

    /// @notice Returns lifetime contracts traded for a series.
    /// @param seriesId Series to inspect.
    /// @return contractsTraded Sum of all filled contract quantities.
    function volumeOf(bytes32 seriesId) external view override returns (uint256 contractsTraded) {
        return _volume[seriesId];
    }

    // ───────────────────────── outcome tokens (ERC1155) ─────────────────────────

    /// @notice Returns an account's outcome-token balance.
    /// @param account Account to inspect.
    /// @param id YES or NO outcome-token id.
    /// @return amount Token balance.
    function balanceOf(address account, uint256 id) external view override returns (uint256 amount) {
        if (account == address(0)) revert ZeroAddress();
        return _outcomeBalance(account, id);
    }

    /// @notice Returns balances for a batch of accounts and token ids.
    /// @param accounts Accounts to inspect.
    /// @param ids YES or NO outcome-token ids.
    /// @return amounts Corresponding token balances.
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external
        view
        returns (uint256[] memory amounts)
    {
        if (accounts.length != ids.length) revert OutcomeArrayLengthMismatch();
        amounts = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            amounts[i] = _outcomeBalance(accounts[i], ids[i]);
        }
    }

    /// @notice Returns the total supply of an outcome-token id.
    /// @param id YES or NO outcome-token id.
    /// @return amount Total supply.
    function totalSupply(uint256 id) external view override returns (uint256 amount) {
        return _outcomeSupply(id);
    }

    /// @notice Transfers outcome tokens and calls a receiver hook for contract recipients.
    /// @param from Source token holder.
    /// @param to Destination token holder.
    /// @param id YES or NO outcome-token id.
    /// @param amount Token amount.
    /// @param data Opaque receiver callback data.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data)
        external
        override
        nonReentrant
    {
        if (msg.sender != from && !_outcomeApproved(from, msg.sender)) revert NotAuthorized();
        _transferOutcome(from, to, id, amount);
        _checkOutcomeReceiver(from, to, id, amount, data);
    }

    /// @notice Transfers outcome-token batches and calls a batch receiver hook for contract recipients.
    /// @param from Source token holder.
    /// @param to Destination token holder.
    /// @param ids YES or NO outcome-token ids.
    /// @param amounts Token amounts corresponding to `ids`.
    /// @param data Opaque receiver callback data.
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external nonReentrant {
        if (msg.sender != from && !_outcomeApproved(from, msg.sender)) {
            revert NotAuthorized();
        }
        _transferOutcomeBatch(from, to, ids, amounts);
        _checkOutcomeBatchReceiver(from, to, ids, amounts, data);
    }

    /// @notice Grants or revokes an operator's right to transfer caller tokens.
    /// @param operator Operator address.
    /// @param approved True to approve, false to revoke.
    function setApprovalForAll(address operator, bool approved) external override nonReentrant {
        if (operator == address(0)) revert ZeroAddress();
        if (operator == msg.sender) revert NotAuthorized();
        _setOutcomeApproval(operator, approved);
    }

    /// @notice Returns whether an operator is approved for an account.
    /// @param account Token owner.
    /// @param operator Potential operator.
    /// @return approved True if the operator is approved.
    function isApprovedForAll(address account, address operator) external view override returns (bool approved) {
        return _outcomeApproved(account, operator);
    }

    /// @notice Reports ERC165 and ERC1155 interface support.
    /// @param interfaceId Interface identifier to query.
    /// @return supported True for ERC165 and ERC1155.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool supported) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0xd9b67a26;
    }

    /// @notice Batches Book calls with the caller preserved by Solady Multicallable.
    /// @param data Encoded calls to this contract.
    /// @return results Return data from each call.
    function multicall(bytes[] calldata data)
        public
        payable
        override(IMontionsBook, Multicallable)
        returns (bytes[] memory results)
    {
        // Keep Solady's delegatecall batching while permitting accidental native value to be
        // recovered later with sweepNative. Inner nonpayable functions still reject msg.value.
        return _multicallResultsToBytesArray(_multicall(data));
    }

    function _depositCollateral(address account, uint256 amount) private {
        if (_paused) revert Paused();
        if (_totalCollateral > _collateralCap || amount > _collateralCap - _totalCollateral) {
            revert CollateralCapExceeded();
        }
        uint256 beforeBalance = IERC20Balance(collateral).balanceOf(address(this));
        SafeTransferLib.safeTransferFrom(collateral, account, address(this), amount);
        uint256 afterBalance = IERC20Balance(collateral).balanceOf(address(this));
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) revert CollateralTransferMismatch(amount, received);
        _cash[account] += amount;
        _totalCollateral += amount;
        emit Deposit(account, amount);
    }

    function _orderView(uint64 id) private view returns (OrderView memory view_) {
        StoredOrder storage order = _orders[id];
        view_ = OrderView({
            id: id,
            maker: order.maker,
            seriesId: order.seriesId,
            side: order.side,
            tick: order.tick,
            fromHeld: order.fromHeld,
            qty: order.qty,
            origQty: order.origQty,
            placedAt: order.placedAt,
            open: order.open
        });
    }
}

    interface IERC20Permit {
        function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
            external;
    }

    interface IERC20Balance {
        function balanceOf(address account) external view returns (uint256);
    }

    interface IERC20Decimals {
        function decimals() external view returns (uint8);
    }
