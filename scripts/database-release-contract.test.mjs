import {readFileSync} from "node:fs";

const source=readFileSync("lib/core/database-packages.ts","utf8");
const assert=(condition,message)=>{if(!condition)throw new Error(message)};

assert(
  source.includes("if(selected.includes('base'))required.push('base');"),
  "Database release contract failed: a Base-targeted Update must require the Base database package."
);
assert(
  source.includes("if(engineComponents.length)required.push('engine-shared',...engineComponents);"),
  "Database release contract failed: Shared Engine must be required only when an Engine component is targeted."
);
assert(
  source.includes("DATABASE_PACKAGE_SELECTION_STALE"),
  "Database release contract failed: release validation must reject package refs that are not the License Manager resolver selection."
);
assert(
  source.includes("DATABASE_PACKAGE_REAL_VALIDATION_REQUIRED") &&
  source.includes("orbitfs-real-supabase-validation-v1"),
  "Database release contract failed: central packages must carry a successful real-Supabase validation attestation."
);

console.log("Database release package contract checks passed.");
