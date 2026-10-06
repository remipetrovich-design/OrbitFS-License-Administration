import test from "node:test";
import assert from "node:assert/strict";
import {buildLicenseScopeFilter} from "../lib/core/license-query-filter.mjs";

test("uses PostgreSQL placeholders for scoped licence lookup",()=>{
  const result=buildLicenseScopeFilter("CUST-RETRO",["123e4567-e89b-12d3-a456-426614174000"]);
  assert.equal(result.where," where (l.customer_external_id=$1 or l.id=any($2::uuid[]))");
  assert.deepEqual(result.params,["CUST-RETRO",["123e4567-e89b-12d3-a456-426614174000"]]);
});

test("supports customer-only and licence-id-only lookup",()=>{
  assert.equal(buildLicenseScopeFilter("CUST-RETRO",[]).where," where (l.customer_external_id=$1)");
  assert.equal(buildLicenseScopeFilter("",["123e4567-e89b-12d3-a456-426614174000"]).where," where (l.id=any($1::uuid[]))");
});
