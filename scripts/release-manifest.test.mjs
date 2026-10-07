import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const manifestScript=join(here,"release-manifest.mjs");
const root=mkdtempSync(join(tmpdir(),"orbitfs-release-manifest-"));
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

init(target);
write(target,"app.txt","v1\n");
const targetBase=commit(target,"production baseline");
write(target,"app.txt","v2\n");
const targetHead=commit(target,"next change");

run(target,process.execPath,[manifestScript],{
 RELEASE_BASE_SHA:targetBase,
 RELEASE_BASE_REPOSITORY:"remipetrovich-design/OrbitFS-License-Administration",
 GITHUB_REPOSITORY:"remipetrovich-design/OrbitFS-License-Administration",
 GITHUB_REF_NAME:"main"
});
const localManifest=JSON.parse(readFileSync(join(target,"release-manifest.json"),"utf8"));
if(localManifest.schemaVersion!==3)throw new Error("Expected release manifest schemaVersion 3");
if(localManifest.previousDeploymentSha!==targetBase)throw new Error("Local production SHA was not preserved");
if(localManifest.previousDeploymentRepository!=="remipetrovich-design/OrbitFS-License-Administration")throw new Error("Local repository identity was not preserved");
if(localManifest.changeBaseSha!==targetBase)throw new Error("Local production baseline changed unexpectedly");
if(localManifest.changeBaseSource!=="previous-production-deployment")throw new Error("Local baseline source changed unexpectedly");
if(localManifest.headSha!==targetHead)throw new Error("Target HEAD mismatch");
if(JSON.stringify(localManifest.changedFiles)!==JSON.stringify(["app.txt"]))throw new Error("Local diff should contain only the post-baseline app change");

let rejected=false;
try{
 run(target,process.execPath,[manifestScript],{
  RELEASE_BASE_SHA:targetBase,
  RELEASE_BASE_REPOSITORY:"other-owner/other-license-manager",
  GITHUB_REPOSITORY:"remipetrovich-design/OrbitFS-License-Administration",
  GITHUB_REF_NAME:"main"
 });
}catch{rejected=true}
if(!rejected)throw new Error("Cross-repository production baseline must be rejected");

console.log("release-manifest local baseline tests passed");
