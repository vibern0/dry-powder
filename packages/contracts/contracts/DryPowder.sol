// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { DryPowderStorage } from "./DryPowderStorage.sol";

abstract contract DryPowder is DryPowderStorage {
    using Math for uint256;

    uint256 private constant BPS_BASE = 10_000;

    error DryPowderArgsInvalidLength(uint256 length);
    error ReserveInactive(address maker, bytes32 reserveId);
    error DryPowderWrongDirection(address tokenIn, address tokenOut, address reserveToken);
    error DryPowderLegNotFound(address maker, bytes32 reserveId, address token);

    event ReserveConsumed(address indexed maker, bytes32 indexed reserveId, address indexed tokenIn, uint256 reserveAmount);

    function _runDryPowder(
        Context memory ctx,
        bytes calldata args
    ) internal returns (uint256 balanceIn, uint256 balanceOut, uint256 amountIn, uint256 amountOut) {
        if (args.length != 32) revert DryPowderArgsInvalidLength(args.length);

        bytes32 reserveId = bytes32(args);
        Layout storage $ = _layout();
        Reserve storage reserve = $.reserves[ctx.query.maker][reserveId];
        _requireReserve(reserve);
        if (!reserve.active) revert ReserveInactive(ctx.query.maker, reserveId);
        if (ctx.query.tokenOut != reserve.reserveToken) {
            revert DryPowderWrongDirection(ctx.query.tokenIn, ctx.query.tokenOut, reserve.reserveToken);
        }

        Leg storage leg = $.legs[ctx.query.maker][reserveId][ctx.query.tokenIn];
        if (!leg.exists) revert DryPowderLegNotFound(ctx.query.maker, reserveId, ctx.query.tokenIn);

        (uint256 trancheRemaining, uint256 multiplierBps) = _currentTranche($, ctx.query.maker, reserveId, reserve.spent);
        uint256 capacity = _min(
            reserve.totalBudget - reserve.spent,
            leg.maxSpend - leg.spent,
            IERC20(ctx.query.tokenOut).balanceOf(ctx.query.maker),
            trancheRemaining
        );

        (balanceIn, balanceOut) = _applyCapacity(ctx.swap.balanceIn, ctx.swap.balanceOut, capacity, multiplierBps);
        (amountIn, amountOut) = _previewLimitSwap(ctx, balanceIn, balanceOut);

        if (!ctx.vm.isStaticContext) {
            reserve.spent += amountOut;
            leg.spent += amountOut;
            emit ReserveConsumed(ctx.query.maker, reserveId, ctx.query.tokenIn, amountOut);
        }
    }

    function _currentTranche(
        Layout storage $,
        address maker,
        bytes32 reserveId,
        uint256 spent
    ) private view returns (uint256 remaining, uint256 multiplierBps) {
        uint256[] storage thresholds = $.thresholds[maker][reserveId];
        uint256[] storage multipliers = $.multipliersBps[maker][reserveId];

        for (uint256 i; i < thresholds.length; i++) {
            if (spent < thresholds[i]) {
                return (thresholds[i] - spent, multipliers[i]);
            }
        }

        return (0, multipliers[multipliers.length - 1]);
    }

    function _applyCapacity(
        uint256 balanceIn,
        uint256 balanceOut,
        uint256 capacity,
        uint256 multiplierBps
    ) private pure returns (uint256 cappedBalanceIn, uint256 cappedBalanceOut) {
        uint256 adjustedBalanceOut = balanceOut * multiplierBps / BPS_BASE;
        if (adjustedBalanceOut <= capacity) {
            return (balanceIn, adjustedBalanceOut);
        }

        if (adjustedBalanceOut == 0 || capacity == 0) {
            return (0, 0);
        }

        return ((balanceIn * capacity).ceilDiv(adjustedBalanceOut), capacity);
    }

    function _previewLimitSwap(
        Context memory ctx,
        uint256 balanceIn,
        uint256 balanceOut
    ) private pure returns (uint256 amountIn, uint256 amountOut) {
        if (ctx.query.isExactIn) {
            if (ctx.swap.amountIn >= balanceIn) {
                return (balanceIn, balanceOut);
            }

            return (ctx.swap.amountIn, ctx.swap.amountIn * balanceOut / balanceIn);
        }

        if (ctx.swap.amountOut >= balanceOut) {
            return (balanceIn, balanceOut);
        }

        return ((ctx.swap.amountOut * balanceIn).ceilDiv(balanceOut), ctx.swap.amountOut);
    }

    function _min(uint256 a, uint256 b, uint256 c, uint256 d) private pure returns (uint256) {
        return Math.min(Math.min(a, b), Math.min(c, d));
    }
}
