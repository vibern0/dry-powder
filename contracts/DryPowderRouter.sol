// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { LimitOpcodes } from "@1inch/swap-vm/src/opcodes/LimitOpcodes.sol";
import { DryPowder } from "./DryPowder.sol";

contract DryPowderRouter is Simulator, SwapVM, LimitOpcodes, DryPowder {
    using ContextLib for Context;

    uint256 public constant DRY_POWDER_OPCODE = 0x34;

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
    ) SwapVM(aqua, weth, owner, name, version) LimitOpcodes(aqua) {}

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

        _runOpcode(ctx, opcode, args);
    }
}
