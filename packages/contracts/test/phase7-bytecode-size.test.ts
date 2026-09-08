import { expect } from "chai";
import { artifacts } from "hardhat";

const MAX_PUBLIC_EVM_RUNTIME_BYTES = 24_576;

describe("Phase 7 Sepolia deploy readiness", function () {
  it("keeps DryPowderRouter under the public EVM runtime bytecode limit", async function () {
    const artifact = await artifacts.readArtifact("DryPowderRouter");
    const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;

    expect(runtimeBytes).to.be.lessThanOrEqual(MAX_PUBLIC_EVM_RUNTIME_BYTES);
  });
});
