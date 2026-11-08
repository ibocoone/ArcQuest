// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArcQuestVaultTestBase} from "./ArcQuestVault.Base.t.sol";
import {ArcQuestVault} from "../ArcQuestVault.sol";

/// resolveDispute / expireDispute / reclaimJob.
/// _jobWithDisputedClaim(): claim at T0, rejected at T0+1d, disputed at T0+1d (dispute clock start).
contract ArcQuestVaultDisputeTest is ArcQuestVaultTestBase {
    uint256 internal constant D0 = T0 + 1 days; // dispute timestamp

    // ---------- resolveDispute ----------

    function test_Resolve_PayWorkerCreditsReward() public {
        _jobWithDisputedClaim();
        vm.prank(arbiter);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.ClaimPaid(JOB, worker, REWARD, ArcQuestVault.PayReason.ArbiterDecision);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.DisputeResolved(JOB, worker, true);
        vault.resolveDispute(JOB, worker, true);

        assertEq(vault.balanceOf(worker), REWARD);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Paid));
        (uint32 active,, uint256 locked) = _job();
        assertEq(locked, 0);
        assertEq(active, 1);
    }

    function test_Resolve_RefundFunderReturnsToJobEscrowAndFreesSlot() public {
        _jobWithDisputedClaim();
        vm.prank(arbiter);
        vm.expectEmit(true, true, false, false, address(vault));
        emit ArcQuestVault.ClaimRefunded(JOB, worker);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.DisputeResolved(JOB, worker, false);
        vault.resolveDispute(JOB, worker, false);

        assertEq(vault.balanceOf(worker), 0);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Refunded));
        (uint32 active, uint256 esc, uint256 locked) = _job();
        assertEq(locked, 0);
        assertEq(active, 0);
        assertEq(esc, uint256(REWARD) * SLOTS);
    }

    function test_Resolve_RevertsForNonArbiter() public {
        _jobWithDisputedClaim();
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotArbiter.selector, funder, arbiter));
        vault.resolveDispute(JOB, worker, false);
        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotArbiter.selector, worker, arbiter));
        vault.resolveDispute(JOB, worker, true);
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotArbiter.selector, signer, arbiter));
        vault.resolveDispute(JOB, worker, true);
    }

    function test_Resolve_AllowedOneSecondBeforeTimeout() public {
        _jobWithDisputedClaim();
        vm.warp(D0 + ARB_TIMEOUT - 1);
        vm.prank(arbiter);
        vault.resolveDispute(JOB, worker, true);
        assertEq(vault.balanceOf(worker), REWARD);
    }

    function test_Resolve_RevertsAtTimeoutBoundary() public {
        _jobWithDisputedClaim();
        vm.warp(D0 + ARB_TIMEOUT);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.ArbiterTimeoutReached.selector, JOB, worker));
        vault.resolveDispute(JOB, worker, true);
    }

    function test_Resolve_RevertsAfterTimeout() public {
        _jobWithDisputedClaim();
        vm.warp(D0 + ARB_TIMEOUT + 30 days);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.ArbiterTimeoutReached.selector, JOB, worker));
        vault.resolveDispute(JOB, worker, false);
    }

    function test_Resolve_TimeoutCountsFromDisputeNotRejection() public {
        _jobWithDisputedClaim(); // rejected and disputed at the same time; dispute later in another claim
        // second worker: claim now, reject now, dispute 6 days later
        _claim(worker2);
        _reject(worker2);
        skip(6 days);
        _dispute(worker2);
        uint256 d2 = block.timestamp;
        vm.warp(d2 + ARB_TIMEOUT - 1);
        vm.prank(arbiter);
        vault.resolveDispute(JOB, worker2, true);
        assertEq(vault.balanceOf(worker2), REWARD);
    }

    function test_Resolve_RevertsForNonDisputedAndUnknownJob() public {
        _jobWithPendingClaim();
        vm.startPrank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcQuestVault.InvalidClaimState.selector, JOB, worker, ArcQuestVault.ClaimStatus.Pending
            )
        );
        vault.resolveDispute(JOB, worker, true);
        vm.expectRevert(ArcQuestVault.JobNotFound.selector);
        vault.resolveDispute(keccak256("nope"), worker, true);
        vm.stopPrank();
    }

    function test_Resolve_CannotResolveTwice() public {
        _jobWithDisputedClaim();
        vm.startPrank(arbiter);
        vault.resolveDispute(JOB, worker, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcQuestVault.InvalidClaimState.selector, JOB, worker, ArcQuestVault.ClaimStatus.Paid
            )
        );
        vault.resolveDispute(JOB, worker, true);
        vm.stopPrank();
    }

    function test_Resolve_NewArbiterCanResolveAfterHandover() public {
        _jobWithDisputedClaim();
        vm.prank(arbiter);
        vault.proposeArbiter(other);
        vm.prank(other);
        vault.acceptArbiter();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotArbiter.selector, arbiter, other));
        vault.resolveDispute(JOB, worker, true);
        vm.prank(other);
        vault.resolveDispute(JOB, worker, true);
        assertEq(vault.balanceOf(worker), REWARD);
    }

    // ---------- expireDispute ----------

    function test_Expire_RevertsOneSecondBeforeTimeout() public {
        _jobWithDisputedClaim();
        vm.warp(D0 + ARB_TIMEOUT - 1);
        vm.expectRevert(
            abi.encodeWithSelector(ArcQuestVault.ArbiterTimeoutNotReached.selector, JOB, worker, D0 + ARB_TIMEOUT)
        );
        vault.expireDispute(JOB, worker);
    }

    function test_Expire_EvenRewardSplitsFiftyFifty() public {
        _jobWithDisputedClaim();
        uint256 funderBefore = vault.balanceOf(funder);
        vm.warp(D0 + ARB_TIMEOUT);
        vm.prank(other); // permissionless
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.DisputeExpired(JOB, worker, 50e6, 50e6);
        vault.expireDispute(JOB, worker);

        assertEq(vault.balanceOf(worker), 50e6);
        assertEq(vault.balanceOf(funder), funderBefore + 50e6);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Split));
        (uint32 active,, uint256 locked) = _job();
        assertEq(locked, 0);
        assertEq(active, 1); // Split still occupies its slot
    }

    function test_Expire_OddRewardRoundsInFunderFavor() public {
        _newJobWith(JOB, 101, 2, _deadline(), 0);
        _claim(worker);
        _reject(worker);
        _dispute(worker);
        uint256 funderBefore = vault.balanceOf(funder);
        skip(ARB_TIMEOUT);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.DisputeExpired(JOB, worker, 50, 51);
        vault.expireDispute(JOB, worker);
        assertEq(vault.balanceOf(worker), 50);
        assertEq(vault.balanceOf(funder), funderBefore + 51);
    }

    function test_Expire_OneUnitRewardGivesAllToFunder() public {
        _newJobWith(JOB, 1, 1, _deadline(), 0);
        _claim(worker);
        _reject(worker);
        _dispute(worker);
        uint256 funderBefore = vault.balanceOf(funder);
        skip(ARB_TIMEOUT);
        vault.expireDispute(JOB, worker);
        assertEq(vault.balanceOf(worker), 0);
        assertEq(vault.balanceOf(funder), funderBefore + 1);
    }

    function test_Expire_RevertsForNonDisputedAndUnknown() public {
        _jobWithPendingClaim();
        skip(ARB_TIMEOUT);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcQuestVault.InvalidClaimState.selector, JOB, worker, ArcQuestVault.ClaimStatus.Pending
            )
        );
        vault.expireDispute(JOB, worker);
        vm.expectRevert(ArcQuestVault.JobNotFound.selector);
        vault.expireDispute(keccak256("nope"), worker);
    }

    function test_Expire_CannotRunTwiceOrBeResolvedAfter() public {
        _jobWithDisputedClaim();
        vm.warp(D0 + ARB_TIMEOUT);
        vault.expireDispute(JOB, worker);
        bytes memory err = abi.encodeWithSelector(
            ArcQuestVault.InvalidClaimState.selector, JOB, worker, ArcQuestVault.ClaimStatus.Split
        );
        vm.expectRevert(err);
        vault.expireDispute(JOB, worker);
        vm.prank(arbiter);
        vm.expectRevert(err);
        vault.resolveDispute(JOB, worker, true);
    }

    function test_Expire_WorkerCannotReclaimAfterSplit() public {
        _jobWithDisputedClaim();
        vm.warp(D0 + ARB_TIMEOUT);
        vault.expireDispute(JOB, worker);
        uint64 expiry = uint64(block.timestamp + 1);
        vm.warp(block.timestamp); // no-op, keep clarity
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.AlreadyClaimed.selector);
        vault.submitClaim(JOB, expiry, sig);
    }

    // ---------- reclaimJob ----------

    function test_Reclaim_RevertsForNonFunder() public {
        _newJob();
        vm.warp(uint256(_deadline()) + 1);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotFunder.selector, other, funder));
        vault.reclaimJob(JOB);
    }

    function test_Reclaim_RevertsForUnknownJob() public {
        vm.prank(funder);
        vm.expectRevert(ArcQuestVault.JobNotFound.selector);
        vault.reclaimJob(keccak256("nope"));
    }

    function test_Reclaim_RevertsBeforeAndAtDeadline() public {
        _newJob();
        vm.startPrank(funder);
        vm.expectRevert(ArcQuestVault.JobStillOpen.selector);
        vault.reclaimJob(JOB);
        vm.warp(_deadline());
        vm.expectRevert(ArcQuestVault.JobStillOpen.selector);
        vault.reclaimJob(JOB);
        vm.stopPrank();
    }

    function test_Reclaim_ReturnsOnlyFreeEscrowAfterDeadline() public {
        _jobWithPendingClaim(); // 1 locked, 2 free
        uint256 before = vault.balanceOf(funder);
        vm.warp(uint256(_deadline()) + 1);
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.JobReclaimed(JOB, funder, 2 * uint256(REWARD));
        vault.reclaimJob(JOB);

        assertEq(vault.balanceOf(funder), before + 2 * uint256(REWARD));
        (, uint256 esc, uint256 locked) = _job();
        assertEq(esc, 0);
        assertEq(locked, REWARD); // untouched
    }

    function test_Reclaim_NeverTouchesLocked_WorkerStillGetsPaidAndVaultSolvent() public {
        _jobWithPendingClaim();
        vm.warp(uint256(_deadline()) + 1);
        vm.prank(funder);
        vault.reclaimJob(JOB);
        // worker's claim (at T0) is long past review period: anyone can finalize
        vault.finalizeClaim(JOB, worker);
        assertEq(vault.balanceOf(worker), REWARD);

        // everyone can withdraw everything
        vm.prank(worker);
        vault.withdraw(REWARD);
        uint256 funderBal = vault.balanceOf(funder);
        vm.prank(funder);
        vault.withdraw(funderBal);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Reclaim_RevertsWhenNothingFree() public {
        _newJobWith(JOB, REWARD, 1, _deadline(), 0);
        _claim(worker);
        vm.warp(uint256(_deadline()) + 1);
        vm.prank(funder);
        vm.expectRevert(ArcQuestVault.NothingToReclaim.selector);
        vault.reclaimJob(JOB);
    }

    function test_Reclaim_RevertsOnSecondCallAndWorksAgainAfterRefund() public {
        _newJobWith(JOB, REWARD, 1, _deadline(), 0);
        _claim(worker);
        _reject(worker);
        vm.warp(uint256(_deadline()) + 1);
        vm.startPrank(funder);
        vm.expectRevert(ArcQuestVault.NothingToReclaim.selector);
        vault.reclaimJob(JOB);
        vm.stopPrank();

        skip(DISPUTE_WINDOW + 1);
        vault.releaseRejected(JOB, worker); // replenishes escrow
        uint256 before = vault.balanceOf(funder);
        vm.prank(funder);
        vault.reclaimJob(JOB);
        assertEq(vault.balanceOf(funder), before + REWARD);
        vm.prank(funder);
        vm.expectRevert(ArcQuestVault.NothingToReclaim.selector);
        vault.reclaimJob(JOB);
    }

    function test_Reclaim_DisputedLockedFundsStayUntilResolved() public {
        _jobWithDisputedClaim();
        vm.warp(uint256(_deadline()) + 1);
        vm.prank(funder);
        vault.reclaimJob(JOB);
        (, uint256 esc, uint256 locked) = _job();
        assertEq(esc, 0);
        assertEq(locked, REWARD);
        // arbiter resolve window is now long gone (14d after D0 < deadline); expire splits
        vault.expireDispute(JOB, worker);
        assertEq(vault.balanceOf(worker), REWARD / 2);
    }
}
