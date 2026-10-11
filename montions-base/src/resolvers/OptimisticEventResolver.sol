// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IResolver} from "../interfaces/IResolver.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {LibString} from "solady/utils/LibString.sol";
import {
    EventOutcome,
    EventStatus,
    EventView,
    EventProposal,
    EventRegistration,
    DEFAULT_CHALLENGE_WINDOW,
    MIN_CHALLENGE_WINDOW,
    MAX_CHALLENGE_WINDOW,
    DEFAULT_ARBITRATION_FEE_BPS,
    MAX_ARBITRATION_FEE_BPS,
    DEFAULT_BOND_AMOUNT,
    MIN_BOND_AMOUNT,
    MAX_BOND_AMOUNT,
    EVENT_DATA_LENGTH,
    MAX_KEY_BYTES,
    MAX_QUESTION_BYTES,
    MAX_RULES_BYTES,
    MAX_SOURCE_BYTES,
    MAX_CATEGORY_BYTES,
    MAX_ICON_BYTES
} from "./events/EventTypes.sol";

/// @title OptimisticEventResolver
/// @notice Catalog + optimistic resolver for Kairo yes/no event markets (same Book, $1 YES/NO contracts).
/// @dev Series data = abi.encode(bytes32 eventKey, uint64 closeTime, bytes32 rulesHash) (96 bytes).
///      `eventKey = keccak256(bytes(keyString))` is chain-agnostic (e.g. "FED-CUT-2026-10-28").
///
///      Flow (after `closeTime` / Book expiry, which must be equal):
///        1. Anyone `propose(eventKey, YES|NO|INVALID)` posting `bondAmount` tUSDC.
///        2. During `challengeWindow` (default 2 h, owner-set 10 min–3 days) anyone else may
///           `dispute` by matching that bond.
///        3. Undisputed after the window → final (view-ready; `finalize` returns the proposer's bond).
///        4. Disputed → `arbitrate` by the arbitrator (testnet: owner/multisig EOA — not UMA/DVM).
///           Both bonds minus `arbitrationFeeBps` go to the winner (proposer if the award matches
///           the assertion, else the disputer); the fee goes to `treasury`.
///        5. INVALID (or never-finalized) → `resolve` stays not-ready so the Book voids 50/50 after
///           VOID_GRACE (2 days). There is no third Book status; "not ready" is the void signal.
///
///      Trust: the curator (owner-set) lists questions; bonded proposers/disputers supply the
///      economic first line; the arbitrator is the final fact-finder. On testnet the arbitrator
///      is the deployer EOA. That is weaker than UMA's token vote — see docs/EVENTS.md.
contract OptimisticEventResolver is IResolver, Ownable, ReentrancyGuard {
    using SafeTransferLib for address;

    uint256 private constant _BPS_DENOM = 10_000;

    struct EventRecord {
        string key;
        string question;
        string rules;
        string source;
        string category;
        string icon;
        uint64 closeTime;
        bytes32 rulesHash;
        bool registered;
        bool finalized;
        EventOutcome finalOutcome;
    }

    /// @notice Six-decimal exact-transfer collateral used for bonds (tUSDC on testnet).
    address public immutable collateral;

    /// @notice May register events alongside the owner.
    address public curator;
    /// @notice Awards disputed proposals. Testnet: owner EOA / multisig, not a token vote.
    address public arbitrator;
    /// @notice Receives the arbitration fee sliced from both bonds.
    address public treasury;
    /// @notice Seconds a proposal may be disputed. Snapshotted onto each proposal.
    uint64 public challengeWindow;
    /// @notice tUSDC bond required to propose or dispute. Snapshotted onto each proposal.
    uint256 public bondAmount;
    /// @notice Fee on 2×bond paid to treasury on arbitrate/reject, in bps (default 5%).
    uint16 public arbitrationFeeBps;

    mapping(bytes32 => EventRecord) internal _events;
    mapping(bytes32 => EventProposal) internal _proposals;
    bytes32[] internal _eventKeys;

    error ZeroAddress();
    error BadData();
    error UnknownEvent();
    error EventExists();
    error EmptyField();
    error FieldTooLong();
    error BadCategory();
    error BadCloseTime();
    error BadOutcome();
    error CloseTimeMismatch();
    error RulesHashMismatch();
    error ExpiryMismatch();
    error AlreadyClosed();
    error EventNotClosed();
    error AlreadyFinalized();
    error ProposalExists();
    error NoProposal();
    error AlreadyDisputed();
    error NotDisputed();
    error ChallengePending();
    error ChallengeExpired();
    error SelfDispute();
    error NotCurator();
    error NotArbitrator();
    error ChallengeWindowOutOfBounds();
    error BondAmountOutOfBounds();
    error FeeOutOfBounds();
    error BondTransferMismatch();

    event EventRegistered(bytes32 indexed eventKey, string key, uint64 closeTime, bytes32 rulesHash);
    event Proposed(bytes32 indexed eventKey, address indexed proposer, EventOutcome outcome, uint256 bond, uint64 window);
    event Disputed(bytes32 indexed eventKey, address indexed disputer, uint256 bond);
    event Finalized(bytes32 indexed eventKey, EventOutcome outcome, address indexed proposer, uint256 bondReturned);
    event Arbitrated(
        bytes32 indexed eventKey,
        EventOutcome outcome,
        address indexed winner,
        uint256 winnerPayout,
        uint256 fee
    );
    event ProposalRejected(bytes32 indexed eventKey, address indexed disputer, uint256 winnerPayout, uint256 fee);
    event ChallengeWindowSet(uint64 window);
    event BondAmountSet(uint256 amount);
    event ArbitrationFeeSet(uint16 bps);
    event CuratorSet(address indexed curator);
    event ArbitratorSet(address indexed arbitrator);
    event TreasurySet(address indexed treasury);

    constructor(address collateral_, address owner_, address treasury_, address arbitrator_) {
        if (
            collateral_ == address(0) || owner_ == address(0) || treasury_ == address(0) || arbitrator_ == address(0)
        ) {
            revert ZeroAddress();
        }
        collateral = collateral_;
        treasury = treasury_;
        arbitrator = arbitrator_;
        curator = owner_;
        challengeWindow = DEFAULT_CHALLENGE_WINDOW;
        bondAmount = DEFAULT_BOND_AMOUNT;
        arbitrationFeeBps = DEFAULT_ARBITRATION_FEE_BPS;
        _initializeOwner(owner_);
    }

    // ───────────────────────── admin ─────────────────────────

    function setCurator(address curator_) external onlyOwner {
        curator = curator_;
        emit CuratorSet(curator_);
    }

    function setArbitrator(address arbitrator_) external onlyOwner {
        if (arbitrator_ == address(0)) revert ZeroAddress();
        arbitrator = arbitrator_;
        emit ArbitratorSet(arbitrator_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setChallengeWindow(uint64 window_) external onlyOwner {
        if (window_ < MIN_CHALLENGE_WINDOW || window_ > MAX_CHALLENGE_WINDOW) revert ChallengeWindowOutOfBounds();
        challengeWindow = window_;
        emit ChallengeWindowSet(window_);
    }

    function setBondAmount(uint256 amount) external onlyOwner {
        if (amount < MIN_BOND_AMOUNT || amount > MAX_BOND_AMOUNT) revert BondAmountOutOfBounds();
        bondAmount = amount;
        emit BondAmountSet(amount);
    }

    function setArbitrationFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_ARBITRATION_FEE_BPS) revert FeeOutOfBounds();
        arbitrationFeeBps = bps;
        emit ArbitrationFeeSet(bps);
    }

    /// @notice Owner or curator lists a question. `rulesHash = keccak256(bytes(p.rules))` is frozen.
    function registerEvent(EventRegistration calldata p) external {
        if (msg.sender != owner() && msg.sender != curator) revert NotCurator();
        _validateNewEvent(p);
        bytes32 eventKey = keccak256(bytes(p.key));
        EventRecord storage e = _events[eventKey];
        if (e.registered) revert EventExists();
        e.key = p.key;
        e.question = p.question;
        e.rules = p.rules;
        e.source = p.source;
        e.category = p.category;
        e.icon = p.icon;
        e.closeTime = p.closeTime;
        e.rulesHash = keccak256(bytes(p.rules));
        e.registered = true;
        _eventKeys.push(eventKey);
        emit EventRegistered(eventKey, e.key, p.closeTime, e.rulesHash);
    }

    // ───────────────────────── optimistic flow ─────────────────────────

    /// @notice After `closeTime`, post `bondAmount` tUSDC and assert YES, NO, or INVALID.
    function propose(bytes32 eventKey, EventOutcome outcome) external nonReentrant {
        if (outcome != EventOutcome.Yes && outcome != EventOutcome.No && outcome != EventOutcome.Invalid) {
            revert BadOutcome();
        }
        EventRecord storage e = _events[eventKey];
        if (!e.registered) revert UnknownEvent();
        if (e.finalized) revert AlreadyFinalized();
        if (block.timestamp < e.closeTime) revert EventNotClosed();
        EventProposal storage p = _proposals[eventKey];
        if (p.proposer != address(0)) revert ProposalExists();

        uint256 bond = bondAmount;
        uint64 window = challengeWindow;
        _pullBond(msg.sender, bond);
        p.proposer = msg.sender;
        p.disputer = address(0);
        p.proposedAt = uint64(block.timestamp);
        p.window = window;
        p.outcome = outcome;
        p.bond = bond;
        emit Proposed(eventKey, msg.sender, outcome, bond, window);
    }

    /// @notice Match the proposer's bond during the snapshotted challenge window.
    function dispute(bytes32 eventKey) external nonReentrant {
        EventProposal storage p = _proposals[eventKey];
        if (p.proposer == address(0)) revert NoProposal();
        if (p.disputer != address(0)) revert AlreadyDisputed();
        if (msg.sender == p.proposer) revert SelfDispute();
        if (block.timestamp >= uint256(p.proposedAt) + p.window) revert ChallengeExpired();
        _pullBond(msg.sender, p.bond);
        p.disputer = msg.sender;
        emit Disputed(eventKey, msg.sender, p.bond);
    }

    /// @notice Return the proposer's bond and persist an undisputed outcome after the window.
    /// @dev Optional for Book resolution: `resolve` already treats an undisputed, matured
    ///      proposal as final. Still required to unlock the bond.
    function finalize(bytes32 eventKey) external nonReentrant {
        EventRecord storage e = _events[eventKey];
        if (!e.registered) revert UnknownEvent();
        if (e.finalized) revert AlreadyFinalized();
        EventProposal storage p = _proposals[eventKey];
        if (p.proposer == address(0)) revert NoProposal();
        if (p.disputer != address(0)) revert AlreadyDisputed();
        if (block.timestamp < uint256(p.proposedAt) + p.window) revert ChallengePending();

        address proposer = p.proposer;
        uint256 bond = p.bond;
        EventOutcome outcome = p.outcome;
        e.finalized = true;
        e.finalOutcome = outcome;
        delete _proposals[eventKey];
        collateral.safeTransfer(proposer, bond);
        emit Finalized(eventKey, outcome, proposer, bond);
    }

    /// @notice Arbitrator sets the true outcome of a disputed proposal and pays the winner.
    function arbitrate(bytes32 eventKey, EventOutcome outcome) external nonReentrant {
        if (msg.sender != arbitrator) revert NotArbitrator();
        if (outcome != EventOutcome.Yes && outcome != EventOutcome.No && outcome != EventOutcome.Invalid) {
            revert BadOutcome();
        }
        EventRecord storage e = _events[eventKey];
        if (!e.registered) revert UnknownEvent();
        if (e.finalized) revert AlreadyFinalized();
        EventProposal storage p = _proposals[eventKey];
        if (p.proposer == address(0)) revert NoProposal();
        if (p.disputer == address(0)) revert NotDisputed();

        address winner = outcome == p.outcome ? p.proposer : p.disputer;
        (uint256 winnerPayout, uint256 fee) = _bondPayout(p.bond);
        e.finalized = true;
        e.finalOutcome = outcome;
        delete _proposals[eventKey];
        _payWinner(winner, winnerPayout, fee);
        emit Arbitrated(eventKey, outcome, winner, winnerPayout, fee);
    }

    /// @notice Throw out a disputed proposal without finalizing, so a new assertion can be posted.
    /// @dev The disputer is treated as the round winner (they correctly challenged). Bonds minus
    ///      fee go to them; the event stays unresolved.
    function rejectProposal(bytes32 eventKey) external nonReentrant {
        if (msg.sender != arbitrator) revert NotArbitrator();
        EventRecord storage e = _events[eventKey];
        if (!e.registered) revert UnknownEvent();
        if (e.finalized) revert AlreadyFinalized();
        EventProposal storage p = _proposals[eventKey];
        if (p.proposer == address(0)) revert NoProposal();
        if (p.disputer == address(0)) revert NotDisputed();

        address disputer = p.disputer;
        (uint256 winnerPayout, uint256 fee) = _bondPayout(p.bond);
        delete _proposals[eventKey];
        _payWinner(disputer, winnerPayout, fee);
        emit ProposalRejected(eventKey, disputer, winnerPayout, fee);
    }

    // ───────────────────────── IResolver ─────────────────────────

    /// @inheritdoc IResolver
    function validate(bytes calldata data, uint64 expiry) external view {
        if (data.length > 512) revert BadData();
        (bytes32 eventKey, uint64 closeTime, bytes32 rulesHash) = decode(data);
        EventRecord storage e = _events[eventKey];
        if (!e.registered) revert UnknownEvent();
        if (e.closeTime != closeTime) revert CloseTimeMismatch();
        if (e.rulesHash != rulesHash) revert RulesHashMismatch();
        if (expiry != closeTime) revert ExpiryMismatch();
        if (closeTime <= block.timestamp) revert AlreadyClosed();
    }

    /// @inheritdoc IResolver
    /// @dev Ready only after Book expiry AND a Yes/No outcome that is either finalized or an
    ///      undisputed proposal whose challenge window has elapsed. Invalid stays not-ready so
    ///      the Book voids after VOID_GRACE.
    function resolve(bytes calldata data, uint64 expiry) external view returns (bool ready, bool yes) {
        if (block.timestamp <= expiry) return (false, false);
        (bytes32 eventKey,,) = decode(data);
        (bool have, EventOutcome outcome) = _finalOutcome(eventKey);
        if (!have) return (false, false);
        if (outcome == EventOutcome.Yes) return (true, true);
        if (outcome == EventOutcome.No) return (true, false);
        return (false, false);
    }

    /// @inheritdoc IResolver
    function describe(bytes calldata data, uint64) external view returns (string memory) {
        (bytes32 eventKey,,) = decode(data);
        EventRecord storage e = _events[eventKey];
        if (e.registered && bytes(e.question).length != 0) return e.question;
        return string.concat("event ", LibString.toHexString(uint256(eventKey), 32));
    }

    // ───────────────────────── encoding ─────────────────────────

    function eventKeyOf(string memory key) public pure returns (bytes32) {
        return keccak256(bytes(key));
    }

    function encode(bytes32 eventKey, uint64 closeTime, bytes32 rulesHash) public pure returns (bytes memory) {
        return abi.encode(eventKey, closeTime, rulesHash);
    }

    function decode(bytes calldata data) public pure returns (bytes32 eventKey, uint64 closeTime, bytes32 rulesHash) {
        if (data.length != EVENT_DATA_LENGTH) revert BadData();
        (eventKey, closeTime, rulesHash) = abi.decode(data, (bytes32, uint64, bytes32));
    }

    /// @notice abi-encoded series payload for a registered event (`expiry` must equal `closeTime`).
    function seriesData(bytes32 eventKey) external view returns (bytes memory) {
        EventRecord storage e = _events[eventKey];
        if (!e.registered) revert UnknownEvent();
        return abi.encode(eventKey, e.closeTime, e.rulesHash);
    }

    // ───────────────────────── views ─────────────────────────

    function eventCount() external view returns (uint256) {
        return _eventKeys.length;
    }

    function eventKeyAt(uint256 index) external view returns (bytes32) {
        if (index >= _eventKeys.length) revert UnknownEvent();
        return _eventKeys[index];
    }

    function eventInfo(bytes32 eventKey) external view returns (EventView memory view_) {
        EventRecord storage e = _events[eventKey];
        if (!e.registered) revert UnknownEvent();
        EventProposal storage p = _proposals[eventKey];
        (EventStatus st, EventOutcome oc) = _statusAndOutcome(eventKey, e, p);
        view_ = EventView({
            key: e.key,
            question: e.question,
            rules: e.rules,
            source: e.source,
            category: e.category,
            icon: e.icon,
            closeTime: e.closeTime,
            rulesHash: e.rulesHash,
            status: st,
            outcome: oc,
            proposer: p.proposer,
            disputer: p.disputer,
            proposedAt: p.proposedAt,
            bond: p.bond
        });
    }

    function status(bytes32 eventKey) external view returns (EventStatus) {
        EventRecord storage e = _events[eventKey];
        if (!e.registered) revert UnknownEvent();
        (EventStatus st,) = _statusAndOutcome(eventKey, e, _proposals[eventKey]);
        return st;
    }

    function proposal(bytes32 eventKey) external view returns (EventProposal memory) {
        return _proposals[eventKey];
    }

    // ───────────────────────── internals ─────────────────────────

    function _finalOutcome(bytes32 eventKey) internal view returns (bool have, EventOutcome outcome) {
        EventRecord storage e = _events[eventKey];
        if (e.finalized) return (true, e.finalOutcome);
        EventProposal storage p = _proposals[eventKey];
        if (
            p.proposer != address(0) && p.disputer == address(0)
                && block.timestamp >= uint256(p.proposedAt) + p.window
        ) {
            return (true, p.outcome);
        }
        return (false, EventOutcome.None);
    }

    function _statusAndOutcome(bytes32 eventKey, EventRecord storage e, EventProposal storage p)
        internal
        view
        returns (EventStatus st, EventOutcome oc)
    {
        (bool have, EventOutcome outcome) = _finalOutcome(eventKey);
        if (have) {
            oc = outcome;
            st = outcome == EventOutcome.Invalid ? EventStatus.Invalid : EventStatus.Resolved;
            return (st, oc);
        }
        if (p.disputer != address(0)) return (EventStatus.Disputed, EventOutcome.None);
        if (p.proposer != address(0)) return (EventStatus.Proposed, EventOutcome.None);
        if (block.timestamp >= e.closeTime) return (EventStatus.Closed, EventOutcome.None);
        return (EventStatus.Open, EventOutcome.None);
    }

    function _validateNewEvent(EventRegistration calldata p) private view {
        _assertField(p.key, 1, MAX_KEY_BYTES);
        _assertField(p.question, 1, MAX_QUESTION_BYTES);
        _assertField(p.rules, 1, MAX_RULES_BYTES);
        _assertField(p.source, 1, MAX_SOURCE_BYTES);
        _assertField(p.category, 1, MAX_CATEGORY_BYTES);
        _assertField(p.icon, 0, MAX_ICON_BYTES);
        _assertCategory(p.category);
        if (p.closeTime <= block.timestamp) revert BadCloseTime();
    }

    function _assertField(string calldata value, uint256 minLen, uint256 maxLen) private pure {
        uint256 len = bytes(value).length;
        if (len < minLen) revert EmptyField();
        if (len > maxLen) revert FieldTooLong();
    }

    function _assertCategory(string calldata category) private pure {
        bytes32 h = keccak256(bytes(category));
        if (
            h == keccak256("crypto") || h == keccak256("macro") || h == keccak256("politics")
                || h == keccak256("sports") || h == keccak256("tech") || h == keccak256("culture")
                || h == keccak256("other")
        ) return;
        revert BadCategory();
    }

    function _pullBond(address from, uint256 amount) private {
        uint256 before = collateral.balanceOf(address(this));
        collateral.safeTransferFrom(from, address(this), amount);
        if (collateral.balanceOf(address(this)) - before != amount) revert BondTransferMismatch();
    }

    function _bondPayout(uint256 bond) private view returns (uint256 winnerPayout, uint256 fee) {
        uint256 total = bond * 2;
        fee = (total * arbitrationFeeBps) / _BPS_DENOM;
        winnerPayout = total - fee;
    }

    function _payWinner(address winner, uint256 winnerPayout, uint256 fee) private {
        if (fee != 0) collateral.safeTransfer(treasury, fee);
        if (winnerPayout != 0) collateral.safeTransfer(winner, winnerPayout);
    }
}
