import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
if(config?.git?.deploymentEnabled!==false){
 throw new Error('Manual-only License Manager deployments must remain disabled.');
}
for(const job of config.crons??[]){
 const parts=String(job.schedule||'').trim().split(/\s+/);
 const [minute,hour]=parts;
 if(parts.length!==5||!/^(?:[0-5]?\d)$/.test(minute)||
    !/^(?:[01]?\d|2[0-3])$/.test(hour)||
    parts.slice(2).some(field=>field!=='*')){
  throw new Error('Vercel Hobby requires at most one scheduled cron run per day: '+String(job.path));
 }
}
console.log('Vercel Hobby cron and manual deployment policy verified.');
