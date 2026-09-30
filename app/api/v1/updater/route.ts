import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {db} from '../../../../lib/db';
import {validateLicense} from '../../../../lib/core/licenses';

export const runtime='nodejs';

function githubAssetUrl(value:string){try{const u=new URL(value);if(u.hostname!=='api.github.com')return null;const m=u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/releases\/assets\/(\d+)$/);return m?{owner:m[1],repo:m[2],assetId:m[3]}:null;}catch{return null;}}
function requestIp(request:Request){return request.headers.get('x-real-ip')?.trim()||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||null;}
function telemetry(body:any){const source=body?.telemetry&&typeof body.telemetry==='object'?body.telemetry:{};const allowed=['hostname','platform','architecture','client','clientVersion','provider','region','components'];return Object.fromEntries(allowed.filter(k=>source[k]!==undefined&&source[k]!==null&&source[k]!=='').map(k=>[k,source[k]]));}

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const releaseId=String(url.searchParams.get('release_id')||'').trim();
    const download=url.searchParams.get('download')==='1';
    const product=String(url.searchParams.get('product')||'orbitfs_base').trim().toLowerCase();
    const channel=String(url.searchParams.get('channel')||'stable').trim().toLowerCase();
    const type=String(url.searchParams.get('type')||'update').trim().toLowerCase();
    const engineOnly=url.searchParams.get('engine')==='1';
    if(!['base','update'].includes(type))return NextResponse.json({ok:false,code:'INVALID_RELEASE_TYPE'},{status:400});

    const licenseKey=request.headers.get('x-license-key')?.trim()||'';
    if(!licenseKey)return NextResponse.json({ok:false,code:'LICENSE_KEY_REQUIRED'},{status:401});
    const installationId=request.headers.get('x-installation-id')?.trim()||'';
    const validation=await validateLicense({key:licenseKey,productSlug:product,installationId:installationId||undefined,requestIp:requestIp(request),userAgent:request.headers.get('user-agent'),telemetry:telemetry({telemetry:{client:request.headers.get('x-orbitfs-client')||'orbitfs-updater'}})});
    if(!validation.valid)return NextResponse.json({ok:false,code:validation.code},{status:validation.status});

    let release:any=null;
    if(releaseId){
      release=(await db().query(`select r.*,p.slug product,p.name product_name from releases r join products p on p.id=r.product_id where r.id=$1 limit 1`,[releaseId])).rows[0];
    }else{
      const candidates=(await db().query(`select r.*,p.slug product,p.name product_name from releases r join products p on p.id=r.product_id where p.slug=$1 and r.channel=$2 and r.release_type=$3 and r.status='published' and r.review_status='approved' and r.archived_at is null order by r.published_at desc nulls last,r.created_at desc limit 25`,[product,channel,type])).rows;
      release=engineOnly
        ? candidates.find((row:any)=>{const components=Array.isArray(row?.manifest?.components)?row.manifest.components.map((x:any)=>String(x||'').toLowerCase()):[];return components.some((x:string)=>['apex','mcp','studio'].includes(x));})
        : candidates[0];
    }

    if(!release)return NextResponse.json({ok:false,code:'RELEASE_NOT_FOUND'},{status:404});
    if(String(release.product)!==product)return NextResponse.json({ok:false,code:'RELEASE_PRODUCT_MISMATCH'},{status:409});
    if(release.status!=='published'||release.review_status!=='approved'||release.archived_at)return NextResponse.json({ok:false,code:'RELEASE_NOT_PUBLISHED'},{status:409});
    if(String(release.channel)!==channel)return NextResponse.json({ok:false,code:'RELEASE_CHANNEL_MISMATCH'},{status:409});
    if(channel!=='stable'){
      const policy=(await db().query('select access_mode,enabled from release_channels where channel=$1 limit 1',[channel])).rows[0];
      if(!policy?.enabled)return NextResponse.json({ok:false,code:'RELEASE_CHANNEL_DISABLED'},{status:409});
      if(policy.access_mode==='closed'){
        const access=(await db().query('select 1 from release_channel_access where license_id=$1 and channel=$2 and (expires_at is null or expires_at>now()) limit 1',[validation.license_id,channel])).rows[0];
        if(!access)return NextResponse.json({ok:false,code:'LICENSE_CHANNEL_ACCESS_DENIED'},{status:403});
      }
    }
    if(String(release.channel)!==channel&&releaseId)return NextResponse.json({ok:false,code:'RELEASE_CHANNEL_MISMATCH'},{status:409});
    if(String(release.release_type)!==type)return NextResponse.json({ok:false,code:'RELEASE_TYPE_MISMATCH'},{status:409});

    const manifest=release.manifest&&typeof release.manifest==='object'?release.manifest:{};
    const releaseComponents:string[]=[...new Set<string>((Array.isArray(manifest.components)?manifest.components:[]).map((x:any)=>String(x||'').trim().toLowerCase()).filter((x:string)=>['base','apex','mcp','studio'].includes(x)))];
    // The published Update remains a complete shared artifact. License Manager
    // returns a per-installation execution plan so the runtime applies only
    // components this exact licence is entitled to use.
    const validationResult:any=validation;
    const runtimeStates=validationResult.components&&typeof validationResult.components==='object'?validationResult.components:{};
    const entitledComponents:string[]=['base','apex','mcp','studio'].filter((component:string)=>{
      const state=(runtimeStates as any)['orbitfs_'+component];
      return Boolean(state?.allowed);
    });
    const executionComponents=release.release_type==='update'
      ?releaseComponents.filter((component:string)=>entitledComponents.includes(component))
      :releaseComponents;
    const skippedComponents=release.release_type==='update'
      ?releaseComponents.filter((component:string)=>!executionComponents.includes(component))
      :[];
    const componentPlan={releaseComponents,entitledComponents,executionComponents,skippedComponents};
    const descriptor={id:release.id,version:release.version,product:release.product,releaseType:release.release_type,channel:release.channel,status:release.status,reviewStatus:release.review_status,publishedAt:release.published_at||null,sourceRepo:release.source_repo,sourceRef:release.source_ref,sourceCommit:release.source_sha,checksum:release.checksum,artifactSha256:release.checksum,artifactName:release.artifact_name,fileCount:Number(manifest.fileCount||0),components:Array.isArray(manifest.components)?manifest.components:[],componentPlan,minimumBaseVersion:manifest.minimumBaseVersion||manifest.minimum_version||null,minimumEngineDeployerProtocol:Number(manifest.minimumEngineDeployerProtocol||1),checkpointRequired:manifest.checkpointRequired!==false,manifest,artifactUrl:String(new URL(request.url).origin)+'/api/v1/updater?release_id='+encodeURIComponent(release.id)+'&channel='+encodeURIComponent(release.channel)+'&type='+encodeURIComponent(release.release_type)+'&download=1'};

    if(!download)return NextResponse.json({ok:true,authority:'orbitfs-license-master-v2',license_id:validation.license_id||null,componentPlan,release:descriptor,releases:[descriptor]});

    let artifactUrl=String(release.artifact_url||'').trim();
    const artifactRepo=String(release.artifact_repo||release.source_repo||'').trim();
    const artifactTag=String(release.manifest?.artifactTag||'').trim();
    const artifactName=String(release.artifact_name||'').trim();
    if(artifactRepo&&artifactTag&&artifactName){
      const tokens=[...new Set([
        String(process.env.ORBITFS_RELEASE_DISPATCH_TOKEN||'').trim(),
        String(process.env.GITHUB_RELEASE_TOKEN||'').trim(),
        String(process.env.GITHUB_TOKEN||'').trim(),
        ''
      ])];
      let releaseResponse:Response|null=null;
      for(const token of tokens){
        const headers:Record<string,string>={accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'OrbitFS-License-Master'};
        if(token)headers.authorization='Bearer '+token;
        const candidate=await fetch('https://api.github.com/repos/'+artifactRepo+'/releases/tags/'+encodeURIComponent(artifactTag),{headers,cache:'no-store',redirect:'follow'});
        releaseResponse=candidate;
        if(candidate.ok)break;
        if(![401,403,404].includes(candidate.status))break;
      }
      if(!releaseResponse?.ok)return NextResponse.json({ok:false,code:'ARTIFACT_DOWNLOAD_FAILED',stage:'release_lookup',github_status:releaseResponse?.status||0},{status:503});
      const releaseJson:any=await releaseResponse.json();
      const asset=Array.isArray(releaseJson.assets)?releaseJson.assets.find((item:any)=>String(item.name||'')===artifactName):null;
      if(!asset?.url)return NextResponse.json({ok:false,code:'ARTIFACT_NOT_CONFIGURED',stage:'asset_lookup'},{status:404});
      artifactUrl=String(asset.url);
    }
    if(!artifactUrl)return NextResponse.json({ok:false,code:'ARTIFACT_NOT_CONFIGURED'},{status:404});
    const github=githubAssetUrl(artifactUrl);
    let response:Response;
    if(github){
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
          const candidate=await fetch(url,{headers,cache:'no-store',redirect:'follow'});
          last=candidate;
          if(candidate.ok)return candidate;
          if(![401,403,404].includes(candidate.status))return candidate;
        }
        return last||new Response(null,{status:404});
      };
      const apiUrl='https://api.github.com/repos/'+encodeURIComponent(github.owner)+'/'+encodeURIComponent(github.repo)+'/releases/assets/'+github.assetId;
      const metadata=await githubFetch(apiUrl,'application/vnd.github+json');
      let browserUrl='';
      if(metadata.ok){try{const value:any=await metadata.clone().json();browserUrl=String(value?.browser_download_url||'').trim();}catch{}}
      response=await githubFetch(apiUrl,'application/octet-stream');
      if(!response.ok&&browserUrl)response=await githubFetch(browserUrl,'application/octet-stream');
    }else{
      response=await fetch(artifactUrl,{headers:{accept:'application/octet-stream'},cache:'no-store'});
    }
    if(!response.ok)return NextResponse.json({ok:false,code:'ARTIFACT_DOWNLOAD_FAILED',stage:'asset_download',github_status:response.status},{status:503});
    const bytes=Buffer.from(await response.arrayBuffer());
    const expected=String(release.checksum||'').trim().toLowerCase();
    const actual=createHash('sha256').update(bytes).digest('hex');
    if(!/^[a-f0-9]{64}$/.test(expected)||actual!==expected)return NextResponse.json({ok:false,code:'ARTIFACT_CHECKSUM_MISMATCH'},{status:502});
    return new Response(bytes,{status:200,headers:{'content-type':response.headers.get('content-type')||'application/octet-stream','content-disposition':response.headers.get('content-disposition')||`attachment; filename="${release.artifact_name||'orbitfs-release'}"`,'cache-control':'private, no-store'}});
  }catch(error:any){return NextResponse.json({ok:false,code:String(error?.code||'UPDATER_ERROR'),error:String(error?.message||'Updater request failed')},{status:Number(error?.status||503)})}
}

export async function POST(request:Request){
  if(!(await integrationAuthorized(request,'releases.read')))return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
  const body=await request.json().catch(()=>({}));
  const product=String(body?.product||'orbitfs_base').trim().toLowerCase();
  const channel=String(body?.channel||'stable').trim().toLowerCase();
  const type=String(body?.type||'update').trim().toLowerCase();
  const releaseId=String(body?.release_id||body?.releaseId||'').trim();
  const rows=(await db().query(`select r.*,p.slug product,p.name product_name from releases r join products p on p.id=r.product_id where ${releaseId?'r.id=$1':'p.slug=$1 and r.channel=$2 and r.release_type=$3'} and r.status='published' and r.review_status='approved' and r.archived_at is null order by r.published_at desc nulls last,r.created_at desc limit 1`,releaseId?[releaseId]:[product,channel,type])).rows;
  return NextResponse.json({ok:true,release:rows[0]||null});
}
