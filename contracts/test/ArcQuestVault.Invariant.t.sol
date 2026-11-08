// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcQuestVault} from "../ArcQuestVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Drives bounded random sequences over every state-changing entry point.
contract VaultHandler is Test {
    ArcQuestVault public vault;
    MockERC20 public usdc;
    uint256 public signerPk;
    address public arbiter;

    address[] public actors;
    bytes32[] public jobIds;
    bytes32[] public taskIds;

    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public calls;

    constructor(ArcQuestVault v, MockERC20 u, uint256 pk, address arb) {
        vault = v;
        usdc = u;
        signerPk = pk;
        arbiter = arb;
        for (uint256 i = 0; i < 4; i++) {
            actors.push(makeAddr(string.concat("actor", vm.toString(i))));
            jobIds.push(keccak256(abi.encode("job", i)));
            taskIds.push(keccak256(abi.encode("task", i)));
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function jobCount() external view returns (uint256) {
        return jobIds.length;
    }

    function _a(uint256 i) internal view returns (address) {
        return actors[i % actors.length];
    }

    function _j(uint256 i) internal view returns (bytes32) {
        return jobIds[i % jobIds.length];
    }

    function _t(uint256 i) internal view returns (bytes32) {
        return taskIds[i % taskIds.length];
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 0, 8 days);
        vm.warp(block.timestamp + dt);
    }

    function deposit(uint256 who, uint256 amt) external {
        address a = _a(who);
        amt = bound(amt, 1, 1_000_000e6);
        usdc.mint(a, amt);
        vm.startPrank(a);
        usdc.approve(address(vault), amt);
        vault.deposit(amt);
        vm.stopPrank();
        ghostDeposited += amt;
    }

    function withdraw(uint256 who, uint256 amt) external {
        address a = _a(who);
        uint256 bal = vault.balanceOf(a);
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        vm.prank(a);
        vault.withdraw(amt);
        ghostWithdrawn += amt;
    }

    function fundTask(uint256 who, uint256 t, uint256 amt, uint256 dur) external {
        address a = _a(who);
        uint256 bal = vault.balanceOf(a);
        if (bal == 0) return;
        vm.prank(a);
        vault.fundTask(_t(t), bound(amt, 1, bal), uint64(block.timestamp + bound(dur, 1 days, 60 days)));
    }

    function releaseReward(uint256 who, uint256 t, uint256 to, uint256 amt) external {
        (address f,, uint256 esc) = vault.tasks(_t(t));
        if (f == address(0) || esc == 0) return;
        vm.prank(f);
        vault.releaseReward(_t(t), _a(to), bound(amt, 1, esc));
        who;
    }

    function refundTask(uint256 t, uint256 amt) external {
        (address f,, uint256 esc) = vault.tasks(_t(t));
        if (f == address(0) || esc == 0) return;
        vm.prank(f);
        vault.refundTask(_t(t), bound(amt, 1, esc));
    }

    function createJob(uint256 who, uint256 j, uint256 reward, uint256 slots, uint256 dur, uint256 review)
        external
    {
        address a = _a(who);
        uint256 bal = vault.balanceOf(a);
        reward = bound(reward, 1, 1_000e6);
        slots = bound(slots, 1, 5);
        if (bal < reward * slots) return;
        vm.prank(a);
        vault.createJob(
            _j(j),
            uint128(reward),
            uint32(slots),
            uint64(block.timestamp + bound(dur, 1 days, 40 days)),
            uint32(bound(review, 0, 1) == 0 ? 0 : bound(review, 1 days, 14 days))
        );
    }

    function submitClaim(uint256 who, uint256 j) external {
        address a = _a(who);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes32 digest = vault.claimPermitDigest(_j(j), a, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        vm.prank(a);
        vault.submitClaim(_j(j), expiry, abi.encodePacked(r, s, v));
    }

    function approve(uint256 j, uint256 who) external {
        (address f,,,,,,,) = vault.jobs(_j(j));
        vm.prank(f);
        vault.approveClaim(_j(j), _a(who));
    }

    function reject(uint256 j, uint256 who) external {
        (address f,,,,,,,) = vault.jobs(_j(j));
        vm.prank(f);
        vault.rejectClaim(_j(j), _a(who));
    }

    function finalize(uint256 j, uint256 who) external {
        vault.finalizeClaim(_j(j), _a(who));
    }

    function dispute(uint256 j, uint256 who) external {
        vm.prank(_a(who));
        vault.disputeClaim(_j(j));
    }

    function releaseRejected(uint256 j, uint256 who) external {
        vault.releaseRejected(_j(j), _a(who));
    }

    function resolve(uint256 j, uint256 who, bool pay) external {
        vm.prank(arbiter);
        vault.resolveDispute(_j(j), _a(who), pay);
    }

    function expire(uint256 j, uint256 who) external {
        vault.expireDispute(_j(j), _a(who));
    }

    function reclaim(uint256 j) external {
        (address f,,,,,,,) = vault.jobs(_j(j));
        vm.prank(f);
        vault.reclaimJob(_j(j));
    }

    // ---- views used by invariants ----

    function sumBalances() public view returns (uint256 s) {
        for (uint256 i = 0; i < actors.length; i++) {
            s += vault.balanceOf(actors[i]);
        }
    }

    function sumTaskEscrow() public view returns (uint256 s) {
        for (uint256 i = 0; i < taskIds.length; i++) {
            (,, uint256 e) = vault.tasks(taskIds[i]);
            s += e;
        }
    }

    function sumJobEscrow() public view returns (uint256 s) {
        for (uint256 i = 0; i < jobIds.length; i++) {
            (,,,,,, uint256 e,) = vault.jobs(jobIds[i]);
            s += e;
        }
    }

    function sumJobLocked() public view returns (uint256 s) {
        for (uint256 i = 0; i < jobIds.length; i++) {
            (,,,,,,, uint256 l) = vault.jobs(jobIds[i]);
            s += l;
        }
    }
}

contract ArcQuestVaultInvariantTest is Test {
    ArcQuestVault internal vault;
    MockERC20 internal usdc;
    VaultHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        (address signer, uint256 pk) = makeAddrAndKey("signer");
        address arbiter = makeAddr("arbiter");
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        vault = new ArcQuestVault(IERC20(address(usdc)), arbiter, signer);
        handler = new VaultHandler(vault, usdc, pk, arbiter);
        targetContract(address(handler));
    }

    /// usdc.balanceOf(vault) >= sum(balanceOf) + sum(pool escrow) + sum(job escrow) + sum(job locked)
    function invariant_VaultTokenBalanceCoversAllLiabilities() public view {
        uint256 liabilities =
            handler.sumBalances() + handler.sumTaskEscrow() + handler.sumJobEscrow() + handler.sumJobLocked();
        assertGe(usdc.balanceOf(address(vault)), liabilities);
    }

    /// Nothing else touches the vault, so conservation must be exact (no value created or lost).
    function invariant_ExactConservation() public view {
        uint256 liabilities =
            handler.sumBalances() + handler.sumTaskEscrow() + handler.sumJobEscrow() + handler.sumJobLocked();
        assertEq(usdc.balanceOf(address(vault)), liabilities);
        assertEq(usdc.balanceOf(address(vault)), handler.ghostDeposited() - handler.ghostWithdrawn());
    }

    /// Per job: locked == reward * (#Pending + #Rejected + #Disputed), active == #claims not None/Refunded,
    /// active <= slots, and escrow + locked + paid/split-out rewards == reward*slots - reclaimed (never exceeds).
    function invariant_JobLockedAndActiveMatchClaimStates() public view {
        for (uint256 j = 0; j < handler.jobCount(); j++) {
            bytes32 id = handler.jobIds(j);
            (address f,,, uint32 slots, uint32 active, uint128 reward, uint256 esc, uint256 locked) = vault.jobs(id);
            if (f == address(0)) continue;
            uint256 lockedClaims;
            uint256 activeClaims;
            for (uint256 a = 0; a < handler.actorCount(); a++) {
                (ArcQuestVault.ClaimStatus st,) = vault.claims(id, handler.actors(a));
                if (st == ArcQuestVault.ClaimStatus.Pending || st == ArcQuestVault.ClaimStatus.Rejected
                        || st == ArcQuestVault.ClaimStatus.Disputed) {
                    lockedClaims++;
                }
                if (st != ArcQuestVault.ClaimStatus.None && st != ArcQuestVault.ClaimStatus.Refunded) {
                    activeClaims++;
                }
            }
            assertEq(locked, lockedClaims * uint256(reward), "locked mismatch");
            assertEq(active, activeClaims, "active mismatch");
            assertLe(active, slots, "active > slots");
            assertLe(esc + locked, uint256(reward) * slots, "job overfunded");
        }
    }
}
