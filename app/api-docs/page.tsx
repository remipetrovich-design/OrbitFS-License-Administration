import {requireUser} from '../../lib/session';
import SideNav from '../components/SideNav';
import PageHeader from '../components/PageHeader';

export const dynamic='force-dynamic';

const blocks=[
 ['Authentication','Authorization: Bearer <managed License Manager API key>','Keep integration credentials private and use HTTPS. Customer runtime validation is the exception: the licence key itself is the client credential.'],
 ['Issue a licence','POST /api/v1/license\\n\\n{\\n  "product": "orbitfs",\\n  "customer_external_id": "customer-123",\\n  "external_reference": "order-456",\\n  "expires_at": "2030-01-01T00:00:00Z",\\n  "metadata": {}\\n}','Licence issuance remains inside License Manager authority.'],
 ['Installed-product validation','POST /api/v1/license/validate\\n\\n{\\n  "license_key": "LIC-...",\\n  "product": "orbitfs",\\n  "installation_id": "machine-123",\\n  "product_version": "2.0.0"\\n}','Public runtime endpoint. The licence key is the credential; no customer-specific integration token is required.'],
 ['Release intake','GET /api/v1/releases?product=orbitfs&channel=stable&type=update\\nGET /api/v1/releases?product=orbitfs&channel=stable&type=base\\nPOST /api/v1/releases','Release builders submit candidates through the canonical versioned release API.'],
 ['Release channels','GET /api/v1/release-channels\\nPOST /api/v1/release-channels/access','Channel definitions and technical entitlement state remain authoritative in License Manager.'],
 ['Updater','GET /api/v1/updater?product=orbitfs_base&channel=stable&type=base\\nGET /api/v1/updater?product=orbitfs_base&channel=stable&type=update','Customer update/base clients validate their licence and retrieve only technically permitted published releases.'],
 ['Deployment authority','POST /api/v1/deployer','License Manager authorizes and records deployment coordination; customer deployers perform execution against customer-owned providers.']
];

export default async function ApiDocs(){
 await requireUser();
 return <div className="shell"><SideNav active="api"/><main className="main">
  <PageHeader eyebrow="System / Integration Contract" title="API Contract" description="The versioned external authority surface consumed by Billing Store, release builders, products and customer deployment clients." badge="V1"/>

  <section className="api-contract-hero card">
   <div><div className="eyebrow">Authority boundary</div><h2>One production contract under /api/v1</h2><p>External systems integrate through the versioned API. The admin panel uses the same core authority services directly rather than calling back through its own public endpoints.</p></div>
   <div className="api-contract-status"><span className="status-light online"/><strong>Contract active</strong><small>Versioned production surface</small></div>
  </section>

  <div className="api-contract-grid">
   {blocks.map(([title,code,note],i)=><section className="card api-contract-card" key={title}>
    <div className="api-contract-card-head"><span>{String(i+1).padStart(2,'0')}</span><div><h2>{title}</h2><p className="muted">{note}</p></div></div>
    <pre className="code-panel">{code}</pre>
   </section>)}
  </div>
 </main></div>;
}