import { config, hayClave } from "@/src/agent/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estado del servicio sin exponer claves: ok indica si hay clave configurada para el proveedor. */
export function GET() {
  return Response.json({ ok: hayClave(), provider: config.proveedor, model: config.modelo });
}
