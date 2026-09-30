import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (label, command, args) => {
  console.log("\n=== " + label + " ===");
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (!existsSync("package-lock.json")) {
  console.error("PRODUCTION PREFLIGHT BLOCKED: package-lock.json is missing.");
  console.error("Create it with: npm install --package-lock-only");
  console.error("Then commit package-lock.json before attempting production deployment.");
  process.exit(1);
}

if (!existsSync("vercel.json")) {
  console.error("PRODUCTION PREFLIGHT BLOCKED: vercel.json is missing.");
  process.exit(1);
}

const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));
if (vercelConfig?.git?.deploymentEnabled !== false) {
  console.error("PRODUCTION PREFLIGHT BLOCKED: automatic Vercel Git deployments are not disabled.");
  console.error('Expected vercel.json to contain: "git": { "deploymentEnabled": false }');
  process.exit(1);
}

run("Clean locked dependency install", npm, ["ci"]);
run("Whitespace / patch integrity", "git", ["diff", "--check"]);
run("Lint", npm, ["run", "lint"]);
run("Typecheck", npm, ["run", "typecheck"]);
run("Dependency audit", npm, ["audit", "--audit-level=high"]);
run("Production build", npm, ["run", "build"]);

console.log("\n=== Preflight PASSED ===");
