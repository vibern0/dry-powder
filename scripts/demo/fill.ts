import { printLines, runFillDemo } from "./lib";

printLines(runFillDemo()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
