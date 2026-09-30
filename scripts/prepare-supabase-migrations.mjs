import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const manifest=JSON.parse(fs.readFileSync('database/migrations/.supabase-baseline.json','utf8'));
const outputDir=path.resolve(process.argv[2]||'.orbitfs-supabase/supabase/migrations');
const reportPath=path.resolve('.orbitfs-supabase/report.json');
const git=(args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const sanitize=(v)=>String(v||'migration').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)||'migration';
const versionFor=(epoch)=>{const d=new Date(Number(epoch)*1000),p=(n)=>String(n).padStart(2,'0');return String(d.getUTCFullYear())+p(d.getUTCMonth()+1)+p(d.getUTCDate())+p(d.getUTCHours())+p(d.getUTCMinutes())+p(d.getUTCSeconds())};

for(const [file,expected] of Object.entries(manifest.files||{})){
 if(!fs.existsSync(file)) throw new Error('Baseline migration was deleted: '+file);
 const actual=git(['hash-object',file]);
 if(actual!==expected) throw new Error('Baseline migration was modified: '+file+'. Add a new migration instead.');
}
const all=fs.readdirSync('database/migrations').filter(n=>n.endsWith('.sql')).map(n=>'database/migrations/'+n).sort();
const pending=all.filter(file=>!Object.prototype.hasOwnProperty.call(manifest.files||{},file));
fs.rmSync(outputDir,{recursive:true,force:true});fs.mkdirSync(outputDir,{recursive:true});
const used=new Set();
for(const m of manifest.remote_migrations||[]){
 const version=String(m.version);
 if(!/^\d{14}$/.test(version)) throw new Error('Invalid remote migration version: '+version);
 used.add(version);
 fs.writeFileSync(path.join(outputDir,version+'_'+sanitize(m.name)+'.sql'),'-- Baseline placeholder: already applied to the mapped production Supabase project.\n');
}
const meta=pending.map(file=>{
 let epoch=git(['log','--diff-filter=A','--follow','--format=%ct','--reverse','--',file]).split(/\r?\n/).filter(Boolean)[0];
 if(!epoch) epoch=git(['show','-s','--format=%ct','HEAD']);
 return {file,epoch:Number(epoch)};
}).sort((a,b)=>a.epoch-b.epoch||a.file.localeCompare(b.file));
const generated=[];
for(const item of meta){
 let epoch=item.epoch,version=versionFor(epoch);
 while(used.has(version)){epoch+=1;version=versionFor(epoch)}
 used.add(version);
 const name=sanitize(path.basename(item.file,'.sql').replace(/^\d+_?/,''));
 const target=path.join(outputDir,version+'_'+name+'.sql');
 fs.copyFileSync(item.file,target);
 generated.push({source:item.file,version,target:path.relative(process.cwd(),target)});
}
fs.mkdirSync(path.dirname(reportPath),{recursive:true});
const report={project_ref:manifest.project_ref,pending_count:generated.length,pending:generated,baseline_files:Object.keys(manifest.files||{}).length,remote_migrations:(manifest.remote_migrations||[]).length};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
