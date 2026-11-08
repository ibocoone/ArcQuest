// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArcQuestVaultTestBase} from "./ArcQuestVault.Base.t.sol";
import {ArcQuestVault} from "../ArcQuestVault.sol";

contract ArcQuestVaultFuzzTest is ArcQuestVaultTestBase {
    function testFuzz_DepositWithdrawRoundTrip(uint96 amount, uint96 part) public {
        uint256 amt = bound(amount, 1, type(uint96).max);
        uint256 w = bound(part, 1, amt);
        usdc.mint(worker, amt);
        vm.startPrank(worker);
        usdc.approve(address(vault), amt);
        vault.deposit(amt);
        assertEq(vault.balanceOf(worker), amt);
        vault.withdraw(w);
        vm.stopPrank();
        assertEq(vault.balanceOf(worker), amt - w);
        assertEq(usdc.balanceOf(worker), w);
        assertEq(usdc.balanceOf(address(vault)), FUNDER_DEPOSIT + amt - w);
    }

    function testFuzz_CreateJob_EscrowIsRewardTimesSlots(uint128 reward, uint32 slots) public {
        reward = uint128(bound(reward, 1, 1e12));
        slots = uint32(bound(slots, 1, 10000));
        uint256 total = uint256(reward) * slots;
        _fund(funder, total); // guarantee funds
        uint256 before = vault.balanceOf(funder);
        _newJobWith(JOB, reward, slots, _deadline(), 0);
        (,,,,,, uint256 esc, uint256 locked) = vault.jobs(JOB);
        assertEq(esc, total);
        assertEq(locked, 0);
        assertEq(vault.balanceOf(funder), before - total);
    }

    function testFuzz_CreateJob_ReviewPeriodValidity(uint32 review) public {
        vm.prank(funder);
        if (review != 0 && (review < 1 days || review > 14 days)) {
            vm.expectRevert(ArcQuestVault.InvalidReviewPeriod.selector);
        }
        vault.createJob(JOB, REWARD, 1, _deadline(), review);
        if (review == 0 || (review >= 1 days && review <= 14 days)) {
            (,, uint32 rp,,,,,) = vault.jobs(JOB);
            assertEq(rp, review == 0 ? uint32(3 days) : review);
        }
    }

    function testFuzz_CreateJob_DeadlineValidity(uint64 dl) public {
        bool ok = dl > T0 && uint256(dl) <= T0 + 365 days;
        vm.prank(funder);
        if (!ok) vm.expectRevert(ArcQuestVault.InvalidDeadline.selector);
        vault.createJob(JOB, REWARD, 1, dl, 0);
    }

    function testFuzz_SubmitClaim_MovesExactlyOneRewardToLocked(uint128 reward, uint8 nClaims) public {
        reward = uint128(bound(reward, 1, 1e9));
        uint256 n = bound(nClaims, 1, 5);
        _newJobWith(JOB, reward, 5, _deadline(), 0);
        for (uint256 i = 0; i < n; i++) {
            _claim(address(uint160(0x1000 + i)));
        }
        (uint32 active, uint256 esc, uint256 locked) = _job();
        assertEq(active, n);
        assertEq(locked, n * uint256(reward));
        assertEq(esc, (5 - n) * uint256(reward));
        assertEq(esc + locked, 5 * uint256(reward));
    }

    function testFuzz_ReviewBoundary_RejectIffBeforeEnd_FinalizeIffAtOrAfter(uint32 review, uint32 elapsed) public {
        review = uint32(bound(review, 1 days, 14 days));
        elapsed = uint32(bound(elapsed, 0, 30 days));
        _newJobWith(JOB, REWARD, 1, _deadline(), review);
        _claim(worker);
        skip(elapsed);

        uint256 snap = vm.snapshotState();
        vm.prank(funder);
        if (elapsed >= review) vm.expectRevert();
        vault.rejectClaim(JOB, worker);
        vm.revertToState(snap);

        if (elapsed < review) vm.expectRevert();
        vault.finalizeClaim(JOB, worker);
    }

    function testFuzz_DisputeBoundary_DisputeIffWithinWindow_ReleaseIffAfter(uint32 elapsed) public {
        elapsed = uint32(bound(elapsed, 0, 20 days));
        _jobWithPendingClaim();
        _reject(worker);
        skip(elapsed);

        uint256 snap = vm.snapshotState();
        vm.prank(worker);
        if (elapsed > DISPUTE_WINDOW) vm.expectRevert();
        vault.disputeClaim(JOB);
        vm.revertToState(snap);

        if (elapsed <= DISPUTE_WINDOW) vm.expectRevert();
        vault.releaseRejected(JOB, worker);
    }

    function testFuzz_ArbiterTimeoutBoundary(uint32 elapsed) public {
        elapsed = uint32(bound(elapsed, 0, 40 days));
        _jobWithDisputedClaim();
        skip(elapsed);

        uint256 snap = vm.snapshotState();
        vm.prank(arbiter);
        if (elapsed >= ARB_TIMEOUT) vm.expectRevert();
        vault.resolveDispute(JOB, worker, true);
        vm.revertToState(snap);

        if (elapsed < ARB_TIMEOUT) vm.expectRevert();
        vault.expireDispute(JOB, worker);
    }

    function testFuzz_ExpireDispute_SplitSumsToRewardFunderGetsCeil(uint128 reward) public {
        reward = uint128(bound(reward, 1, 1e9));
        _newJobWith(JOB, reward, 1, _deadline(), 0);
        _claim(worker);
        _reject(worker);
        _dispute(worker);
        uint256 funderBefore = vault.balanceOf(funder);
        skip(ARB_TIMEOUT);
        vault.expireDispute(JOB, worker);

        uint256 toWorker = vault.balanceOf(worker);
        uint256 toFunder = vault.balanceOf(funder) - funderBefore;
        assertEq(toWorker, uint256(reward) / 2);
        assertEq(toWorker + toFunder, reward);
        assertGe(toFunder, toWorker);
        assertLe(toFunder - toWorker, 1);
        (,, uint256 locked) = _job();
        assertEq(locked, 0);
    }

    function testFuzz_Reclaim_ReturnsExactlyFreeEscrow(uint8 slots, uint8 claimed) public {
        uint256 s = bound(slots, 1, 20);
        uint256 c = bound(claimed, 0, s);
        _newJobWith(JOB, REWARD, uint32(s), _deadline(), 0);
        for (uint256 i = 0; i < c; i++) {
            _claim(address(uint160(0x2000 + i)));
        }
        uint256 before = vault.balanceOf(funder);
        vm.warp(uint256(_deadline()) + 1);
        (, uint256 escBefore, uint256 lockedBefore) = _job();
        assertEq(lockedBefore, c * uint256(REWARD));
        vm.prank(funder);
        if (s == c) {
            vm.expectRevert(ArcQuestVault.NothingToReclaim.selector);
            vault.reclaimJob(JOB);
        } else {
            vault.reclaimJob(JOB);
            assertEq(vault.balanceOf(funder), before + escBefore);
            assertEq(escBefore, (s - c) * uint256(REWARD));
        }
        (,, uint256 lockedAfter) = _job();
        assertEq(lockedAfter, lockedBefore);
    }

    function testFuzz_TaskFlowConservesFunds(uint96 fundAmt, uint96 releaseAmt, uint96 refundAmt) public {
        uint256 f = bound(fundAmt, 1, FUNDER_DEPOSIT);
        uint256 r = bound(releaseAmt, 1, f);
        uint256 rf = bound(refundAmt, 1, f - r + 1);
        vm.startPrank(funder);
        vault.fundTask(TASK, f, uint64(T0 + 1 days));
        vault.releaseReward(TASK, worker, r);
        vm.stopPrank();
        skip(1 days);
        vm.prank(funder);
        if (rf > f - r) {
            vm.expectRevert();
            vault.refundTask(TASK, rf);
            rf = 0;
        } else {
            vault.refundTask(TASK, rf);
        }
        assertEq(vault.balanceOf(funder) + vault.balanceOf(worker) + _taskEscrow(TASK), FUNDER_DEPOSIT);
        assertEq(usdc.balanceOf(address(vault)), FUNDER_DEPOSIT);
    }

    function testFuzz_PermitOnlyValidForSignedWorker(address signedFor, address caller, uint64 expiry) public {
        vm.assume(signedFor != caller && caller != funder && caller != address(0));
        expiry = uint64(bound(expiry, T0, T0 + 100 days));
        _newJob();
        bytes memory sig = _permit(JOB, signedFor, expiry);
        vm.prank(caller);
        vm.expectRevert(ArcQuestVault.InvalidPermit.selector);
        vault.submitClaim(JOB, expiry, sig);
    }
}
