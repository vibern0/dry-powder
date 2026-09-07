import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-dependency-compiler";
import "hardhat-tracer";
import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true
    }
  },
  solidity: {
    compilers: [
      {
        version: "0.8.30",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
            details: {
              yul: true,
              yulDetails: {
                stackAllocation: true,
                optimizerSteps: "dhfoDgvulfnTUtnIf"
              }
            }
          },
          evmVersion: "cancun",
          viaIR: true
        }
      }
    ]
  },
  dependencyCompiler: {
    paths: [
      "@1inch/aqua/src/Aqua.sol",
      "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol",
      "@1inch/swap-vm/src/routers/LimitSwapVMRouter.sol",
      "@1inch/swap-vm/test/mocks/WETHMock.sol"
    ]
  },
  typechain: {
    outDir: "typechain-types"
  }
};

export default config;
