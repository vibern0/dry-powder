import { printLines, setupSepoliaDemo } from "./lib";

printLines(setupSepoliaDemo()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
