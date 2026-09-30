import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../../lib/auth';
import {db} from '../../../../../../lib/db';
export const runtime='nodejs';

function githubAssetUrl(value:string){
  try{
    const u=new URL(value);
    if(u.hostname!=='api.github.com')return null;
    const m=u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/releases\/assets\/(\d+)$/);
    return m?{owner:m[1],repo:m[2],assetId:m[3]}:null;
  }catch{return null;}
}

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await integrationAuthorized(request,'releases.read');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const {id}=await params;
  const row=(await db().query("select artifact_url,artifact_name,artifact_repo,source_repo,checksum,manifest from releases where id=$1 limit 1",[id])).rows[0];
  if(!row)return NextResponse.json({error:'RELEASE_NOT_FOUND'},{status:404});

  const tokens=[...new Set([
    String(process.env.ORBITFS_RELEASE_DISPATCH_TOKEN||'').trim(),
    String(process.env.GITHUB_RELEASE_TOKEN||'').trim(),
    String(process.env.GITHUB_TOKEN||'').trim(),
    ''
  ])];
  const githubFetch=async(url:string,accept:string)=>{
    let last:Response|null=null;
    for(const token of tokens){
      const headers:Record<string,string>={accept,'x-github-api-version':'2022-11-28','user-agent':'OrbitFS-License-Master'};
      if(token)headers.authorization='Bearer '+token;
      const response=await fetch(url,{headers,cache:'no-store',redirect:'follow'});
      last=response;
      if(response.ok)return response;
      if(![401,403,404].includes(response.status))return response;
    }
    return last||new Response(null,{status:404});
  };
  let assetUrl=String(row.artifact_url||'').trim();
  const repo=String(row.artifact_repo||row.source_repo||'').trim();
  const tag=String(row.manifest?.artifactTag||'').trim();
  const name=String(row.artifact_name||'').trim();
  if(repo&&tag&&name){
    const releaseResponse=await githubFetch('https://api.github.com/repos/'+repo+'/releases/tags/'+encodeURIComponent(tag),'application/vnd.github+json');
    if(!releaseResponse.ok)return NextResponse.json({error:'ARTIFACT_DOWNLOAD_FAILED',code:'ARTIFACT_DOWNLOAD_FAILED',stage:'release_lookup',github_status:releaseResponse.status},{status:503});
    const release:any=await releaseResponse.json();
    const asset=Array.isArray(release.assets)?release.assets.find((item:any)=>String(item.name||'')===name):null;
    if(!asset?.url)return NextResponse.json({error:'ARTIFACT_NOT_CONFIGURED',code:'ARTIFACT_NOT_CONFIGURED',stage:'asset_lookup'},{status:404});
    assetUrl=String(asset.url);
  }
  if(!assetUrl)return NextResponse.json({error:'ARTIFACT_NOT_CONFIGURED',code:'ARTIFACT_NOT_CONFIGURED'},{status:404});

  const github=githubAssetUrl(assetUrl);
  let response:Response;
  if(github){
    const apiUrl='https://api.github.com/repos/'+encodeURIComponent(github.owner)+'/'+encodeURIComponent(github.repo)+'/releases/assets/'+github.assetId;
    const metadata=await githubFetch(apiUrl,'application/vnd.github+json');
    let browserUrl='';
    if(metadata.ok){try{const value:any=await metadata.clone().json();browserUrl=String(value?.browser_download_url||'').trim();}catch{}}
    response=await githubFetch(apiUrl,'application/octet-stream');
    if(!response.ok&&browserUrl)response=await githubFetch(browserUrl,'application/octet-stream');
  }else{
    response=await fetch(assetUrl,{headers:{accept:'application/octet-stream'},cache:'no-store',redirect:'follow'});
  }

  if(!response.ok)return NextResponse.json({error:'ARTIFACT_DOWNLOAD_FAILED',code:'ARTIFACT_DOWNLOAD_FAILED',stage:'asset_download',github_status:response.status},{status:503});
  const bytes=Buffer.from(await response.arrayBuffer());
  const expected=String(row.checksum||'').trim().toLowerCase();
  const actual=createHash('sha256').update(bytes).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(expected)||actual!==expected)return NextResponse.json({error:'ARTIFACT_CHECKSUM_MISMATCH',code:'ARTIFACT_CHECKSUM_MISMATCH'},{status:502});
  return new Response(bytes,{
    status:200,
    headers:{
      'content-type':response.headers.get('content-type')||'application/octet-stream',
      'content-disposition':response.headers.get('content-disposition')||`attachment; filename="${row.artifact_name||'orbitfs-release'}"`,
      'cache-control':'private, no-store'
    }
  });
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  return NextResponse.json({error:'ARTIFACT_UPLOAD_NOT_SUPPORTED',code:'ARTIFACT_UPLOAD_NOT_SUPPORTED',message:'Release artifacts are produced and supplied by the GitHub release workflow. Provide artifact_url, artifact_name, artifact_run_id and checksum during release intake.'},{status:409});
}
