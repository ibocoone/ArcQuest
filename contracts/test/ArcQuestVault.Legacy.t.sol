// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArcQuestVaultTestBase} from "./ArcQuestVault.Base.t.sol";
import {ArcQuestVault} from "../ArcQuestVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Deployment, deposit/withdraw, discretionary task pools, arbiter & signer admin.
contract ArcQuestVaultLegacyTest is ArcQuestVaultTestBase {
    // ---------- constructor ----------

    function test_Constructor_SetsState() public view {
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.arbiter(), arbiter);
        assertEq(vault.claimSigner(), signer);
        assertEq(vault.pendingArbiter(), address(0));
    }

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(ArcQuestVault.ZeroAddress.selector);
        new ArcQuestVault(IERC20(address(0)), arbiter, signer);
    }

    function test_Constructor_RevertsOnZeroArbiter() public {
        vm.expectRevert(ArcQuestVault.ZeroAddress.selector);
        new ArcQuestVault(IERC20(address(usdc)), address(0), signer);
    }

    function test_Constructor_RevertsOnZeroSigner() public {
        vm.expectRevert(ArcQuestVault.ZeroAddress.selector);
        new ArcQuestVault(IERC20(address(usdc)), arbiter, address(0));
    }

    function test_Constants() public view {
        assertEq(vault.DEFAULT_REVIEW_PERIOD(), 3 days);
        assertEq(vault.MIN_REVIEW_PERIOD(), 1 days);
        assertEq(vault.MAX_REVIEW_PERIOD(), 14 days);
        assertEq(vault.DISPUTE_WINDOW(), 7 days);
        assertEq(vault.ARBITER_TIMEOUT(), 14 days);
        assertEq(vault.MAX_JOB_DURATION(), 365 days);
        assertEq(vault.MAX_SLOTS(), 10000);
    }

    function test_ClaimPermitDigest_MatchesEip712Spec() public view {
        uint64 expiry = 12345;
        bytes32 domainSep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ArcQuestVault"),
                keccak256("1"),
                block.chainid,
                address(vault)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(keccak256("ClaimPermit(bytes32 jobId,address worker,uint64 expiry)"), JOB, worker, expiry)
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        assertEq(vault.claimPermitDigest(JOB, worker, expiry), expected);
        assertEq(
            vault.CLAIM_PERMIT_TYPEHASH(), keccak256("ClaimPermit(bytes32 jobId,address worker,uint64 expiry)")
        );
    }

    // ---------- deposit / withdraw ----------

    function test_Deposit_CreditsBalanceAndMovesTokens() public {
        _fund(worker, 500e6);
        assertEq(vault.balanceOf(worker), 500e6);
        assertEq(usdc.balanceOf(address(vault)), FUNDER_DEPOSIT + 500e6);
        assertEq(usdc.balanceOf(worker), 0);
    }

    function test_Deposit_EmitsDeposited() public {
        usdc.mint(worker, 7e6);
        vm.startPrank(worker);
        usdc.approve(address(vault), 7e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit ArcQuestVault.Deposited(worker, 7e6);
        vault.deposit(7e6);
        vm.stopPrank();
    }

    function test_Deposit_RevertsOnZero() public {
        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.InvalidAmount.selector);
        vault.deposit(0);
    }

    function test_Deposit_RevertsWithoutAllowance() public {
        usdc.mint(worker, 1e6);
        vm.prank(worker);
        vm.expectRevert();
        vault.deposit(1e6);
    }

    function test_Withdraw_DebitsAndTransfers() public {
        vm.prank(funder);
        vault.withdraw(1_000e6);
        assertEq(vault.balanceOf(funder), FUNDER_DEPOSIT - 1_000e6);
        assertEq(usdc.balanceOf(funder), 1_000e6);
    }

    function test_Withdraw_EmitsWithdrawn() public {
        vm.prank(funder);
        vm.expectEmit(true, false, false, true, address(vault));
        emit ArcQuestVault.Withdrawn(funder, 5e6);
        vault.withdraw(5e6);
    }

    function test_Withdraw_RevertsOnZero() public {
        vm.prank(funder);
        vm.expectRevert(ArcQuestVault.InvalidAmount.selector);
        vault.withdraw(0);
    }

    function test_Withdraw_RevertsWhenInsufficient() public {
        vm.prank(funder);
        vm.expectRevert(
            abi.encodeWithSelector(ArcQuestVault.InsufficientBalance.selector, FUNDER_DEPOSIT, FUNDER_DEPOSIT + 1)
        );
        vault.withdraw(FUNDER_DEPOSIT + 1);
    }

    function test_Withdraw_CannotTouchOthersBalance() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.InsufficientBalance.selector, 0, 1));
        vault.withdraw(1);
    }

    // ---------- fundTask ----------

    function _fundTask(uint256 amt, uint64 refundAfter) internal {
        vm.prank(funder);
        vault.fundTask(TASK, amt, refundAfter);
    }

    function test_FundTask_MovesBalanceToEscrow() public {
        uint64 ra = uint64(T0 + 10 days);
        _fundTask(300e6, ra);
        (address f, uint64 r, uint256 e) = vault.tasks(TASK);
        assertEq(f, funder);
        assertEq(r, ra);
        assertEq(e, 300e6);
        assertEq(vault.balanceOf(funder), FUNDER_DEPOSIT - 300e6);
    }

    function test_FundTask_EmitsTaskFunded() public {
        uint64 ra = uint64(T0 + 10 days);
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.TaskFunded(TASK, funder, 1e6, ra);
        vault.fundTask(TASK, 1e6, ra);
    }

    function test_FundTask_TopUpAccumulatesAndCanExtendRefundTime() public {
        _fundTask(100e6, uint64(T0 + 10 days));
        _fundTask(50e6, uint64(T0 + 20 days));
        (, uint64 r, uint256 e) = vault.tasks(TASK);
        assertEq(e, 150e6);
        assertEq(r, T0 + 20 days);
    }

    function test_FundTask_RevertsOnZeroAmount() public {
        vm.prank(funder);
        vm.expectRevert(ArcQuestVault.InvalidAmount.selector);
        vault.fundTask(TASK, 0, uint64(T0 + 1 days));
    }

    function test_FundTask_RevertsForForeignFunder() public {
        _fundTask(1e6, uint64(T0 + 10 days));
        _fund(other, 10e6);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotFunder.selector, other, funder));
        vault.fundTask(TASK, 1e6, uint64(T0 + 10 days));
    }

    function test_FundTask_RevertsOnInvalidRefundTime() public {
        vm.startPrank(funder);
        vm.expectRevert(ArcQuestVault.InvalidRefundTime.selector);
        vault.fundTask(TASK, 1e6, uint64(T0)); // == now
        vm.expectRevert(ArcQuestVault.InvalidRefundTime.selector);
        vault.fundTask(TASK, 1e6, uint64(T0 - 1)); // past
        vm.expectRevert(ArcQuestVault.InvalidRefundTime.selector);
        vault.fundTask(TASK, 1e6, uint64(T0 + 365 days + 1)); // too far
        vm.stopPrank();
    }

    function test_FundTask_AcceptsExactly365Days() public {
        _fundTask(1e6, uint64(T0 + 365 days));
        (, uint64 r,) = vault.tasks(TASK);
        assertEq(r, T0 + 365 days);
    }

    function test_FundTask_CannotDecreaseRefundTime() public {
        _fundTask(1e6, uint64(T0 + 10 days));
        vm.prank(funder);
        vm.expectRevert(ArcQuestVault.InvalidRefundTime.selector);
        vault.fundTask(TASK, 1e6, uint64(T0 + 9 days));
    }

    function test_FundTask_RevertsOnInsufficientBalance() public {
        vm.prank(funder);
        vm.expectRevert(
            abi.encodeWithSelector(ArcQuestVault.InsufficientBalance.selector, FUNDER_DEPOSIT, FUNDER_DEPOSIT + 1)
        );
        vault.fundTask(TASK, FUNDER_DEPOSIT + 1, uint64(T0 + 1 days));
    }

    // ---------- releaseReward ----------

    function test_ReleaseReward_CreditsWorkerFromEscrow() public {
        _fundTask(100e6, uint64(T0 + 10 days));
        vm.prank(funder);
        vault.releaseReward(TASK, worker, 40e6);
        assertEq(vault.balanceOf(worker), 40e6);
        assertEq(_taskEscrow(TASK), 60e6);
    }

    function test_ReleaseReward_EmitsRewardReleased() public {
        _fundTask(100e6, uint64(T0 + 10 days));
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.RewardReleased(TASK, worker, 10e6);
        vault.releaseReward(TASK, worker, 10e6);
    }

    function test_ReleaseReward_RevertsForNonFunder() public {
        _fundTask(100e6, uint64(T0 + 10 days));
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotFunder.selector, other, funder));
        vault.releaseReward(TASK, worker, 1e6);
    }

    function test_ReleaseReward_RevertsForUnknownTask() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotFunder.selector, funder, address(0)));
        vault.releaseReward(TASK, worker, 1e6);
    }

    function test_ReleaseReward_RevertsOnZeroWorkerAndAmount() public {
        _fundTask(100e6, uint64(T0 + 10 days));
        vm.startPrank(funder);
        vm.expectRevert(ArcQuestVault.ZeroAddress.selector);
        vault.releaseReward(TASK, address(0), 1e6);
        vm.expectRevert(ArcQuestVault.InvalidAmount.selector);
        vault.releaseReward(TASK, worker, 0);
        vm.stopPrank();
    }

    function test_ReleaseReward_RevertsWhenExceedingEscrow() public {
        _fundTask(100e6, uint64(T0 + 10 days));
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.InsufficientEscrow.selector, 100e6, 100e6 + 1));
        vault.releaseReward(TASK, worker, 100e6 + 1);
    }

    // ---------- refundTask ----------

    function test_RefundTask_RevertsBeforeRefundableAfter() public {
        uint64 ra = uint64(T0 + 10 days);
        _fundTask(100e6, ra);
        skip(10 days - 1);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.RefundLocked.selector, ra));
        vault.refundTask(TASK, 1e6);
    }

    function test_RefundTask_WorksAtExactRefundableAfter() public {
        _fundTask(100e6, uint64(T0 + 10 days));
        skip(10 days);
        vm.prank(funder);
        vault.refundTask(TASK, 60e6);
        assertEq(_taskEscrow(TASK), 40e6);
        assertEq(vault.balanceOf(funder), FUNDER_DEPOSIT - 100e6 + 60e6);
    }

    function test_RefundTask_EmitsTaskRefunded() public {
        _fundTask(100e6, uint64(T0 + 1 days));
        skip(1 days);
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(vault));
        emit ArcQuestVault.TaskRefunded(TASK, funder, 100e6);
        vault.refundTask(TASK, 100e6);
    }

    function test_RefundTask_RevertsForNonFunderZeroAndExcess() public {
        _fundTask(100e6, uint64(T0 + 1 days));
        skip(1 days);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotFunder.selector, other, funder));
        vault.refundTask(TASK, 1);
        vm.startPrank(funder);
        vm.expectRevert(ArcQuestVault.InvalidAmount.selector);
        vault.refundTask(TASK, 0);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.InsufficientEscrow.selector, 100e6, 100e6 + 1));
        vault.refundTask(TASK, 100e6 + 1);
        vm.stopPrank();
    }

    // ---------- arbiter two-step ----------

    function test_ProposeArbiter_SetsPendingAndEmits() public {
        vm.prank(arbiter);
        vm.expectEmit(true, true, false, false, address(vault));
        emit ArcQuestVault.ArbiterProposed(arbiter, other);
        vault.proposeArbiter(other);
        assertEq(vault.pendingArbiter(), other);
        assertEq(vault.arbiter(), arbiter);
    }

    function test_ProposeArbiter_RevertsForNonArbiterAndZero() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotArbiter.selector, other, arbiter));
        vault.proposeArbiter(other);
        vm.prank(arbiter);
        vm.expectRevert(ArcQuestVault.ZeroAddress.selector);
        vault.proposeArbiter(address(0));
    }

    function test_AcceptArbiter_CompletesHandover() public {
        vm.prank(arbiter);
        vault.proposeArbiter(other);
        vm.prank(other);
        vm.expectEmit(true, true, false, false, address(vault));
        emit ArcQuestVault.ArbiterChanged(arbiter, other);
        vault.acceptArbiter();
        assertEq(vault.arbiter(), other);
        assertEq(vault.pendingArbiter(), address(0));
    }

    function test_AcceptArbiter_RevertsForNonPending() public {
        vm.prank(other);
        vm.expectRevert(ArcQuestVault.NotPendingArbiter.selector);
        vault.acceptArbiter();
        vm.prank(arbiter);
        vault.proposeArbiter(other);
        vm.prank(worker);
        vm.expectRevert(ArcQuestVault.NotPendingArbiter.selector);
        vault.acceptArbiter();
    }

    function test_Arbiter_PendingHasNoPowerAndOldLosesPowerAfterAccept() public {
        vm.prank(arbiter);
        vault.proposeArbiter(other);
        // pending cannot act before accepting
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotArbiter.selector, other, arbiter));
        vault.setClaimSigner(other);
        vm.prank(other);
        vault.acceptArbiter();
        // old arbiter is locked out
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotArbiter.selector, arbiter, other));
        vault.proposeArbiter(arbiter);
        // accepted pending is cleared -> cannot accept twice
        vm.prank(other);
        vm.expectRevert(ArcQuestVault.NotPendingArbiter.selector);
        vault.acceptArbiter();
    }

    function test_ProposeArbiter_RepeatedProposalReplacesPending() public {
        vm.startPrank(arbiter);
        vault.proposeArbiter(other);
        vault.proposeArbiter(worker2);
        vm.stopPrank();
        vm.prank(other);
        vm.expectRevert(ArcQuestVault.NotPendingArbiter.selector);
        vault.acceptArbiter();
        vm.prank(worker2);
        vault.acceptArbiter();
        assertEq(vault.arbiter(), worker2);
    }

    // ---------- setClaimSigner ----------

    function test_SetClaimSigner_ByArbiterEmitsAndUpdates() public {
        vm.prank(arbiter);
        vm.expectEmit(true, true, false, false, address(vault));
        emit ArcQuestVault.ClaimSignerChanged(signer, other);
        vault.setClaimSigner(other);
        assertEq(vault.claimSigner(), other);
    }

    function test_SetClaimSigner_RevertsForNonArbiter() public {
        vm.prank(signer); // the signer itself cannot rotate
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotArbiter.selector, signer, arbiter));
        vault.setClaimSigner(other);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(ArcQuestVault.NotArbiter.selector, funder, arbiter));
        vault.setClaimSigner(other);
    }

    function test_SetClaimSigner_RevertsOnZero() public {
        vm.prank(arbiter);
        vm.expectRevert(ArcQuestVault.ZeroAddress.selector);
        vault.setClaimSigner(address(0));
    }
}
