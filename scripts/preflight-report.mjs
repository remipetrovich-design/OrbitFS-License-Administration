import {mkdirSync,rmSync,writeFileSync,existsSync,readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const dir=".orbitfs-validation";rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
const npm=process.platform==="win32"?"npm.cmd":"npm";const failures=[];
const run=(label,command,args)=>{console.log("\n=== "+label+" ===");const r=spawnSync(command,args,{encoding:"utf8",shell:false});if(r.status!==0){failures.push({label,exitCode:r.status??1});console.error([r.stdout,r.stderr].join("\n"));return false;}return true;};
if(!existsSync("package-lock.json"))failures.push({label:"lockfile",exitCode:1});
if(!existsSync("vercel.json"))failures.push({label:"vercel.json",exitCode:1});
run("npm ci",npm,["ci"]);
run("lint",npm,["run","lint"]);
run("typecheck",npm,["run","typecheck"]);
run("build",npm,["run","build"]);
if(failures.length){writeFileSync(dir+"/validation-error.txt",JSON.stringify(failures,null,2));process.exit(1);}
console.log("\n=== Preflight PASSED ===");
