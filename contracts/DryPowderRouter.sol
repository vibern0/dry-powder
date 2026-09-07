// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { LimitOpcodes } from "@1inch/swap-vm/src/opcodes/LimitOpcodes.sol";
import { DryPowderStorage } from "./DryPowderStorage.sol";

contract DryPowderRouter is Simulator, SwapVM, LimitOpcodes, DryPowderStorage {
    uint256 public constant DRY_POWDER_OPCODE = 0x34;

    error DryPowderArgsInvalidLength(uint256 length);

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
            _dryPowder(ctx, args);
            return;
        }

        _runOpcode(ctx, opcode, args);
    }

    function _dryPowder(Context memory ctx, bytes calldata args) internal {
        if (args.length != 32) revert DryPowderArgsInvalidLength(args.length);

        bytes32 reserveId = bytes32(args);
        if (!ctx.vm.isStaticContext) {
            emit DryPowderOpcodeReached(ctx.query.maker, reserveId, ctx.query.tokenIn, ctx.query.tokenOut);
        }
    }
}
