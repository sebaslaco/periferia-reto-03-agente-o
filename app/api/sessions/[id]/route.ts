import { ID_SESION, obtenerSesion } from "@/src/agent/sesiones";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_SESION.test(id)) return Response.json({ error: "Sesión no válida" }, { status: 400 });
  try {
    const sesion = await obtenerSesion({ directory: process.cwd(), sessionId: id }, id);
    if (!sesion) return Response.json({ error: "Sesión no encontrada" }, { status: 404 });
    const { historial, pendientes, tokens, creada } = sesion;
    return Response.json({ sessionId: id, creada, tokens, pendientes, historial });
  } catch (e) {
    console.error("[api/sessions]", e);
    return Response.json({ error: "No pude leer la sesión, intenta de nuevo" }, { status: 500 });
  }
}
