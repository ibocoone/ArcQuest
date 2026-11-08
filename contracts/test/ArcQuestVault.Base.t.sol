// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcQuestVault} from "../ArcQuestVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

abstract contract ArcQuestVaultTestBase is Test {
    ArcQuestVault internal vault;
    MockERC20 internal usdc;

    address internal arbiter = makeAddr("arbiter");
    address internal signer;
    uint256 internal signerPk;
    address internal funder = makeAddr("funder");
    address internal worker = makeAddr("worker");
    address internal worker2 = makeAddr("worker2");
    address internal other = makeAddr("other");

    uint256 internal constant T0 = 1_700_000_000;
    bytes32 internal constant JOB = keccak256("job-1");
    bytes32 internal constant TASK = keccak256("task-1");
    uint128 internal constant REWARD = 100e6;
    uint32 internal constant SLOTS = 3;
    uint256 internal constant FUNDER_DEPOSIT = 10_000e6;

    uint256 internal constant DEFAULT_REVIEW = 3 days;
    uint256 internal constant DISPUTE_WINDOW = 7 days;
    uint256 internal constant ARB_TIMEOUT = 14 days;

    function setUp() public virtual {
        vm.warp(T0);
        (signer, signerPk) = makeAddrAndKey("signer");
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        vault = new ArcQuestVault(IERC20(address(usdc)), arbiter, signer);
        _fund(funder, FUNDER_DEPOSIT);
    }

    // --- helpers ---

    function _fund(address user, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function _deadline() internal pure returns (uint64) {
        return uint64(T0 + 30 days);
    }

    /// Creates JOB (REWARD x SLOTS, default review period, deadline T0+30d) as `funder`.
    function _newJob() internal {
        _newJobWith(JOB, REWARD, SLOTS, _deadline(), 0);
    }

    function _newJobWith(bytes32 id, uint128 reward, uint32 slots, uint64 dl, uint32 review) internal {
        vm.prank(funder);
        vault.createJob(id, reward, slots, dl, review);
    }

    function _permit(bytes32 id, address w, uint64 expiry) internal view returns (bytes memory) {
        return _permitWith(signerPk, id, w, expiry);
    }

    function _permitWith(uint256 pk, bytes32 id, address w, uint64 expiry)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = vault.claimPermitDigest(id, w, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _claimOn(bytes32 id, address w) internal {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory sig = _permit(id, w, expiry);
        vm.prank(w);
        vault.submitClaim(id, expiry, sig);
    }

    function _claim(address w) internal {
        _claimOn(JOB, w);
    }

    function _status(address w) internal view returns (ArcQuestVault.ClaimStatus st) {
        (st,) = vault.claims(JOB, w);
    }

    function _claimAt(address w) internal view returns (uint64 at) {
        (, at) = vault.claims(JOB, w);
    }

    function _job()
        internal
        view
        returns (uint32 active, uint256 escrow, uint256 locked)
    {
        (,,,, active,, escrow, locked) = vault.jobs(JOB);
    }

    function _taskEscrow(bytes32 id) internal view returns (uint256 e) {
        (,, e) = vault.tasks(id);
    }

    /// Job + pending claim by `worker` (created at T0).
    function _jobWithPendingClaim() internal {
        _newJob();
        _claim(worker);
    }

    function _reject(address w) internal {
        vm.prank(funder);
        vault.rejectClaim(JOB, w);
    }

    function _dispute(address w) internal {
        vm.prank(w);
        vault.disputeClaim(JOB);
    }

    /// Claim by `worker`, rejected, then disputed (disputed at T0 + 1 day).
    function _jobWithDisputedClaim() internal {
        _jobWithPendingClaim();
        skip(1 days);
        _reject(worker);
        _dispute(worker);
    }
}
