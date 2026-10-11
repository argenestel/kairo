// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared types for Kairo event markets (optimistic resolver + onchain catalog).
/// @dev Status values match the UI `EventInfo.status` contract, except Solidity uses `Invalid`
///      for the UI's `void` (Book 50/50) path. Outcome 0 is "none".
enum EventOutcome {
    None,
    Yes,
    No,
    Invalid
}

enum EventStatus {
    None,
    Open,
    Closed,
    Proposed,
    Disputed,
    Resolved,
    Invalid
}

/// @dev Bounds and defaults. Challenge window is owner-set; VOID_GRACE on the Book is 2 days.
uint64 constant DEFAULT_CHALLENGE_WINDOW = 2 hours;
uint64 constant MIN_CHALLENGE_WINDOW = 10 minutes;
uint64 constant MAX_CHALLENGE_WINDOW = 3 days;
uint16 constant DEFAULT_ARBITRATION_FEE_BPS = 500;
uint16 constant MAX_ARBITRATION_FEE_BPS = 2_000;
uint256 constant DEFAULT_BOND_AMOUNT = 100e6;
uint256 constant MIN_BOND_AMOUNT = 1e6;
uint256 constant MAX_BOND_AMOUNT = 1_000_000e6;
uint256 constant EVENT_DATA_LENGTH = 96;
uint256 constant MAX_KEY_BYTES = 64;
uint256 constant MAX_QUESTION_BYTES = 200;
uint256 constant MAX_RULES_BYTES = 768;
uint256 constant MAX_SOURCE_BYTES = 256;
uint256 constant MAX_CATEGORY_BYTES = 16;
uint256 constant MAX_ICON_BYTES = 24;

/// @notice Calldata for `registerEvent`. Packed as one argument to stay under the stack limit.
struct EventRegistration {
    string key;
    string question;
    string rules;
    string source;
    uint64 closeTime;
    string category;
    string icon;
}

/// @notice Catalog + resolution snapshot for UIs that read the resolver with no indexer.
struct EventView {
    string key;
    string question;
    string rules;
    string source;
    string category;
    string icon;
    uint64 closeTime;
    bytes32 rulesHash;
    EventStatus status;
    EventOutcome outcome;
    address proposer;
    address disputer;
    uint64 proposedAt;
    uint256 bond;
}

/// @notice Active assertion, if any. `window` is snapshotted at propose time.
struct EventProposal {
    address proposer;
    address disputer;
    uint64 proposedAt;
    uint64 window;
    EventOutcome outcome;
    uint256 bond;
}
