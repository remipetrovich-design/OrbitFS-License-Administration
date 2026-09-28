export type OrbitReleaseVersion = {
  raw: string;
  prefix: 'v' | 'b' | 'd' | null;
  parts: number[];
  prerelease: string | null;
  build: string | null;
  rank: number;
};

const VERSION_PATTERN=/^([vVbBdD])?\.?(?:\d+(?:\.\d+){0,7})(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseOrbitReleaseVersion(value: unknown): OrbitReleaseVersion | null {
  const raw=String(value??'').trim();
  const match=raw.match(/^([vVbBdD])?\.?(\d+(?:\.\d+){0,7})(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if(!match)return null;
  const prefix=(match[1]?.toLowerCase()||null) as OrbitReleaseVersion['prefix'];
  const parts=match[2].split('.').map(Number);
  if(!parts.length||parts.some((part)=>!Number.isSafeInteger(part)||part<0))return null;
  const rank=prefix==='d'?0:prefix==='b'?1:2;
  return {raw,prefix,parts,prerelease:match[3]||null,build:match[4]||null,rank};
}

export function isOrbitReleaseVersion(value: unknown) {
  return parseOrbitReleaseVersion(value)!==null;
}
