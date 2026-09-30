import {mkdirSync,rmSync,writeFileSync,existsSync,readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const dir=".orbitfs-validation";rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
const npm=process.platform==="win32"?"npm.cmd":"npm";const failures=[];
const errorLine=/(?:##\[error\]|npm ERR!|Error:|error TS\d+|Type error|Build failed|failed with|Expected .+ got|SyntaxError|ReferenceError|Module not found|Cannot find module|ENOENT|EADDRINUSE|ERR!|\bERROR\b)/i;
const clean=(line)=>String(line||"").replace(/^.*?##\[error\]\s*/,"").trim();
const contexts=(output)=>{
 const lines=String(output||"").split(/\r?\n/).map(x=>x.trimEnd()).filter(Boolean);
 const hits=[];
 for(let i=0;i<lines.length;i++)if(errorLine.test(lines[i]))hits.push(i);
 if(!hits.length)return ["No identifiable error lines were found in command output."];
 const selected=[];const seen=new Set();
 for(const hit of hits){
   for(let i=Math.max(0,hit-5);i<=hit;i++){
     const line=clean(lines[i]);if(!line||seen.has(line))continue;seen.add(line);selected.push(line);
   }
   if(selected.length>=120)break;
 }
 return selected.slice(-120);
};
const run=(label,command,args)=>{
 console.log("\n=== "+label+" ===");const r=spawnSync(command,args,{encoding:"utf8",shell:false});
 const output=[r.stdout||"",r.stderr||""].join("\n").trim();
 if(r.status!==0){failures.push({label,exitCode:r.status??1,output:contexts(output)});console.error(output);return false;}
 return true;
};
if(!existsSync("package-lock.json"))failures.push({label:"Repository / lockfile",exitCode:1,output:["package-lock.json is missing."]});
if(!existsSync("vercel.json"))failures.push({label:"Vercel configuration",exitCode:1,output:["vercel.json is missing."]});
else{try{const v=JSON.parse(readFileSync("vercel.json","utf8"));if(v?.git?.deploymentEnabled!==false)failures.push({label:"Automatic Vercel deployments",exitCode:1,output:["vercel.json does not disable automatic Git deployments."]});}catch(e){failures.push({label:"Vercel configuration",exitCode:1,output:[String(e)]});}}
run("Clean locked dependency install",npm,["ci"]);
run("Whitespace / patch integrity","git",["diff","--check"]);
run("Lint",npm,["run","lint"]);
run("Typecheck",npm,["run","typecheck"]);
run("Dependency audit",npm,["audit","--audit-level=high"]);
run("Production build",npm,["run","build"]);
if(failures.length){const out=["ORBITFS VALIDATION FAILED","========================","All detected failure contexts are retained. Successful-step output is excluded.","","Failures: "+failures.length,""];for(const f of failures)out.push("## "+f.label,"Exit code: "+f.exitCode,"","ERRORS:",...(f.output||["(no error output)"]),"");writeFileSync(dir+"/validation-error.txt",out.join("\n"));console.error("\nValidation failed. Report: "+dir+"/validation-error.txt");process.exit(1);}
rmSync(dir,{recursive:true,force:true});console.log("\n=== Preflight PASSED ===");
