import { printLines, runFullDemo } from "./lib";

printLines(runFullDemo()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
