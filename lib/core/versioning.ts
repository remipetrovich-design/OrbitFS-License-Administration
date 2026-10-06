export type OrbitReleaseVersion = {
  raw: string;
  prefix: 'v' | 'b' | 'd' | null;
  parts: number[];
  prerelease: string | null;
  build: string | null;
  rank: number;
};

const CURRENT_VERSION_PATTERN=/^[1-9][0-9]*(?:\.(?:0|[1-9][0-9]*)){1,3}$/;
const LEGACY_VERSION_PATTERN=/^([vVbBdD])?\.?(\d+(?:\.\d+){0,7})(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseOrbitReleaseVersion(value: unknown): OrbitReleaseVersion | null {
  const raw=String(value??'').trim();
  const match=raw.match(LEGACY_VERSION_PATTERN);
  if(!match)return null;
  const prefix=(match[1]?.toLowerCase()||null) as OrbitReleaseVersion['prefix'];
  const parts=match[2].split('.').map(Number);
  if(!parts.length||parts.some((part)=>!Number.isSafeInteger(part)||part<0))return null;
  const rank=prefix==='d'?0:prefix==='b'?1:2;
  return {raw,prefix,parts,prerelease:match[3]||null,build:match[4]||null,rank};
}

export function isOrbitReleaseVersion(value: unknown) {
  return CURRENT_VERSION_PATTERN.test(String(value??'').trim());
}

export function orbitReleaseVersionFamily(value: unknown) {
  const parsed=parseOrbitReleaseVersion(value);
  if(!parsed)return null;
  return parsed.prefix==='d'?'dev':parsed.prefix==='b'?'beta':'standard';
}

export function compareOrbitReleaseVersions(a: unknown,b: unknown): number | null {
  const x=parseOrbitReleaseVersion(a),y=parseOrbitReleaseVersion(b);
  if(!x||!y)return null;
  const width=Math.max(x.parts.length,y.parts.length);
  for(let i=0;i<width;i++){
    const delta=(x.parts[i]||0)-(y.parts[i]||0);
    if(delta)return delta;
  }
  if(x.parts.length!==y.parts.length)return x.parts.length-y.parts.length;
  if(x.rank!==y.rank)return x.rank-y.rank;
  if(x.prerelease===y.prerelease)return 0;
  if(x.prerelease===null)return 1;
  if(y.prerelease===null)return -1;
  return x.prerelease.localeCompare(y.prerelease,undefined,{numeric:true,sensitivity:'base'});
}
