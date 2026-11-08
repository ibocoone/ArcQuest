// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArcQuestVaultTestBase} from "./ArcQuestVault.Base.t.sol";
import {ArcQuestVault} from "../ArcQuestVault.sol";

/// approve / reject / finalize / dispute / releaseRejected timing and events.
contract ArcQuestVaultLifecycleTest is ArcQuestVaultTestBase {
    function _invalidState(address w, ArcQuestVault.ClaimStatus st) internal view returns (bytes memory) {
        return abi.encodeWithSelector(ArcQuestVault.InvalidClaimState.selector, JOB, w, st);
    }

    // ---------- approveClaim ----------

    function test_Approve_CreditsWorkerAndUnlocks() public {
        _jobWithPendingClaim();
        vm.prank(funder);
        vault.approveClaim(JOB, worker);
        assertEq(vault.balanceOf(worker), REWARD);
        (uint32 active,, uint256 locked) = _job();
        assertEq(locked, 0);
        assertEq(active, 1);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Paid));
    }

    function test_Approve_EmitsClaimPaidApproved() public {
        _jobWithPendingClaim();
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.ClaimPaid(JOB, worker, REWARD, ArcQuestVault.PayReason.Approved);
        vault.approveClaim(JOB, worker);
    }

    function test_Approve_StillPossibleAfterReviewPeriod() public {
        _jobWithPendingClaim();
        skip(DEFAULT_REVIEW + 5 days);
        vm.prank(funder);
        vault.approveClaim(JOB, worker);
        assertEq(vault.balanceOf(worker), REWARD);
    }

    function test_Approve_RevertsForNonFunder() public {
        _jobWithPendingClaim();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotFunder.selector, other, funder));
        vault.approveClaim(JOB, worker);
    }

    function test_Approve_RevertsForNonPendingAndUnknown() public {
        _jobWithPendingClaim();
        vm.startPrank(funder);
        vm.expectRevert(_invalidState(worker2, ArcQuestVault.ClaimStatus.None));
        vault.approveClaim(JOB, worker2);
        vault.approveClaim(JOB, worker);
        vm.expectRevert(_invalidState(worker, ArcQuestVault.ClaimStatus.Paid)); // no double pay
        vault.approveClaim(JOB, worker);
        vm.expectRevert(ArcQuestVault.JobNotFound.selector);
        vault.approveClaim(keccak256("nope"), worker);
        vm.stopPrank();
    }

    // ---------- rejectClaim ----------

    function test_Reject_SetsRejectedRestartsClockKeepsFundsLocked() public {
        _jobWithPendingClaim();
        skip(1 days);
        _reject(worker);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Rejected));
        assertEq(_claimAt(worker), T0 + 1 days);
        (uint32 active,, uint256 locked) = _job();
        assertEq(locked, REWARD);
        assertEq(active, 1);
        assertEq(vault.balanceOf(worker), 0);
    }

    function test_Reject_EmitsClaimRejected() public {
        _jobWithPendingClaim();
        vm.prank(funder);
        vm.expectEmit(true, true, false, false, address(vault));
        emit ArcQuestVault.ClaimRejected(JOB, worker);
        vault.rejectClaim(JOB, worker);
    }

    function test_Reject_AllowedOneSecondBeforeReviewEnd() public {
        _jobWithPendingClaim();
        skip(DEFAULT_REVIEW - 1);
        _reject(worker);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Rejected));
    }

    function test_Reject_RevertsAtReviewEnd() public {
        _jobWithPendingClaim();
        skip(DEFAULT_REVIEW);
        vm.prank(funder);
        vm.expectRevert(
            abi.encodeWithSelector(ArcQuestVault.ReviewPeriodOver.selector, JOB, worker, T0 + DEFAULT_REVIEW)
        );
        vault.rejectClaim(JOB, worker);
    }

    function test_Reject_RevertsForNonFunderAndNonPending() public {
        _jobWithPendingClaim();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotFunder.selector, other, funder));
        vault.rejectClaim(JOB, worker);
        _reject(worker);
        vm.prank(funder);
        vm.expectRevert(_invalidState(worker, ArcQuestVault.ClaimStatus.Rejected));
        vault.rejectClaim(JOB, worker);
    }

    function test_Reject_UsesJobCustomReviewPeriod() public {
        _newJobWith(JOB, REWARD, SLOTS, _deadline(), uint32(7 days));
        _claim(worker);
        skip(5 days); // beyond default, within custom
        _reject(worker);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Rejected));
    }

    // ---------- finalizeClaim ----------

    function test_Finalize_RevertsOneSecondBeforeReviewEnd() public {
        _jobWithPendingClaim();
        skip(DEFAULT_REVIEW - 1);
        vm.expectRevert(
            abi.encodeWithSelector(ArcQuestVault.ReviewPeriodNotOver.selector, JOB, worker, T0 + DEFAULT_REVIEW)
        );
        vault.finalizeClaim(JOB, worker);
    }

    function test_Finalize_AnyoneCanPayAtReviewEnd() public {
        _jobWithPendingClaim();
        skip(DEFAULT_REVIEW);
        vm.prank(other);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.ClaimPaid(JOB, worker, REWARD, ArcQuestVault.PayReason.AutoApproved);
        vault.finalizeClaim(JOB, worker);
        assertEq(vault.balanceOf(worker), REWARD);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Paid));
        (,, uint256 locked) = _job();
        assertEq(locked, 0);
    }

    function test_Finalize_RevertsForNonPending() public {
        _jobWithPendingClaim();
        skip(1 days);
        _reject(worker);
        skip(DEFAULT_REVIEW);
        vm.expectRevert(_invalidState(worker, ArcQuestVault.ClaimStatus.Rejected));
        vault.finalizeClaim(JOB, worker);
        vm.expectRevert(_invalidState(worker2, ArcQuestVault.ClaimStatus.None));
        vault.finalizeClaim(JOB, worker2);
        vm.expectRevert(ArcQuestVault.JobNotFound.selector);
        vault.finalizeClaim(keccak256("nope"), worker);
    }

    function test_Finalize_CannotPayTwice() public {
        _jobWithPendingClaim();
        skip(DEFAULT_REVIEW);
        vault.finalizeClaim(JOB, worker);
        vm.expectRevert(_invalidState(worker, ArcQuestVault.ClaimStatus.Paid));
        vault.finalizeClaim(JOB, worker);
    }

    // ---------- disputeClaim ----------

    function test_Dispute_SetsDisputedAndEmits() public {
        _jobWithPendingClaim();
        skip(1 days);
        _reject(worker);
        skip(2 days);
        vm.prank(worker);
        vm.expectEmit(true, true, false, false, address(vault));
        emit ArcQuestVault.ClaimDisputed(JOB, worker);
        vault.disputeClaim(JOB);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Disputed));
        assertEq(_claimAt(worker), T0 + 3 days); // clock restarted
        (,, uint256 locked) = _job();
        assertEq(locked, REWARD);
    }

    function test_Dispute_AllowedAtInclusiveWindowEnd() public {
        _jobWithPendingClaim();
        _reject(worker);
        skip(DISPUTE_WINDOW);
        _dispute(worker);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Disputed));
    }

    function test_Dispute_RevertsOneSecondAfterWindow() public {
        _jobWithPendingClaim();
        _reject(worker);
        skip(DISPUTE_WINDOW + 1);
        vm.prank(worker);
        vm.expectRevert(
            abi.encodeWithSelector(ArcQuestVault.DisputeWindowClosed.selector, JOB, worker, T0 + DISPUTE_WINDOW)
        );
        vault.disputeClaim(JOB);
    }

    function test_Dispute_RevertsWhenNotRejected() public {
        _jobWithPendingClaim();
        vm.prank(worker); // pending
        vm.expectRevert(_invalidState(worker, ArcQuestVault.ClaimStatus.Pending));
        vault.disputeClaim(JOB);
        vm.prank(worker2); // none
        vm.expectRevert(_invalidState(worker2, ArcQuestVault.ClaimStatus.None));
        vault.disputeClaim(JOB);
        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.JobNotFound.selector);
        vault.disputeClaim(keccak256("nope"));
    }

    function test_Dispute_OnlyTheWorkerCanDisputeOwnClaim() public {
        _jobWithPendingClaim();
        _reject(worker);
        vm.prank(other);
        vm.expectRevert(_invalidState(other, ArcQuestVault.ClaimStatus.None));
        vault.disputeClaim(JOB);
    }

    function test_Dispute_CannotDisputeTwice() public {
        _jobWithPendingClaim();
        _reject(worker);
        _dispute(worker);
        vm.prank(worker);
        vm.expectRevert(_invalidState(worker, ArcQuestVault.ClaimStatus.Disputed));
        vault.disputeClaim(JOB);
    }

    // ---------- releaseRejected ----------

    function test_ReleaseRejected_RevertsAtInclusiveWindowEnd() public {
        _jobWithPendingClaim();
        _reject(worker);
        skip(DISPUTE_WINDOW);
        vm.expectRevert(
            abi.encodeWithSelector(ArcQuestVault.DisputeWindowOpen.selector, JOB, worker, T0 + DISPUTE_WINDOW)
        );
        vault.releaseRejected(JOB, worker);
    }

    function test_ReleaseRejected_AnyoneCanReleaseAfterWindow() public {
        _jobWithPendingClaim();
        _reject(worker);
        skip(DISPUTE_WINDOW + 1);
        vm.prank(other);
        vm.expectEmit(true, true, false, false, address(vault));
        emit ArcQuestVault.ClaimRefunded(JOB, worker);
        vault.releaseRejected(JOB, worker);

        (uint32 active, uint256 esc, uint256 locked) = _job();
        assertEq(active, 0);
        assertEq(locked, 0);
        assertEq(esc, uint256(REWARD) * SLOTS);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Refunded));
        assertEq(vault.balanceOf(worker), 0);
    }

    function test_ReleaseRejected_RevertsForNonRejected() public {
        _jobWithPendingClaim();
        vm.expectRevert(_invalidState(worker, ArcQuestVault.ClaimStatus.Pending));
        vault.releaseRejected(JOB, worker);
        _reject(worker);
        _dispute(worker);
        skip(DISPUTE_WINDOW + 1);
        vm.expectRevert(_invalidState(worker, ArcQuestVault.ClaimStatus.Disputed));
        vault.releaseRejected(JOB, worker);
        vm.expectRevert(ArcQuestVault.JobNotFound.selector);
        vault.releaseRejected(keccak256("nope"), worker);
    }

    function test_ReleaseRejected_CannotRunTwice() public {
        _jobWithPendingClaim();
        _reject(worker);
        skip(DISPUTE_WINDOW + 1);
        vault.releaseRejected(JOB, worker);
        vm.expectRevert(_invalidState(worker, ArcQuestVault.ClaimStatus.Refunded));
        vault.releaseRejected(JOB, worker);
    }

    function test_DisputeAfterWindowThenReleaseRace_WorkerLosesOnlyAfterWindow() public {
        _jobWithPendingClaim();
        _reject(worker);
        skip(DISPUTE_WINDOW); // last valid dispute second; release not yet allowed
        vm.expectRevert();
        vault.releaseRejected(JOB, worker);
        _dispute(worker);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Disputed));
    }
}
