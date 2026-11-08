// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArcQuestVaultTestBase} from "./ArcQuestVault.Base.t.sol";
import {ArcQuestVault} from "../ArcQuestVault.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// createJob validation + submitClaim (EIP-712 permit) behaviour.
contract ArcQuestVaultJobTest is ArcQuestVaultTestBase {
    // ---------- createJob ----------

    function test_CreateJob_StoresJobAndEscrowsFullAmount() public {
        _newJobWith(JOB, REWARD, SLOTS, _deadline(), 5 days);
        (address f, uint64 dl, uint32 rp, uint32 slots, uint32 active, uint128 reward, uint256 esc, uint256 lk) =
            vault.jobs(JOB);
        assertEq(f, funder);
        assertEq(dl, _deadline());
        assertEq(rp, 5 days);
        assertEq(slots, SLOTS);
        assertEq(active, 0);
        assertEq(reward, REWARD);
        assertEq(esc, uint256(REWARD) * SLOTS);
        assertEq(lk, 0);
        assertEq(vault.balanceOf(funder), FUNDER_DEPOSIT - uint256(REWARD) * SLOTS);
    }

    function test_CreateJob_EmitsJobCreated() public {
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.JobCreated(JOB, funder, REWARD, SLOTS, _deadline(), 2 days);
        vault.createJob(JOB, REWARD, SLOTS, _deadline(), 2 days);
    }

    function test_CreateJob_ZeroReviewPeriodDefaultsToThreeDays() public {
        _newJobWith(JOB, REWARD, SLOTS, _deadline(), 0);
        (,, uint32 rp,,,,,) = vault.jobs(JOB);
        assertEq(rp, 3 days);
        assertEq(rp, vault.DEFAULT_REVIEW_PERIOD());
    }

    function test_CreateJob_DefaultReviewEventCarriesDefault() public {
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.JobCreated(JOB, funder, REWARD, SLOTS, _deadline(), uint32(3 days));
        vault.createJob(JOB, REWARD, SLOTS, _deadline(), 0);
    }

    function test_CreateJob_ReviewPeriodBounds() public {
        _newJobWith(keccak256("min"), REWARD, 1, _deadline(), uint32(1 days));
        _newJobWith(keccak256("max"), REWARD, 1, _deadline(), uint32(14 days));
        vm.startPrank(funder);
        vm.expectRevert(ArcQuestVault.InvalidReviewPeriod.selector);
        vault.createJob(keccak256("lo"), REWARD, 1, _deadline(), uint32(1 days - 1));
        vm.expectRevert(ArcQuestVault.InvalidReviewPeriod.selector);
        vault.createJob(keccak256("hi"), REWARD, 1, _deadline(), uint32(14 days + 1));
        vm.stopPrank();
    }

    function test_CreateJob_RevertsOnZeroReward() public {
        vm.prank(funder);
        vm.expectRevert(ArcQuestVault.InvalidAmount.selector);
        vault.createJob(JOB, 0, SLOTS, _deadline(), 0);
    }

    function test_CreateJob_SlotBounds() public {
        vm.startPrank(funder);
        vm.expectRevert(ArcQuestVault.InvalidSlots.selector);
        vault.createJob(JOB, 1, 0, _deadline(), 0);
        vm.expectRevert(ArcQuestVault.InvalidSlots.selector);
        vault.createJob(JOB, 1, 10001, _deadline(), 0);
        vault.createJob(JOB, 1, 10000, _deadline(), 0); // MAX_SLOTS allowed
        vm.stopPrank();
        (,,, uint32 slots,,, uint256 esc,) = vault.jobs(JOB);
        assertEq(slots, 10000);
        assertEq(esc, 10000);
    }

    function test_CreateJob_DeadlineBounds() public {
        vm.startPrank(funder);
        vm.expectRevert(ArcQuestVault.InvalidDeadline.selector);
        vault.createJob(JOB, REWARD, 1, uint64(T0), 0); // == now
        vm.expectRevert(ArcQuestVault.InvalidDeadline.selector);
        vault.createJob(JOB, REWARD, 1, uint64(T0 - 1), 0);
        vm.expectRevert(ArcQuestVault.InvalidDeadline.selector);
        vault.createJob(JOB, REWARD, 1, uint64(T0 + 365 days + 1), 0);
        vault.createJob(JOB, REWARD, 1, uint64(T0 + 1), 0); // now+1 ok
        vault.createJob(keccak256("far"), REWARD, 1, uint64(T0 + 365 days), 0); // exactly max ok
        vm.stopPrank();
    }

    function test_CreateJob_RevertsOnInsufficientBalance() public {
        uint256 total = uint256(REWARD) * 101;
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.InsufficientBalance.selector, FUNDER_DEPOSIT, total));
        vault.createJob(JOB, REWARD, 101, _deadline(), 0);
    }

    function test_CreateJob_RevertsOnDuplicateJobId() public {
        _newJob();
        vm.prank(funder);
        vm.expectRevert(ArcQuestVault.JobExists.selector);
        vault.createJob(JOB, REWARD, 1, _deadline(), 0);
        _fund(other, 1_000e6);
        vm.prank(other);
        vm.expectRevert(ArcQuestVault.JobExists.selector);
        vault.createJob(JOB, REWARD, 1, _deadline(), 0);
    }

    function test_CreateJob_SucceedsWhenIdIsExistingTask() public {
        vm.startPrank(funder);
        vault.fundTask(JOB, 1e6, uint64(T0 + 1 days));
        vault.createJob(JOB, REWARD, 1, _deadline(), 0); // independent namespaces: no revert
        vm.stopPrank();
        (address jf,,,,,,,) = vault.jobs(JOB);
        assertEq(jf, funder);
    }

    /// jobs and tasks are independent namespaces: a job can be created under an id used by a task,
    /// and a task can be funded under an id used by a job.
    function test_FundTask_AcceptsExistingJobId() public {
        _newJob();
        _fund(other, 1e6);
        vm.prank(other);
        vault.fundTask(JOB, 1e6, uint64(T0 + 1 days)); // does not revert
        (address tf,,) = vault.tasks(JOB);
        assertEq(tf, other);
    }

    function test_CreateJob_FrontRunnerFundTaskDoesNotBlockCreateJob() public {
        _fund(other, 1e6);
        vm.prank(other);
        vault.fundTask(JOB, 1e6, uint64(T0 + 1 days));
        vm.prank(funder);
        vault.createJob(JOB, REWARD, 1, _deadline(), 0); // succeeds despite the task using the same id
        (address jf,,,,,, uint256 jesc,) = vault.jobs(JOB);
        assertEq(jf, funder);
        assertEq(jesc, uint256(REWARD));
        (address tf,, uint256 tesc) = vault.tasks(JOB);
        assertEq(tf, other);
        assertEq(tesc, 1e6);
    }

    function test_TaskAndJobSameId_CoexistWithSeparateAccounting() public {
        _fund(other, 5e6);
        uint256 funderBefore = vault.balanceOf(funder);
        // task under JOB funded by `other`
        vm.prank(other);
        vault.fundTask(JOB, 2e6, uint64(T0 + 1 days));
        // job under the same id created by `funder`
        _newJob();
        uint256 jobTotal = uint256(REWARD) * SLOTS;

        (address tf, uint64 tra, uint256 tesc) = vault.tasks(JOB);
        assertEq(tf, other);
        assertEq(tra, uint64(T0 + 1 days));
        assertEq(tesc, 2e6);
        (, , , , , , uint256 jesc,) = vault.jobs(JOB);
        assertEq(jesc, jobTotal);
        assertEq(vault.balanceOf(funder), funderBefore - jobTotal);
        assertEq(vault.balanceOf(other), 3e6);

        // releasing task reward only touches task escrow
        vm.prank(other);
        vault.releaseReward(JOB, worker, 1e6);
        (,, tesc) = vault.tasks(JOB);
        (, , , , , , jesc,) = vault.jobs(JOB);
        assertEq(tesc, 1e6);
        assertEq(jesc, jobTotal);
        assertEq(vault.balanceOf(worker), 1e6);

        // a job claim only touches job escrow
        _claim(worker);
        (,, tesc) = vault.tasks(JOB);
        (uint32 active, uint256 esc2, uint256 locked) = _job();
        assertEq(tesc, 1e6);
        assertEq(active, 1);
        assertEq(esc2, jobTotal - REWARD);
        assertEq(locked, REWARD);

        // the job funder cannot touch the task, and the task funder cannot act as job funder
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotFunder.selector, funder, other));
        vault.releaseReward(JOB, worker, 1);
    }

    // ---------- submitClaim: happy path ----------

    function test_SubmitClaim_LocksRewardAndTakesSlot() public {
        _newJob();
        _claim(worker);
        (uint32 active, uint256 esc, uint256 locked) = _job();
        assertEq(active, 1);
        assertEq(esc, uint256(REWARD) * (SLOTS - 1));
        assertEq(locked, REWARD);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Pending));
        assertEq(_claimAt(worker), T0);
    }

    function test_SubmitClaim_EmitsClaimSubmitted() public {
        _newJob();
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.prank(worker);
        vm.expectEmit(true, true, false, false, address(vault));
        emit ArcQuestVault.ClaimSubmitted(JOB, worker);
        vault.submitClaim(JOB, expiry, sig);
    }

    function test_SubmitClaim_AllowedExactlyAtDeadline() public {
        _newJob();
        vm.warp(_deadline());
        _claim(worker);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Pending));
    }

    function test_SubmitClaim_RevertsAfterDeadline() public {
        _newJob();
        vm.warp(uint256(_deadline()) + 1);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.prank(worker);
        vm.expectRevert(
            abi.encodeWithSelector(ArcQuestVault.ClaimWindowClosed.selector, JOB, worker, uint256(_deadline()))
        );
        vault.submitClaim(JOB, expiry, sig);
    }

    function test_SubmitClaim_RevertsForUnknownJob() public {
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.JobNotFound.selector);
        vault.submitClaim(JOB, expiry, sig);
    }

    function test_SubmitClaim_FunderCannotClaimOwnJob() public {
        _newJob();
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permit(JOB, funder, expiry);
        vm.prank(funder);
        vm.expectRevert(ArcQuestVault.CannotClaimOwnJob.selector);
        vault.submitClaim(JOB, expiry, sig);
    }

    // ---------- submitClaim: permits ----------

    function test_SubmitClaim_PermitValidAtExactExpiry() public {
        _newJob();
        uint64 expiry = uint64(T0 + 100);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.warp(expiry);
        vm.prank(worker);
        vault.submitClaim(JOB, expiry, sig);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Pending));
    }

    function test_SubmitClaim_RevertsOnExpiredPermit() public {
        _newJob();
        uint64 expiry = uint64(T0 + 100);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.warp(uint256(expiry) + 1);
        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.PermitExpired.selector, expiry));
        vault.submitClaim(JOB, expiry, sig);
    }

    function test_SubmitClaim_RevertsOnWrongSigner() public {
        _newJob();
        (, uint256 badPk) = makeAddrAndKey("attacker-signer");
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permitWith(badPk, JOB, worker, expiry);
        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.InvalidPermit.selector);
        vault.submitClaim(JOB, expiry, sig);
    }

    function test_SubmitClaim_PermitIsBoundToWorker() public {
        _newJob();
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.prank(worker2); // someone else replays worker's permit
        vm.expectRevert(ArcQuestVault.InvalidPermit.selector);
        vault.submitClaim(JOB, expiry, sig);
    }

    function test_SubmitClaim_PermitIsBoundToJob() public {
        _newJob();
        bytes32 job2 = keccak256("job-2");
        _newJobWith(job2, REWARD, 1, _deadline(), 0);
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.InvalidPermit.selector);
        vault.submitClaim(job2, expiry, sig);
    }

    function test_SubmitClaim_PermitIsBoundToExpiry() public {
        _newJob();
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.InvalidPermit.selector);
        vault.submitClaim(JOB, expiry + 1 days, sig); // tried to extend expiry
    }

    function test_SubmitClaim_RevertsOnMalformedSignature() public {
        _newJob();
        uint64 expiry = uint64(T0 + 1 hours);
        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, uint256(3)));
        vault.submitClaim(JOB, expiry, hex"010203");
    }

    function test_SubmitClaim_RevertsOnZeroSignature() public {
        _newJob();
        uint64 expiry = uint64(T0 + 1 hours);
        vm.prank(worker);
        vm.expectRevert(); // ECDSAInvalidSignature
        vault.submitClaim(JOB, expiry, new bytes(65));
    }

    function test_SubmitClaim_ReplayBySameWorkerReverts() public {
        _newJob();
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.startPrank(worker);
        vault.submitClaim(JOB, expiry, sig);
        vm.expectRevert(ArcQuestVault.AlreadyClaimed.selector);
        vault.submitClaim(JOB, expiry, sig);
        vm.stopPrank();
        (uint32 active,, uint256 locked) = _job();
        assertEq(active, 1);
        assertEq(locked, REWARD);
    }

    function test_SubmitClaim_RotatedSignerInvalidatesOldPermitsAndAcceptsNew() public {
        _newJob();
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory oldSig = _permit(JOB, worker, expiry);
        (address newSigner, uint256 newPk) = makeAddrAndKey("new-signer");
        vm.prank(arbiter);
        vault.setClaimSigner(newSigner);

        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.InvalidPermit.selector);
        vault.submitClaim(JOB, expiry, oldSig);

        bytes memory newSig = _permitWith(newPk, JOB, worker, expiry);
        vm.prank(worker);
        vault.submitClaim(JOB, expiry, newSig);
        assertEq(uint8(_status(worker)), uint8(ArcQuestVault.ClaimStatus.Pending));
    }

    // ---------- slot limits ----------

    function test_SubmitClaim_RevertsWhenNoSlotsLeft() public {
        _newJobWith(JOB, REWARD, 2, _deadline(), 0);
        _claim(worker);
        _claim(worker2);
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permit(JOB, other, expiry);
        vm.prank(other);
        vm.expectRevert(ArcQuestVault.NoSlotsLeft.selector);
        vault.submitClaim(JOB, expiry, sig);
        (uint32 active, uint256 esc, uint256 locked) = _job();
        assertEq(active, 2);
        assertEq(esc, 0);
        assertEq(locked, 2 * uint256(REWARD));
    }

    function test_SubmitClaim_PaidClaimKeepsSlotOccupied() public {
        _newJobWith(JOB, REWARD, 1, _deadline(), 0);
        _claim(worker);
        vm.prank(funder);
        vault.approveClaim(JOB, worker);
        uint64 expiry = uint64(T0 + 1 hours);
        bytes memory sig = _permit(JOB, worker2, expiry);
        vm.prank(worker2);
        vm.expectRevert(ArcQuestVault.NoSlotsLeft.selector);
        vault.submitClaim(JOB, expiry, sig);
    }

    function test_SubmitClaim_RefundedClaimFreesSlotButNotWorkerId() public {
        _newJobWith(JOB, REWARD, 1, _deadline(), 0);
        _claim(worker);
        _reject(worker);
        skip(DISPUTE_WINDOW + 1);
        vault.releaseRejected(JOB, worker);

        // same worker cannot claim again
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory sig = _permit(JOB, worker, expiry);
        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.AlreadyClaimed.selector);
        vault.submitClaim(JOB, expiry, sig);

        // a different worker can take the freed slot
        _claim(worker2);
        assertEq(uint8(_status(worker2)), uint8(ArcQuestVault.ClaimStatus.Pending));
    }
}
