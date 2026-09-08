import { printLines, quoteSepoliaDemo } from "./lib";

printLines(quoteSepoliaDemo()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
