import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const manifestScript=join(here,"release-manifest.mjs");
const root=mkdtempSync(join(tmpdir(),"orbitfs-release-manifest-"));
const source=join(root,"source");
const target=join(root,"target");

function run(cwd,command,args,env={}){
 return execFileSync(command,args,{cwd,env:{...process.env,...env},encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
}
function git(cwd,...args){return run(cwd,"git",args)}
function init(cwd){
 mkdirSync(cwd,{recursive:true});
 git(cwd,"init","-q");
 git(cwd,"config","user.email","test@example.invalid");
 git(cwd,"config","user.name","OrbitFS Test");
 git(cwd,"branch","-M","main");
}
function write(cwd,path,value){
 const full=join(cwd,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,value);
}
function commit(cwd,message){
 git(cwd,"add","-A");git(cwd,"commit","-q","-m",message);return git(cwd,"rev-parse","HEAD");
}

init(source);
write(source,"app.txt","v1\n");
write(source,".github/workflows/source.yml","name: source\n");
const sourceBase=commit(source,"primary production baseline");

init(target);
write(target,"app.txt","v1\n");
write(target,".github/workflows/fallback.yml","name: fallback\n");
const targetBase=commit(target,"mirror equivalent baseline");
write(target,"app.txt","v2\n");
const targetHead=commit(target,"fallback change");

run(target,process.execPath,[manifestScript],{
 RELEASE_BASE_SHA:sourceBase,
 RELEASE_BASE_REPOSITORY:"lucaskerim123/Custom-licence-manager",
 RELEASE_BASE_GIT_URL:source,
 GITHUB_REPOSITORY:"remipetrovich-design/OrbitFS-License-Administration",
 GITHUB_REF_NAME:"main"
});
const mirrorManifest=JSON.parse(readFileSync(join(target,"release-manifest.json"),"utf8"));
if(mirrorManifest.schemaVersion!==3)throw new Error("Expected release manifest schemaVersion 3");
if(mirrorManifest.previousDeploymentSha!==sourceBase)throw new Error("Foreign production SHA was not preserved");
if(mirrorManifest.changeBaseSha!==targetBase)throw new Error("Equivalent fallback commit was not selected");
if(mirrorManifest.mirrorEquivalentSha!==targetBase)throw new Error("Mirror equivalent SHA was not recorded");
if(mirrorManifest.changeBaseSource!=="previous-production-deployment-mirror-equivalent")throw new Error("Mirror baseline source was not recorded");
if(mirrorManifest.headSha!==targetHead)throw new Error("Target HEAD mismatch");
if(JSON.stringify(mirrorManifest.changedFiles)!==JSON.stringify(["app.txt"]))throw new Error("Mirror diff should contain only the post-baseline app change");

run(target,process.execPath,[manifestScript],{
 RELEASE_BASE_SHA:targetBase,
 RELEASE_BASE_REPOSITORY:"remipetrovich-design/OrbitFS-License-Administration",
 GITHUB_REPOSITORY:"remipetrovich-design/OrbitFS-License-Administration",
 GITHUB_REF_NAME:"main"
});
const localManifest=JSON.parse(readFileSync(join(target,"release-manifest.json"),"utf8"));
if(localManifest.changeBaseSha!==targetBase)throw new Error("Local production baseline changed unexpectedly");
if(localManifest.changeBaseSource!=="previous-production-deployment")throw new Error("Local baseline source changed unexpectedly");

console.log("release-manifest mirror baseline tests passed");
