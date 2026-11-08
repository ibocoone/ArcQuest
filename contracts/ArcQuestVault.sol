// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title ArcQuestVault
/// @notice Permissionless ERC-20 USDC balances, discretionary task pools and protected jobs.
/// @dev Amounts are raw token units (6 decimals for USDC), never native currency.
///      Invariant: usdc.balanceOf(vault) >= sum(balanceOf) + sum(tasks[..].escrow)
///      + sum(jobs[..].escrow) + sum(jobs[..].locked).
///      Assumes USDC does not rebase or debit the vault beyond a requested transfer.
///      Protected-job claim registration requires a platform signer's EIP-712 permit.
///      The signer can only authorise who may register a claim; it cannot move funds,
///      approve claims, or resolve disputes. The arbiter can rotate the signer immediately.
///      If the USDC issuer blocklists or freezes the vault address, withdrawals revert
///      for everyone. The contract cannot fix issuer restrictions; the operator must
///      monitor them and stop creating new jobs during a freeze.
contract ArcQuestVault is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // --- Errors ---

    error ZeroAddress();
    error InvalidAmount();
    error InsufficientBalance(uint256 available, uint256 requested);
    error NotFunder(address caller, address funder);
    error InvalidRefundTime();
    error InsufficientEscrow(uint256 available, uint256 requested);
    error RefundLocked(uint64 refundableAfter);
    error NotArbiter(address caller, address arbiter);
    error NotPendingArbiter();
    error JobExists();
    error JobNotFound();
    error InvalidSlots();
    error InvalidDeadline();
    error InvalidReviewPeriod();
    error ClaimWindowClosed(bytes32 jobId, address worker, uint256 cutoff);
    error CannotClaimOwnJob();
    error AlreadyClaimed();
    error NoSlotsLeft();
    error InvalidClaimState(bytes32 jobId, address worker, ClaimStatus status);
    error PermitExpired(uint64 expiry);
    error InvalidPermit();
    error ReviewPeriodOver(bytes32 jobId, address worker, uint256 cutoff);
    error ReviewPeriodNotOver(bytes32 jobId, address worker, uint256 cutoff);
    error DisputeWindowClosed(bytes32 jobId, address worker, uint256 cutoff);
    error DisputeWindowOpen(bytes32 jobId, address worker, uint256 cutoff);
    error ArbiterTimeoutNotReached(bytes32 jobId, address worker, uint256 cutoff);
    error ArbiterTimeoutReached(bytes32 jobId, address worker);
    error JobStillOpen();
    error NothingToReclaim();

    // --- Constants and accounting ---

    bytes32 public constant CLAIM_PERMIT_TYPEHASH =
        keccak256("ClaimPermit(bytes32 jobId,address worker,uint64 expiry)");
    uint256 public constant DEFAULT_REVIEW_PERIOD = 3 days;
    uint256 public constant MIN_REVIEW_PERIOD = 1 days;
    uint256 public constant MAX_REVIEW_PERIOD = 14 days;
    uint256 public constant DISPUTE_WINDOW = 7 days;
    uint256 public constant ARBITER_TIMEOUT = 14 days;
    uint256 public constant MAX_JOB_DURATION = 365 days;
    uint256 public constant MAX_SLOTS = 10000;

    IERC20 public immutable usdc;
    mapping(address => uint256) public balanceOf;
    address public arbiter;
    address public pendingArbiter;
    address public claimSigner;

    struct Task {
        address funder;
        uint64 refundableAfter;
        uint256 escrow;
    }

    mapping(bytes32 => Task) public tasks;

    struct Job {
        address funder;
        uint64 deadline;
        uint32 reviewPeriod;
        uint32 slots;
        uint32 active;
        uint128 reward;
        uint256 escrow;
        uint256 locked;
    }

    enum ClaimStatus { None, Pending, Paid, Rejected, Disputed, Refunded, Split }
    enum PayReason { Approved, AutoApproved, ArbiterDecision }

    struct Claim {
        ClaimStatus status;
        uint64 at;
    }

    mapping(bytes32 => Job) public jobs;
    mapping(bytes32 => mapping(address => Claim)) public claims;

    // --- Events ---

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event TaskFunded(
        bytes32 indexed taskId, address indexed funder, uint256 amount, uint64 refundableAfter
    );
    event RewardReleased(bytes32 indexed taskId, address indexed worker, uint256 amount);
    event TaskRefunded(bytes32 indexed taskId, address indexed funder, uint256 amount);
    event ArbiterProposed(address indexed current, address indexed proposed);
    event ArbiterChanged(address indexed previous, address indexed current);
    event ClaimSignerChanged(address indexed previous, address indexed current);
    event JobCreated(
        bytes32 indexed jobId, address indexed funder, uint128 reward,
        uint32 slots, uint64 deadline, uint32 reviewPeriod
    );
    event ClaimSubmitted(bytes32 indexed jobId, address indexed worker);
    event ClaimPaid(bytes32 indexed jobId, address indexed worker, uint256 reward, PayReason reason);
    event ClaimRejected(bytes32 indexed jobId, address indexed worker);
    event ClaimDisputed(bytes32 indexed jobId, address indexed worker);
    event ClaimRefunded(bytes32 indexed jobId, address indexed worker);
    event DisputeResolved(bytes32 indexed jobId, address indexed worker, bool payWorker);
    event DisputeExpired(
        bytes32 indexed jobId, address indexed worker, uint256 toWorker, uint256 toFunder
    );
    event JobReclaimed(bytes32 indexed jobId, address indexed funder, uint256 amount);

    // --- Initialization and two-step arbitration handover ---

    /// @notice Bind the vault permanently to an ERC-20 USDC contract and set its initial arbiter and signer.
    /// @param usdc_ USDC's ERC-20 interface address, not a native-currency interface.
    /// @param arbiter_ Nonzero arbiter; arbitration can only pay the worker or return job escrow.
    /// @param claimSigner_ Nonzero platform signer authorising claim registration only.
    constructor(IERC20 usdc_, address arbiter_, address claimSigner_) EIP712("ArcQuestVault", "1") {
        if (address(usdc_) == address(0) || arbiter_ == address(0) || claimSigner_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = usdc_;
        arbiter = arbiter_;
        claimSigner = claimSigner_;
    }

    /// @notice Immediately rotate the claim-registration signer as the current arbiter.
    /// @dev The signer cannot move funds, approve claims, or resolve disputes.
    function setClaimSigner(address next) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter(msg.sender, arbiter);
        if (next == address(0)) revert ZeroAddress();
        address previous = claimSigner;
        claimSigner = next;
        emit ClaimSignerChanged(previous, next);
    }

    /// @notice Propose a nonzero replacement; only the current arbiter may propose.
    function proposeArbiter(address next) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter(msg.sender, arbiter);
        if (next == address(0)) revert ZeroAddress();
        pendingArbiter = next;
        emit ArbiterProposed(arbiter, next);
    }

    /// @notice Accept arbitration responsibility as the currently proposed replacement.
    function acceptArbiter() external nonReentrant {
        if (msg.sender != pendingArbiter) revert NotPendingArbiter();
        address previous = arbiter;
        arbiter = msg.sender;
        pendingArbiter = address(0);
        emit ArbiterChanged(previous, msg.sender);
    }

    // --- Deposits and withdrawals ---

    /// @notice Deposit tokens, crediting only the amount actually received.
    /// @dev Credit necessarily follows the transfer to measure receipt; nonReentrant
    ///      protects this interaction-before-effect exception. Requires token approval.
    /// @param amount Positive amount to pull from the caller, in raw token units.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - beforeBalance;
        balanceOf[msg.sender] += received;
        emit Deposited(msg.sender, received);
    }

    /// @notice Withdraw available balance exclusively to the caller.
    /// @param amount Positive amount to debit and transfer, in raw token units.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);

        balanceOf[msg.sender] = available - amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // --- Discretionary contest pools (legacy tasks) ---

    /// @notice Fund or top up the caller's task escrow from their available balance.
    /// @dev Task IDs remain bound to their original funder even after escrow is emptied.
    /// @param taskId Unique task identifier.
    /// @param amount Positive amount to escrow, in raw token units.
    /// @param refundableAfter Future refund timestamp, at most 365 days away;
    ///        an existing task's timestamp cannot decrease.
    function fundTask(bytes32 taskId, uint256 amount, uint64 refundableAfter) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        Task storage task = tasks[taskId];
        if (task.funder != address(0) && task.funder != msg.sender) revert NotFunder(msg.sender, task.funder);
        if (
            refundableAfter <= block.timestamp
                || uint256(refundableAfter) > block.timestamp + 365 days
                || refundableAfter < task.refundableAfter
        ) revert InvalidRefundTime();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);

        balanceOf[msg.sender] = available - amount;
        if (task.funder == address(0)) task.funder = msg.sender;
        task.refundableAfter = refundableAfter;
        task.escrow += amount;
        emit TaskFunded(taskId, msg.sender, amount, refundableAfter);
    }

    /// @notice Credit a worker from the caller's task escrow without transferring tokens.
    /// @param taskId Task owned by the caller.
    /// @param worker Nonzero address receiving an internal balance credit.
    /// @param amount Positive reward amount, in raw token units.
    function releaseReward(bytes32 taskId, address worker, uint256 amount) external nonReentrant {
        Task storage task = tasks[taskId];
        if (task.funder != msg.sender) revert NotFunder(msg.sender, task.funder);
        if (worker == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        uint256 available = task.escrow;
        if (amount > available) revert InsufficientEscrow(available, amount);

        task.escrow = available - amount;
        balanceOf[worker] += amount;
        emit RewardReleased(taskId, worker, amount);
    }

    /// @notice Return unlocked task escrow to the funder's available balance.
    /// @param taskId Task owned by the caller whose refund time has arrived.
    /// @param amount Positive amount to refund, in raw token units.
    function refundTask(bytes32 taskId, uint256 amount) external nonReentrant {
        Task storage task = tasks[taskId];
        if (task.funder != msg.sender) revert NotFunder(msg.sender, task.funder);
        if (block.timestamp < task.refundableAfter) revert RefundLocked(task.refundableAfter);
        if (amount == 0) revert InvalidAmount();
        uint256 available = task.escrow;
        if (amount > available) revert InsufficientEscrow(available, amount);

        task.escrow = available - amount;
        balanceOf[task.funder] += amount;
        emit TaskRefunded(taskId, msg.sender, amount);
    }

    // --- Protected jobs: internal accounting only, no token interactions ---

    /// @notice Fully fund fixed-reward slots using the caller's available balance.
    /// @dev IDs cannot reuse an existing job; the discretionary task pool is a separate namespace. Job IDs remain reserved forever.
    ///      A zero reviewPeriod selects the default of 3 days.
    function createJob(
        bytes32 jobId, uint128 reward, uint32 slots, uint64 deadline, uint32 reviewPeriod
    ) external nonReentrant {
        if (jobs[jobId].funder != address(0)) revert JobExists();
        if (reward == 0) revert InvalidAmount();
        if (slots == 0 || slots > MAX_SLOTS) revert InvalidSlots();
        if (deadline <= block.timestamp || uint256(deadline) > block.timestamp + MAX_JOB_DURATION) {
            revert InvalidDeadline();
        }
        if (reviewPeriod == 0) reviewPeriod = uint32(DEFAULT_REVIEW_PERIOD);
        if (reviewPeriod < MIN_REVIEW_PERIOD || reviewPeriod > MAX_REVIEW_PERIOD) {
            revert InvalidReviewPeriod();
        }
        uint256 total = uint256(reward) * slots;
        uint256 available = balanceOf[msg.sender];
        if (total > available) revert InsufficientBalance(available, total);

        balanceOf[msg.sender] = available - total;
        jobs[jobId] = Job({
            funder: msg.sender,
            deadline: deadline,
            reviewPeriod: reviewPeriod,
            slots: slots,
            active: 0,
            reward: reward,
            escrow: total,
            locked: 0
        });
        emit JobCreated(jobId, msg.sender, reward, slots, deadline, reviewPeriod);
    }

    /// @notice Reserve one funded slot as a worker, including at the job deadline.
    /// @dev Each worker may claim only once, even if their claim is later refunded.
    ///      Active counts Pending, Rejected, Disputed, Paid and Split; only Refunded frees a slot.
    ///      Registration requires an unexpired permit from the current claimSigner.
    /// @param expiry Inclusive expiry timestamp of the worker-bound permit.
    /// @param signature Platform signer's EIP-712 signature for this job and msg.sender.
    function submitClaim(bytes32 jobId, uint64 expiry, bytes calldata signature) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (block.timestamp > job.deadline) revert ClaimWindowClosed(jobId, msg.sender, uint256(job.deadline));
        if (msg.sender == job.funder) revert CannotClaimOwnJob();
        Claim storage claim = claims[jobId][msg.sender];
        if (claim.status != ClaimStatus.None) revert AlreadyClaimed();
        if (job.active >= job.slots) revert NoSlotsLeft();
        if (block.timestamp > expiry) revert PermitExpired(expiry);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_PERMIT_TYPEHASH, jobId, msg.sender, expiry))
        );
        if (ECDSA.recover(digest, signature) != claimSigner) revert InvalidPermit();

        job.escrow -= job.reward;
        job.locked += job.reward;
        job.active++;
        claim.status = ClaimStatus.Pending;
        claim.at = uint64(block.timestamp);
        emit ClaimSubmitted(jobId, msg.sender);
    }

    /// @notice Return the EIP-712 claim permit digest for clients and tests.
    function claimPermitDigest(bytes32 jobId, address worker, uint64 expiry) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_PERMIT_TYPEHASH, jobId, worker, expiry))
        );
    }

    /// @notice Approve a pending claim as its funder, crediting the worker internally.
    function approveClaim(bytes32 jobId, address worker) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (msg.sender != job.funder) revert NotFunder(msg.sender, job.funder);
        Claim storage claim = claims[jobId][worker];
        if (claim.status != ClaimStatus.Pending) revert InvalidClaimState(jobId, worker, claim.status);
        _payClaim(jobId, worker, job, claim, PayReason.Approved);
    }

    /// @notice Reject a pending claim strictly before its review period ends.
    /// @dev Starts the worker's dispute window; funds remain locked.
    function rejectClaim(bytes32 jobId, address worker) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (msg.sender != job.funder) revert NotFunder(msg.sender, job.funder);
        Claim storage claim = claims[jobId][worker];
        if (claim.status != ClaimStatus.Pending) revert InvalidClaimState(jobId, worker, claim.status);
        if (block.timestamp >= uint256(claim.at) + job.reviewPeriod) revert ReviewPeriodOver(jobId, worker, uint256(claim.at) + job.reviewPeriod);

        claim.status = ClaimStatus.Rejected;
        claim.at = uint64(block.timestamp);
        emit ClaimRejected(jobId, worker);
    }

    /// @notice Let anyone pay an unreviewed pending claim once its review period ends.
    function finalizeClaim(bytes32 jobId, address worker) external nonReentrant {
        Job storage job = _getJob(jobId);
        Claim storage claim = claims[jobId][worker];
        if (claim.status != ClaimStatus.Pending) revert InvalidClaimState(jobId, worker, claim.status);
        if (block.timestamp < uint256(claim.at) + job.reviewPeriod) revert ReviewPeriodNotOver(jobId, worker, uint256(claim.at) + job.reviewPeriod);
        _payClaim(jobId, worker, job, claim, PayReason.AutoApproved);
    }

    /// @notice Dispute your rejected claim through the inclusive dispute-window endpoint.
    function disputeClaim(bytes32 jobId) external nonReentrant {
        _getJob(jobId);
        Claim storage claim = claims[jobId][msg.sender];
        if (claim.status != ClaimStatus.Rejected) revert InvalidClaimState(jobId, msg.sender, claim.status);
        if (block.timestamp > uint256(claim.at) + DISPUTE_WINDOW) revert DisputeWindowClosed(jobId, msg.sender, uint256(claim.at) + DISPUTE_WINDOW);

        claim.status = ClaimStatus.Disputed;
        claim.at = uint64(block.timestamp);
        emit ClaimDisputed(jobId, msg.sender);
    }

    /// @notice Let anyone return an undisputed rejection to free escrow after its dispute window.
    function releaseRejected(bytes32 jobId, address worker) external nonReentrant {
        Job storage job = _getJob(jobId);
        Claim storage claim = claims[jobId][worker];
        if (claim.status != ClaimStatus.Rejected) revert InvalidClaimState(jobId, worker, claim.status);
        if (block.timestamp <= uint256(claim.at) + DISPUTE_WINDOW) revert DisputeWindowOpen(jobId, worker, uint256(claim.at) + DISPUTE_WINDOW);
        _refundClaim(jobId, worker, job, claim);
    }

    /// @notice Let only the arbiter pay the worker or return a disputed reward to job escrow.
    /// @dev Resolution is only possible strictly before timeout; expiry owns the boundary and beyond.
    function resolveDispute(bytes32 jobId, address worker, bool payWorker) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter(msg.sender, arbiter);
        Job storage job = _getJob(jobId);
        Claim storage claim = claims[jobId][worker];
        if (claim.status != ClaimStatus.Disputed) revert InvalidClaimState(jobId, worker, claim.status);
        if (block.timestamp >= uint256(claim.at) + ARBITER_TIMEOUT) {
            revert ArbiterTimeoutReached(jobId, worker);
        }

        if (payWorker) {
            _payClaim(jobId, worker, job, claim, PayReason.ArbiterDecision);
        } else {
            _refundClaim(jobId, worker, job, claim);
        }
        emit DisputeResolved(jobId, worker, payWorker);
    }

    /// @notice Let anyone split an unresolved dispute once the arbitration timeout is reached.
    /// @dev Odd raw token units round in the funder's favor; a Split still occupies its slot.
    function expireDispute(bytes32 jobId, address worker) external nonReentrant {
        Job storage job = _getJob(jobId);
        Claim storage claim = claims[jobId][worker];
        if (claim.status != ClaimStatus.Disputed) revert InvalidClaimState(jobId, worker, claim.status);
        if (block.timestamp < uint256(claim.at) + ARBITER_TIMEOUT) revert ArbiterTimeoutNotReached(jobId, worker, uint256(claim.at) + ARBITER_TIMEOUT);
        uint256 toWorker = uint256(job.reward) / 2;
        uint256 toFunder = uint256(job.reward) - toWorker;

        job.locked -= job.reward;
        claim.status = ClaimStatus.Split;
        balanceOf[worker] += toWorker;
        balanceOf[job.funder] += toFunder;
        emit DisputeExpired(jobId, worker, toWorker, toFunder);
    }

    /// @notice Reclaim all free job escrow as its funder strictly after the deadline.
    /// @dev Never touches locked claims. Can be repeated when refunds replenish escrow.
    function reclaimJob(bytes32 jobId) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (msg.sender != job.funder) revert NotFunder(msg.sender, job.funder);
        if (block.timestamp <= job.deadline) revert JobStillOpen();
        uint256 amount = job.escrow;
        if (amount == 0) revert NothingToReclaim();

        job.escrow = 0;
        balanceOf[job.funder] += amount;
        emit JobReclaimed(jobId, job.funder, amount);
    }

    // --- Shared job transitions (callers validate authorization and claim state) ---

    /// @dev Resolve existence without treating an absent job as an empty, usable job.
    function _getJob(bytes32 jobId) internal view returns (Job storage job) {
        job = jobs[jobId];
        if (job.funder == address(0)) revert JobNotFound();
    }

    /// @dev Move a locked reward to the worker; paid claims keep their occupied slot.
    function _payClaim(
        bytes32 jobId, address worker, Job storage job, Claim storage claim, PayReason reason
    ) internal {
        job.locked -= job.reward;
        claim.status = ClaimStatus.Paid;
        balanceOf[worker] += job.reward;
        emit ClaimPaid(jobId, worker, job.reward, reason);
    }

    /// @dev Return a locked reward to free escrow and free the slot, but not the worker's claim ID.
    function _refundClaim(bytes32 jobId, address worker, Job storage job, Claim storage claim) internal {
        job.locked -= job.reward;
        job.escrow += job.reward;
        job.active--;
        claim.status = ClaimStatus.Refunded;
        emit ClaimRefunded(jobId, worker);
    }
}
