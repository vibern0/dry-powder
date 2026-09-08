import { printLines, runSetupDemo } from "./lib";

printLines(runSetupDemo()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
