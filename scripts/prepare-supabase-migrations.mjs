import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const manifest=JSON.parse(fs.readFileSync('database/migrations/.supabase-baseline.json','utf8'));
const outputDir=path.resolve(process.argv[2]||'.orbitfs-supabase/supabase/migrations');
const git=(args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
for(const [file,expected] of Object.entries(manifest.files||{})){
 if(!fs.existsSync(file)) throw new Error('Baseline migration was deleted: '+file);
 const actual=git(['hash-object',file]);
 if(actual!==expected) throw new Error('Baseline migration was modified: '+file+'. Add a new migration instead.');
}
fs.mkdirSync(outputDir,{recursive:true});
console.log(JSON.stringify({project_ref:manifest.project_ref,baseline_files:Object.keys(manifest.files||{}).length},null,2));
