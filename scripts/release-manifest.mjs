import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const git = (args, options = {}) =>
  execFileSync("git", args, { encoding: "utf8", stdio: [options.stdin ?? "ignore", "pipe", "pipe"] }).trim();
const gitRaw = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const head = git(["rev-parse", "HEAD"]);
const shallow = git(["rev-parse", "--is-shallow-repository"]);
if (shallow !== "false") {
  throw new Error("Release manifest requires complete Git history; repository is shallow.");
}

const requestedBase = String(process.env.RELEASE_BASE_SHA || "").trim();
const currentRepository = String(process.env.GITHUB_REPOSITORY || "lucaskerim123/Custom-licence-manager").trim();
const requestedBaseRepository = String(process.env.RELEASE_BASE_REPOSITORY || currentRepository).trim();
const allowedMirrorRepositories = new Set([
  "lucaskerim123/Custom-licence-manager",
  "remipetrovich-design/OrbitFS-License-Administration",
]);

const validRepository = (value) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
const isWorkflowPath = (path) => path === ".github/workflows" || path.startsWith(".github/workflows/");

function resolveCommit(ref) {
  return git(["rev-parse", "--verify", `${ref}^{commit}`]);
}

function normalizedSourceFingerprint(ref) {
  const rows = gitRaw(["ls-tree", "-r", "-z", ref])
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab < 0) throw new Error(`Unexpected git ls-tree row for ${ref}`);
      const meta = line.slice(0, tab);
      const path = line.slice(tab + 1);
      return { meta, path };
    })
    .filter(({ path }) => !isWorkflowPath(path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ meta, path }) => `${meta}\t${path}\0`)
    .join("");
  return createHash("sha256").update(rows).digest("hex");
}

function fetchForeignBase(repository, sha) {
  if (!validRepository(repository)) {
    throw new Error(`Invalid previous production repository metadata: ${repository || "missing"}`);
  }
  if (!allowedMirrorRepositories.has(currentRepository) || !allowedMirrorRepositories.has(repository)) {
    throw new Error(`Previous production repository is not an approved License Manager mirror: ${repository}`);
  }
  const remote = String(process.env.RELEASE_BASE_GIT_URL || `https://github.com/${repository}.git`).trim();
  if (!remote) throw new Error("Previous production mirror URL is empty.");
  try {
    execFileSync("git", ["fetch", "--quiet", "--no-tags", remote, sha], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(`Unable to fetch previous production commit ${repository}@${sha}: ${detail}`);
  }
  const fetched = resolveCommit("FETCH_HEAD");
  if (fetched !== sha) {
    throw new Error(`Fetched previous production commit does not match requested SHA: expected ${sha}, got ${fetched}`);
  }
  return fetched;
}

function findLocalMirrorEquivalent(foreignCommit) {
  const fingerprint = normalizedSourceFingerprint(foreignCommit);
  const candidates = git(["rev-list", "HEAD"]).split("\n").filter(Boolean);
  for (const candidate of candidates) {
    if (normalizedSourceFingerprint(candidate) === fingerprint) {
      return { sha: candidate, fingerprint };
    }
  }
  throw new Error(
    `Previous production source does not have an equivalent commit in the current mirror history. ` +
    `Foreign commit: ${requestedBaseRepository}@${foreignCommit}; fingerprint: ${fingerprint}`
  );
}

let baseSha = "";
let baseSource = "";
let previousReleaseTag = "";
let mirrorEquivalentSha = "";
let previousSourceFingerprint = "";

if (requestedBase) {
  try {
    baseSha = resolveCommit(requestedBase);
    baseSource = "previous-production-deployment";
  } catch {
    if (!requestedBaseRepository || requestedBaseRepository === currentRepository) {
      throw new Error(
        `Previous production deployment commit is not present in Git history and no foreign mirror can resolve it: ${requestedBase}`
      );
    }
    const foreignCommit = fetchForeignBase(requestedBaseRepository, requestedBase);
    const equivalent = findLocalMirrorEquivalent(foreignCommit);
    baseSha = equivalent.sha;
    mirrorEquivalentSha = equivalent.sha;
    previousSourceFingerprint = equivalent.fingerprint;
    baseSource = "previous-production-deployment-mirror-equivalent";
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, head], { stdio: "ignore" });
  } catch {
    throw new Error(`Resolved previous production baseline ${baseSha} is not an ancestor of ${head}.`);
  }
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
  schemaVersion: 3,
  repository: currentRepository,
  branch,
  headSha: head,
  previousDeploymentSha: requestedBase || null,
  previousDeploymentRepository: requestedBase ? requestedBaseRepository || null : null,
  mirrorEquivalentSha: mirrorEquivalentSha || null,
  previousSourceFingerprint: previousSourceFingerprint || null,
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
  previousDeploymentRepository: manifest.previousDeploymentRepository,
  mirrorEquivalentSha: manifest.mirrorEquivalentSha,
  changeBaseSha: manifest.changeBaseSha,
  changeBaseSource: manifest.changeBaseSource,
  commitCount: manifest.commitCount,
  changedFileCount: manifest.changedFileCount
}, null, 2));
