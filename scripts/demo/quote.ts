import { printLines, runQuoteDemo } from "./lib";

printLines(runQuoteDemo()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
