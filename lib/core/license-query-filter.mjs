export function buildLicenseScopeFilter(customerExternalId,requestedLicenseIds){
  const customer=String(customerExternalId||"").trim();
  const ids=[...new Set((Array.isArray(requestedLicenseIds)?requestedLicenseIds:[]).map(value=>String(value||"").trim()).filter(Boolean))];
  const params=[];
  const clauses=[];
  if(customer){params.push(customer);clauses.push(`l.customer_external_id=$${params.length}`);}
  if(ids.length){params.push(ids);clauses.push(`l.id=any($${params.length}::uuid[])`);}
  return {params,where:clauses.length?` where (${clauses.join(" or ")})`:""};
}
