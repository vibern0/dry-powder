const fs = require("node:fs");
const path = require("node:path");

const forgeStdPackage = require.resolve("forge-std/package.json");
const sourceDir = path.join(path.dirname(forgeStdPackage), "src");
const targetDir = path.resolve(__dirname, "../../../node_modules/forge-std");
const hardhatDependencyDir = path.resolve(__dirname, "../contracts/hardhat-dependency-compiler");

fs.mkdirSync(hardhatDependencyDir, { recursive: true });
fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

for (const entry of fs.readdirSync(sourceDir)) {
  fs.cpSync(path.join(sourceDir, entry), path.join(targetDir, entry), { recursive: true });
}
