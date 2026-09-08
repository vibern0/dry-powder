// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { LimitSwap } from "@1inch/swap-vm/src/instructions/LimitSwap.sol";
import { DryPowder } from "./DryPowder.sol";

contract DryPowderRouter is SwapVM, LimitSwap, DryPowder {
    using ContextLib for Context;

    uint256 private constant SALT_OPCODE = 0x1e;
    uint256 private constant LIMIT_SWAP_OPCODE = 0x15;
    uint256 public constant DRY_POWDER_OPCODE = 0x34;

    error UnknownOpcode(uint256 opcode);

    event DryPowderOpcodeReached(
        address indexed maker,
        bytes32 indexed reserveId,
        address indexed tokenIn,
        address tokenOut
    );

    constructor(
        address aqua,
        address weth,
        address owner,
        string memory name,
        string memory version
    ) SwapVM(aqua, weth, owner, name, version) {}

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == DRY_POWDER_OPCODE) {
            (uint256 balanceIn, uint256 balanceOut, uint256 amountIn, uint256 amountOut) = _runDryPowder(ctx, args);
            ctx.swap.balanceIn = balanceIn;
            ctx.swap.balanceOut = balanceOut;
            ctx.swap.amountIn = amountIn;
            ctx.swap.amountOut = amountOut;
            ctx.vm.nextPC = ctx.program().length;
            if (!ctx.vm.isStaticContext) {
                emit DryPowderOpcodeReached(ctx.query.maker, bytes32(args), ctx.query.tokenIn, ctx.query.tokenOut);
            }
            return;
        }

        if (opcode == LIMIT_SWAP_OPCODE) {
            _limitSwap1D(ctx, args);
            return;
        }

        if (opcode == SALT_OPCODE) {
            return;
        }

        revert UnknownOpcode(opcode);
    }
}
