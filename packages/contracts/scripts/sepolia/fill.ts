import { fillSepoliaEth, printLines } from "./lib";

printLines(fillSepoliaEth()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
