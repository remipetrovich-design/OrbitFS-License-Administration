'use client';

export default function DeleteLicenseButton({action,licenseId}:{action:(formData:FormData)=>void|Promise<void>;licenseId:string}){
  function submit(e:React.FormEvent<HTMLFormElement>){
    if(!window.confirm('Permanently delete this license? The license key will be permanently invalid and can never be reused.')) e.preventDefault();
  }
  return <form action={action} onSubmit={submit}>
    <input type="hidden" name="id" value={licenseId}/>
    <input type="hidden" name="action" value="delete"/>
    <button className="button danger license-action-button">Delete license</button>
  </form>;
}
