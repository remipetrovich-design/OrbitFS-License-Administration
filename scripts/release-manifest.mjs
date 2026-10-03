import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const git = (args, options = {}) =>
  execFileSync("git", args, { encoding: "utf8", stdio: [options.stdin ?? "ignore", "pipe", "pipe"] }).trim();

const head = git(["rev-parse", "HEAD"]);
const shallow = git(["rev-parse", "--is-shallow-repository"]);
if (shallow !== "false") {
  throw new Error("Release manifest requires complete Git history; repository is shallow.");
}

const requestedBase = String(process.env.RELEASE_BASE_SHA || "").trim();
let baseSha = "";
let baseSource = "";
let previousReleaseTag = "";

if (requestedBase) {
  try {
    baseSha = git(["rev-parse", "--verify", `${requestedBase}^{commit}`]);
  } catch {
    throw new Error(`Previous production deployment commit is not present in Git history: ${requestedBase}`);
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, head], { stdio: "ignore" });
  } catch {
    throw new Error(`Previous production deployment commit ${baseSha} is not an ancestor of ${head}.`);
  }
  baseSource = "previous-production-deployment";
} else {
  try {
    previousReleaseTag = git(["describe", "--tags", "--abbrev=0", "HEAD"]);
    baseSha = git(["rev-list", "-n", "1", previousReleaseTag]);
    baseSource = "latest-tag-fallback";
  } catch {
    baseSha = "";
    baseSource = "repository-root-fallback";
  }
}

let commits;
let changedFiles;

if (baseSha) {
  commits = git(["log", "--reverse", "--format=%H%x09%an%x09%aI%x09%s", `${baseSha}..HEAD`])
    .split("\n")
    .filter(Boolean);
  changedFiles = git(["diff", "--name-only", `${baseSha}..HEAD`])
    .split("\n")
    .filter(Boolean);
} else {
  commits = git(["log", "--format=%H%x09%an%x09%aI%x09%s", "--reverse", "HEAD"])
    .split("\n")
    .filter(Boolean);
  changedFiles = git(["ls-tree", "-r", "--name-only", "HEAD"])
    .split("\n")
    .filter(Boolean);
}

const parsedCommits = commits.map((line) => {
  const [sha, author, timestamp, ...subject] = line.split("\t");
  return { sha, author, timestamp, subject: subject.join("\t") };
});

const branch = process.env.GITHUB_REF_NAME || git(["branch", "--show-current"]) || "detached";

const manifest = {
  schemaVersion: 2,
  repository: process.env.GITHUB_REPOSITORY ?? "lucaskerim123/Custom-licence-manager",
  branch,
  headSha: head,
  previousDeploymentSha: requestedBase ? baseSha : null,
  changeBaseSha: baseSha || null,
  changeBaseSource: baseSource,
  previousReleaseTag: previousReleaseTag || null,
  commitCount: parsedCommits.length,
  commits: parsedCommits,
  changedFileCount: changedFiles.length,
  changedFiles,
  generatedAt: new Date().toISOString()
};

writeFileSync("release-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({
  headSha: manifest.headSha,
  previousDeploymentSha: manifest.previousDeploymentSha,
  changeBaseSha: manifest.changeBaseSha,
  changeBaseSource: manifest.changeBaseSource,
  commitCount: manifest.commitCount,
  changedFileCount: manifest.changedFileCount
}, null, 2));
