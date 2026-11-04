// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArcQuestVault
/// @notice Permissionless ERC-20 USDC balances and funder-controlled task escrows.
/// @dev Amounts are raw token units (6 decimals for USDC), never native currency.
///      Invariant: usdc.balanceOf(vault) >= sum(all balanceOf) + sum(all task escrow).
///      Assumes USDC does not rebase or debit the vault beyond a requested transfer.
contract ArcQuestVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error InvalidAmount();
    error InsufficientBalance(uint256 available, uint256 requested);
    error NotFunder();
    error InvalidRefundTime();
    error InsufficientEscrow(uint256 available, uint256 requested);
    error RefundLocked(uint64 refundableAfter);

    IERC20 public immutable usdc;
    mapping(address => uint256) public balanceOf;

    struct Task {
        address funder;
        uint64 refundableAfter;
        uint256 escrow;
    }

    mapping(bytes32 => Task) public tasks;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event TaskFunded(
        bytes32 indexed taskId, address indexed funder, uint256 amount, uint64 refundableAfter
    );
    event RewardReleased(bytes32 indexed taskId, address indexed worker, uint256 amount);
    event TaskRefunded(bytes32 indexed taskId, address indexed funder, uint256 amount);

    /// @notice Bind the vault permanently to an ERC-20 USDC contract.
    /// @param usdc_ USDC's ERC-20 interface address, not a native-currency interface.
    constructor(IERC20 usdc_) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
    }

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

    /// @notice Fund or top up the caller's task escrow from their available balance.
    /// @dev Task IDs remain bound to their original funder even after escrow is emptied.
    /// @param taskId Unique task identifier.
    /// @param amount Positive amount to escrow, in raw token units.
    /// @param refundableAfter Future refund timestamp, at most 365 days away;
    ///        an existing task's timestamp cannot decrease.
    function fundTask(bytes32 taskId, uint256 amount, uint64 refundableAfter) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        Task storage task = tasks[taskId];
        if (task.funder != address(0) && task.funder != msg.sender) revert NotFunder();
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
        if (task.funder != msg.sender) revert NotFunder();
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
        if (task.funder != msg.sender) revert NotFunder();
        if (block.timestamp < task.refundableAfter) revert RefundLocked(task.refundableAfter);
        if (amount == 0) revert InvalidAmount();
        uint256 available = task.escrow;
        if (amount > available) revert InsufficientEscrow(available, amount);

        task.escrow = available - amount;
        balanceOf[task.funder] += amount;
        emit TaskRefunded(taskId, msg.sender, amount);
    }
}
