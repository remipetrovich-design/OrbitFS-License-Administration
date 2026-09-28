import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const head = git(["rev-parse", "HEAD"]);
const shallow = git(["rev-parse", "--is-shallow-repository"]);
if (shallow !== "false") {
  throw new Error("Release manifest requires complete Git history; repository is shallow.");
}

const branch = process.env.GITHUB_REF_NAME || git(["branch", "--show-current"]) || "detached";
const manifest = {
  schemaVersion: 1,
  repository: process.env.GITHUB_REPOSITORY ?? "remipetrovich-design/OrbitFS-License-Administration",
  branch,
  headSha: head,
  generatedAt: new Date().toISOString()
};

writeFileSync("release-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ headSha: manifest.headSha }, null, 2));
