import { printLines, repriceSepoliaDemo } from "./lib";

printLines(repriceSepoliaDemo()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
