import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-dependency-compiler";
import "hardhat-tracer";
import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true
    },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL ?? "",
      accounts: process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY ? [process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY] : []
    },
    base: {
      chainId: 8453,
      url: process.env.BASE_RPC_URL ?? "",
      accounts: process.env.BASE_DEPLOYER_PRIVATE_KEY ? [process.env.BASE_DEPLOYER_PRIVATE_KEY] : []
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
