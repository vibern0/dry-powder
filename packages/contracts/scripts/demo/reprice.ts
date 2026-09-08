import { printLines, runRepriceDemo } from "./lib";

printLines(runRepriceDemo()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
