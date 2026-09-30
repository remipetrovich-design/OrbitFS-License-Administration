import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const head = git(["rev-parse", "HEAD"]);
const shallow = git(["rev-parse", "--is-shallow-repository"]);
if (shallow !== "false") {
  throw new Error("Release manifest requires complete Git history; repository is shallow.");
}

let latestTag = "";
try {
  latestTag = git(["describe", "--tags", "--abbrev=0", "HEAD"]);
} catch {
  latestTag = "";
}

let commits;
let changedFiles;

if (latestTag) {
  commits = git(["log", "--format=%H%x09%an%x09%aI%x09%s", `${latestTag}..HEAD`])
    .split("\n")
    .filter(Boolean);
  changedFiles = git(["diff", "--name-only", `${latestTag}..HEAD`])
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
  schemaVersion: 1,
  repository: process.env.GITHUB_REPOSITORY ?? "lucaskerim123/Custom-licence-manager",
  branch,
  headSha: head,
  previousReleaseTag: latestTag || null,
  commitCount: parsedCommits.length,
  commits: parsedCommits,
  changedFileCount: changedFiles.length,
  changedFiles,
  generatedAt: new Date().toISOString()
};

writeFileSync("release-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({
  headSha: manifest.headSha,
  previousReleaseTag: manifest.previousReleaseTag,
  commitCount: manifest.commitCount,
  changedFileCount: manifest.changedFileCount
}, null, 2));
