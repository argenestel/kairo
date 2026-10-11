// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {OptimisticEventResolver} from "../../src/resolvers/OptimisticEventResolver.sol";
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
    DEFAULT_BOND_AMOUNT,
    EVENT_DATA_LENGTH
} from "../../src/resolvers/events/EventTypes.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";

contract OptimisticEventResolverTest is Test {
    uint64 internal constant START = 1_800_000_000;

    TestUSDC internal usdc;
    OptimisticEventResolver internal resolver;

    address internal constant OWNER = address(0xA11CE);
    address internal constant CURATOR = address(0xC0DA);
    address internal constant ARBITRATOR = address(0xA4B17);
    address internal constant TREASURY = address(0xFEE);
    address internal constant PROPOSER = address(0xB0B);
    address internal constant DISPUTER = address(0xD15);
    address internal constant STRANGER = address(0xBEEF);

    bytes32 internal eventKey;
    uint64 internal closeTime;
    bytes32 internal rulesHash;
    string internal constant RULES = "YES iff the test flag is true at close. Source: this test.";

    function setUp() public {
        vm.warp(START);
        usdc = new TestUSDC(address(this));
        resolver = new OptimisticEventResolver(address(usdc), OWNER, TREASURY, ARBITRATOR);
        vm.prank(OWNER);
        resolver.setCurator(CURATOR);

        closeTime = uint64(START + 1 days);
        rulesHash = keccak256(bytes(RULES));
        vm.prank(CURATOR);
        resolver.registerEvent(
            EventRegistration({
                key: "TEST-EVENT",
                question: "Will the test event resolve YES?",
                rules: RULES,
                source: "https://example.com/rules",
                closeTime: closeTime,
                category: "other",
                icon: "t"
            })
        );
        eventKey = resolver.eventKeyOf("TEST-EVENT");

        usdc.mint(PROPOSER, 10_000e6);
        usdc.mint(DISPUTER, 10_000e6);
        vm.prank(PROPOSER);
        usdc.approve(address(resolver), type(uint256).max);
        vm.prank(DISPUTER);
        usdc.approve(address(resolver), type(uint256).max);
    }

    function _reg(
        string memory key,
        string memory question,
        string memory rules,
        string memory source,
        uint64 close,
        string memory category,
        string memory icon
    ) internal pure returns (EventRegistration memory p) {
        p = EventRegistration({
            key: key,
            question: question,
            rules: rules,
            source: source,
            closeTime: close,
            category: category,
            icon: icon
        });
    }

    function _data() internal view returns (bytes memory) {
        return resolver.encode(eventKey, closeTime, rulesHash);
    }

    function _warpClosed() internal {
        vm.warp(closeTime);
    }

    function testRegisterAndViews() public view {
        assertEq(resolver.eventCount(), 1);
        assertEq(resolver.eventKeyAt(0), eventKey);
        EventView memory info = resolver.eventInfo(eventKey);
        assertEq(info.key, "TEST-EVENT");
        assertEq(info.question, "Will the test event resolve YES?");
        assertEq(info.rules, RULES);
        assertEq(info.source, "https://example.com/rules");
        assertEq(info.category, "other");
        assertEq(info.icon, "t");
        assertEq(info.closeTime, closeTime);
        assertEq(info.rulesHash, rulesHash);
        assertEq(uint256(info.status), uint256(EventStatus.Open));
        assertEq(uint256(info.outcome), uint256(EventOutcome.None));
        assertEq(uint256(resolver.status(eventKey)), uint256(EventStatus.Open));
        assertEq(resolver.challengeWindow(), DEFAULT_CHALLENGE_WINDOW);
        assertEq(resolver.bondAmount(), DEFAULT_BOND_AMOUNT);
        assertEq(resolver.arbitrationFeeBps(), DEFAULT_ARBITRATION_FEE_BPS);
        assertEq(resolver.curator(), CURATOR);
        assertEq(resolver.arbitrator(), ARBITRATOR);
        assertEq(resolver.treasury(), TREASURY);
    }

    function testEncodeDecodeAndSeriesData() public view {
        bytes memory data = _data();
        assertEq(data.length, EVENT_DATA_LENGTH);
        (bytes32 k, uint64 c, bytes32 r) = resolver.decode(data);
        assertEq(k, eventKey);
        assertEq(c, closeTime);
        assertEq(r, rulesHash);
        assertEq(resolver.seriesData(eventKey), data);
        resolver.validate(data, closeTime);
        assertEq(resolver.describe(data, closeTime), "Will the test event resolve YES?");
    }

    function testValidateRejectsMismatchedRulesHashCloseTimeAndExpiry() public {
        bytes memory badHash = resolver.encode(eventKey, closeTime, bytes32(uint256(1)));
        vm.expectRevert(OptimisticEventResolver.RulesHashMismatch.selector);
        resolver.validate(badHash, closeTime);

        bytes memory badClose = resolver.encode(eventKey, closeTime + 1, rulesHash);
        vm.expectRevert(OptimisticEventResolver.CloseTimeMismatch.selector);
        resolver.validate(badClose, closeTime + 1);

        bytes memory ok = _data();
        vm.expectRevert(OptimisticEventResolver.ExpiryMismatch.selector);
        resolver.validate(ok, closeTime + 1);

        bytes memory missing = resolver.encode(keccak256("nope"), closeTime, rulesHash);
        vm.expectRevert(OptimisticEventResolver.UnknownEvent.selector);
        resolver.validate(missing, closeTime);

        vm.expectRevert(OptimisticEventResolver.BadData.selector);
        resolver.validate(new bytes(0), closeTime);

        bytes memory extra = bytes.concat(ok, bytes1(0));
        vm.expectRevert(OptimisticEventResolver.BadData.selector);
        resolver.validate(extra, closeTime);

        vm.warp(closeTime);
        vm.expectRevert(OptimisticEventResolver.AlreadyClosed.selector);
        resolver.validate(ok, closeTime);
    }

    function testFuzzRejectsOversizeData(uint16 extra) public {
        uint256 length = 513 + uint256(extra % 256);
        bytes memory padded = bytes.concat(_data(), new bytes(length - EVENT_DATA_LENGTH));
        vm.expectRevert(OptimisticEventResolver.BadData.selector);
        resolver.validate(padded, closeTime);
    }

    function testRegisterRejectsUnauthorisedDuplicateBadCategoryAndBounds() public {
        vm.prank(STRANGER);
        vm.expectRevert(OptimisticEventResolver.NotCurator.selector);
        resolver.registerEvent(_reg("X", "q", "r", "https://x", closeTime + 1, "other", ""));

        vm.prank(CURATOR);
        vm.expectRevert(OptimisticEventResolver.EventExists.selector);
        resolver.registerEvent(_reg("TEST-EVENT", "q", "r", "https://x", closeTime + 1, "other", ""));

        vm.prank(CURATOR);
        vm.expectRevert(OptimisticEventResolver.BadCategory.selector);
        resolver.registerEvent(_reg("K2", "q", "r", "https://x", closeTime + 1, "finance", ""));

        vm.prank(CURATOR);
        vm.expectRevert(OptimisticEventResolver.BadCloseTime.selector);
        resolver.registerEvent(_reg("K3", "q", "r", "https://x", uint64(block.timestamp), "crypto", ""));

        vm.prank(CURATOR);
        vm.expectRevert(OptimisticEventResolver.EmptyField.selector);
        resolver.registerEvent(_reg("", "q", "r", "https://x", closeTime + 1, "crypto", ""));

        vm.prank(OWNER);
        resolver.registerEvent(_reg("OWNER-KEY", "owner listed", "rules-ok", "https://x", closeTime + 10, "macro", ""));
        assertEq(resolver.eventCount(), 2);
    }

    function testProposeBeforeCloseRevertsAndStatusTransitions() public {
        vm.prank(PROPOSER);
        vm.expectRevert(OptimisticEventResolver.EventNotClosed.selector);
        resolver.propose(eventKey, EventOutcome.Yes);

        (bool ready, bool yes) = resolver.resolve(_data(), closeTime);
        assertFalse(ready);
        assertFalse(yes);

        _warpClosed();
        assertEq(uint256(resolver.status(eventKey)), uint256(EventStatus.Closed));

        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);
        assertEq(uint256(resolver.status(eventKey)), uint256(EventStatus.Proposed));
        assertEq(usdc.balanceOf(address(resolver)), DEFAULT_BOND_AMOUNT);
        assertEq(usdc.balanceOf(PROPOSER), 10_000e6 - DEFAULT_BOND_AMOUNT);

        EventProposal memory p = resolver.proposal(eventKey);
        assertEq(p.proposer, PROPOSER);
        assertEq(uint256(p.outcome), uint256(EventOutcome.Yes));
        assertEq(p.bond, DEFAULT_BOND_AMOUNT);
        assertEq(p.window, DEFAULT_CHALLENGE_WINDOW);

        vm.prank(PROPOSER);
        vm.expectRevert(OptimisticEventResolver.ProposalExists.selector);
        resolver.propose(eventKey, EventOutcome.No);
    }

    function testUndisputedYesIsViewReadyThenFinalizeReturnsBond() public {
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);

        vm.expectRevert(OptimisticEventResolver.ChallengePending.selector);
        resolver.finalize(eventKey);

        bytes memory payload = _data();
        (bool ready,) = resolver.resolve(payload, closeTime);
        assertFalse(ready); // timestamp == expiry

        vm.warp(uint256(closeTime) + 1);
        (ready,) = resolver.resolve(payload, closeTime);
        assertFalse(ready); // past expiry but still in the challenge window

        vm.warp(uint256(closeTime) + DEFAULT_CHALLENGE_WINDOW);
        bool yes;
        (ready, yes) = resolver.resolve(payload, closeTime);
        assertTrue(ready);
        assertTrue(yes);
        assertEq(uint256(resolver.status(eventKey)), uint256(EventStatus.Resolved));

        uint256 before = usdc.balanceOf(PROPOSER);
        resolver.finalize(eventKey);
        assertEq(usdc.balanceOf(PROPOSER), before + DEFAULT_BOND_AMOUNT);
        assertEq(usdc.balanceOf(address(resolver)), 0);
        EventView memory info = resolver.eventInfo(eventKey);
        assertTrue(info.status == EventStatus.Resolved);
        assertEq(uint256(info.outcome), uint256(EventOutcome.Yes));
        assertEq(info.proposer, address(0));

        vm.expectRevert(OptimisticEventResolver.AlreadyFinalized.selector);
        resolver.finalize(eventKey);
    }

    function testUndisputedNo() public {
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.No);
        vm.warp(uint256(closeTime) + DEFAULT_CHALLENGE_WINDOW + 1);
        (bool ready, bool yes) = resolver.resolve(_data(), closeTime);
        assertTrue(ready);
        assertFalse(yes);
    }

    function testInvalidStaysNotReady() public {
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Invalid);
        vm.warp(uint256(closeTime) + DEFAULT_CHALLENGE_WINDOW + 1);
        (bool ready, bool yes) = resolver.resolve(_data(), closeTime);
        assertFalse(ready);
        assertFalse(yes);
        assertEq(uint256(resolver.status(eventKey)), uint256(EventStatus.Invalid));
        resolver.finalize(eventKey);
        (ready, yes) = resolver.resolve(_data(), closeTime);
        assertFalse(ready);
        assertFalse(yes);
    }

    function testDisputeAndArbitrateProposerWins() public {
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);
        vm.prank(DISPUTER);
        resolver.dispute(eventKey);
        assertEq(uint256(resolver.status(eventKey)), uint256(EventStatus.Disputed));
        assertEq(usdc.balanceOf(address(resolver)), 2 * DEFAULT_BOND_AMOUNT);

        (bool ready,) = resolver.resolve(_data(), closeTime);
        assertFalse(ready);
        vm.expectRevert(OptimisticEventResolver.AlreadyDisputed.selector);
        resolver.finalize(eventKey);

        uint256 fee = (2 * DEFAULT_BOND_AMOUNT * DEFAULT_ARBITRATION_FEE_BPS) / 10_000;
        uint256 payout = 2 * DEFAULT_BOND_AMOUNT - fee;
        uint256 proposerBefore = usdc.balanceOf(PROPOSER);
        uint256 treasuryBefore = usdc.balanceOf(TREASURY);

        vm.prank(ARBITRATOR);
        resolver.arbitrate(eventKey, EventOutcome.Yes);

        assertEq(usdc.balanceOf(PROPOSER), proposerBefore + payout);
        assertEq(usdc.balanceOf(TREASURY), treasuryBefore + fee);
        assertEq(usdc.balanceOf(address(resolver)), 0);
        assertEq(usdc.balanceOf(DISPUTER), 10_000e6 - DEFAULT_BOND_AMOUNT);
        bool yes;
        (ready, yes) = resolver.resolve(_data(), closeTime);
        vm.warp(uint256(closeTime) + 1);
        (ready, yes) = resolver.resolve(_data(), closeTime);
        assertTrue(ready);
        assertTrue(yes);
    }

    function testDisputeAndArbitrateDisputerWins() public {
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);
        vm.prank(DISPUTER);
        resolver.dispute(eventKey);

        uint256 fee = (2 * DEFAULT_BOND_AMOUNT * DEFAULT_ARBITRATION_FEE_BPS) / 10_000;
        uint256 payout = 2 * DEFAULT_BOND_AMOUNT - fee;
        uint256 disputerBefore = usdc.balanceOf(DISPUTER);

        vm.prank(ARBITRATOR);
        resolver.arbitrate(eventKey, EventOutcome.No);

        assertEq(usdc.balanceOf(DISPUTER), disputerBefore + payout);
        vm.warp(uint256(closeTime) + 1);
        (bool ready, bool yes) = resolver.resolve(_data(), closeTime);
        assertTrue(ready);
        assertFalse(yes);
    }

    function testArbitrateInvalidPaysDisputerIfProposalWasYes() public {
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);
        vm.prank(DISPUTER);
        resolver.dispute(eventKey);
        vm.prank(ARBITRATOR);
        resolver.arbitrate(eventKey, EventOutcome.Invalid);
        vm.warp(uint256(closeTime) + 1);
        (bool ready,) = resolver.resolve(_data(), closeTime);
        assertFalse(ready);
        assertEq(uint256(resolver.status(eventKey)), uint256(EventStatus.Invalid));
        assertEq(usdc.balanceOf(DISPUTER), 10_000e6 - DEFAULT_BOND_AMOUNT + (2 * DEFAULT_BOND_AMOUNT - (2 * DEFAULT_BOND_AMOUNT * 500) / 10_000));
    }

    function testRejectProposalAllowsReProposal() public {
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);
        vm.prank(DISPUTER);
        resolver.dispute(eventKey);

        uint256 fee = (2 * DEFAULT_BOND_AMOUNT * 500) / 10_000;
        uint256 payout = 2 * DEFAULT_BOND_AMOUNT - fee;
        uint256 disputerBefore = usdc.balanceOf(DISPUTER);

        vm.prank(ARBITRATOR);
        resolver.rejectProposal(eventKey);

        assertEq(usdc.balanceOf(DISPUTER), disputerBefore + payout);
        assertEq(uint256(resolver.status(eventKey)), uint256(EventStatus.Closed));
        EventProposal memory p = resolver.proposal(eventKey);
        assertEq(p.proposer, address(0));

        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.No);
        assertEq(uint256(resolver.status(eventKey)), uint256(EventStatus.Proposed));
        assertEq(uint256(resolver.proposal(eventKey).outcome), uint256(EventOutcome.No));
    }

    function testTimingEdgesDisputeWindow() public {
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);

        vm.prank(PROPOSER);
        vm.expectRevert(OptimisticEventResolver.SelfDispute.selector);
        resolver.dispute(eventKey);

        vm.warp(uint256(closeTime) + DEFAULT_CHALLENGE_WINDOW);
        vm.prank(DISPUTER);
        vm.expectRevert(OptimisticEventResolver.ChallengeExpired.selector);
        resolver.dispute(eventKey);

        vm.warp(closeTime + DEFAULT_CHALLENGE_WINDOW - 1);
        vm.prank(DISPUTER);
        resolver.dispute(eventKey);
        assertEq(resolver.proposal(eventKey).disputer, DISPUTER);
    }

    function testUnauthorisedAdminAndArbitrate() public {
        vm.prank(STRANGER);
        vm.expectRevert(Ownable.Unauthorized.selector);
        resolver.setChallengeWindow(1 hours);

        vm.prank(STRANGER);
        vm.expectRevert(Ownable.Unauthorized.selector);
        resolver.setBondAmount(200e6);

        vm.prank(STRANGER);
        vm.expectRevert(Ownable.Unauthorized.selector);
        resolver.setArbitrationFeeBps(100);

        vm.prank(STRANGER);
        vm.expectRevert(Ownable.Unauthorized.selector);
        resolver.setArbitrator(STRANGER);

        vm.prank(STRANGER);
        vm.expectRevert(OptimisticEventResolver.NotArbitrator.selector);
        resolver.arbitrate(eventKey, EventOutcome.Yes);

        vm.prank(STRANGER);
        vm.expectRevert(OptimisticEventResolver.NotArbitrator.selector);
        resolver.rejectProposal(eventKey);

        vm.prank(OWNER);
        vm.expectRevert(OptimisticEventResolver.ChallengeWindowOutOfBounds.selector);
        resolver.setChallengeWindow(MIN_CHALLENGE_WINDOW - 1);

        vm.prank(OWNER);
        vm.expectRevert(OptimisticEventResolver.ChallengeWindowOutOfBounds.selector);
        resolver.setChallengeWindow(MAX_CHALLENGE_WINDOW + 1);

        vm.prank(OWNER);
        resolver.setChallengeWindow(30 minutes);
        assertEq(resolver.challengeWindow(), 30 minutes);

        vm.prank(OWNER);
        resolver.setBondAmount(250e6);
        vm.prank(OWNER);
        resolver.setArbitrationFeeBps(0);
        vm.prank(OWNER);
        resolver.setArbitrator(OWNER);
        vm.prank(OWNER);
        resolver.setTreasury(OWNER);
        assertEq(resolver.bondAmount(), 250e6);
        assertEq(resolver.arbitrationFeeBps(), 0);
        assertEq(resolver.arbitrator(), OWNER);
    }

    function testZeroFeeArbitrationSendsBothBondsToWinner() public {
        vm.prank(OWNER);
        resolver.setArbitrationFeeBps(0);
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.No);
        vm.prank(DISPUTER);
        resolver.dispute(eventKey);
        uint256 before = usdc.balanceOf(DISPUTER);
        vm.prank(ARBITRATOR);
        resolver.arbitrate(eventKey, EventOutcome.Yes);
        assertEq(usdc.balanceOf(DISPUTER), before + 2 * DEFAULT_BOND_AMOUNT);
        assertEq(usdc.balanceOf(TREASURY), 0);
    }

    function testProposeBadOutcomeAndUnknownEvent() public {
        _warpClosed();
        vm.prank(PROPOSER);
        vm.expectRevert(OptimisticEventResolver.BadOutcome.selector);
        resolver.propose(eventKey, EventOutcome.None);

        vm.prank(PROPOSER);
        vm.expectRevert(OptimisticEventResolver.UnknownEvent.selector);
        resolver.propose(keccak256("missing"), EventOutcome.Yes);
    }

    function testDescribeUnknownKeyFallsBackToHex() public view {
        bytes32 missing = keccak256("missing");
        bytes memory data = resolver.encode(missing, closeTime, rulesHash);
        string memory d = resolver.describe(data, closeTime);
        assertTrue(bytes(d).length > 8);
    }

    function testResolveUnderGasLimit() public {
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);
        vm.warp(uint256(closeTime) + DEFAULT_CHALLENGE_WINDOW + 1);
        uint256 before = gasleft();
        resolver.resolve(_data(), closeTime);
        uint256 used = before - gasleft();
        assertLt(used, 500_000);
    }

    function testProposalSnapshotsWindowAndBond() public {
        vm.prank(OWNER);
        resolver.setChallengeWindow(45 minutes);
        vm.prank(OWNER);
        resolver.setBondAmount(250e6);
        _warpClosed();
        vm.prank(PROPOSER);
        resolver.propose(eventKey, EventOutcome.Yes);
        EventProposal memory p = resolver.proposal(eventKey);
        assertEq(p.window, 45 minutes);
        assertEq(p.bond, 250e6);
        vm.prank(OWNER);
        resolver.setChallengeWindow(10 minutes);
        vm.prank(OWNER);
        resolver.setBondAmount(1e6);
        // Old proposal still uses the snapshot.
        vm.warp(uint256(closeTime) + 10 minutes);
        vm.prank(DISPUTER);
        resolver.dispute(eventKey);
        assertEq(usdc.balanceOf(address(resolver)), 500e6);
    }

    function testConstructorRejectsZero() public {
        vm.expectRevert(OptimisticEventResolver.ZeroAddress.selector);
        new OptimisticEventResolver(address(0), OWNER, TREASURY, ARBITRATOR);
        vm.expectRevert(OptimisticEventResolver.ZeroAddress.selector);
        new OptimisticEventResolver(address(usdc), address(0), TREASURY, ARBITRATOR);
        vm.expectRevert(OptimisticEventResolver.ZeroAddress.selector);
        new OptimisticEventResolver(address(usdc), OWNER, address(0), ARBITRATOR);
        vm.expectRevert(OptimisticEventResolver.ZeroAddress.selector);
        new OptimisticEventResolver(address(usdc), OWNER, TREASURY, address(0));
    }
}
