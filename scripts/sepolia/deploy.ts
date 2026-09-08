import { deploySepoliaContracts, printLines } from "./lib";

printLines(deploySepoliaContracts()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
