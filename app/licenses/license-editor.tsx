'use client';

export default function LicenseEditor({license}:{license:any}){
 const edit=()=>window.dispatchEvent(new CustomEvent('orbitfs-license-edit',{detail:license}));
 return <button type="button" className="button secondary license-action-button" onClick={edit}>Edit</button>;
}
