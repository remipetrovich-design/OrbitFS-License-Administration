/**
 * Incendia Diagnostic System — Phase 1 catcher logger.
 * Observational only. Emits the locked schema to the existing log sink.
 */

export type Direction = "egress" | "ingress";
export type SourceSystem = "license_manager" | "dev_panel" | "billing" | "base" | "engine";
export type Target = "github" | "vercel" | "supabase" | "license_manager" | "billing" | "dev_panel" | "base" | "engine" | "other";
export type AccountMode = "main" | "fallback";

export interface DiagnosticEvent {
  ts: string;
  direction: Direction;
  source_system: SourceSystem;
  target: Target;
  account_mode: AccountMode;
  method: string;
  endpoint: string;
  status: number;
  request_id: string;
  latency_ms?: number;
  error?: string | null;
}

function nowIso() { return new Date().toISOString(); }
function newRequestId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function emitDiagnostic(event: Omit<DiagnosticEvent, "ts" | "request_id"> & { request_id?: string }) {
  const full: DiagnosticEvent = {
    ts: nowIso(),
    request_id: event.request_id || newRequestId(),
    ...event,
    error: event.error ?? null,
  };
  console.info("[INCENDIA_DIAGNOSTIC]", JSON.stringify(full));
}

export async function diagnosticFetch(url: string | URL, init: RequestInit = {}, meta: {
  source_system: SourceSystem; target: Target; account_mode: AccountMode; endpoint?: string;
}): Promise<Response> {
  const start = Date.now();
  const method = (init.method || "GET").toUpperCase();
  const endpoint = meta.endpoint || String(url);
  const request_id = newRequestId();
  let status = 0;
  let error: string | null = null;
  try {
    const response = await fetch(url, init);
    status = response.status;
    return response;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    emitDiagnostic({
      direction: "egress",
      source_system: meta.source_system,
      target: meta.target,
      account_mode: meta.account_mode,
      method,
      endpoint,
      status,
      request_id,
      latency_ms: Date.now() - start,
      error,
    });
  }
}

export function logIngress(meta: {
  source_system: SourceSystem; target: Target; account_mode: AccountMode;
  method: string; endpoint: string; status: number; request_id?: string; latency_ms?: number; error?: string | null;
}) {
  emitDiagnostic({ direction: "ingress", ...meta });
}
