import { z } from "zod";
import { config, crearProveedor, hayClave } from "@/src/agent/config";
import { procesarTurno } from "@/src/agent/loop";
import { cargarSystemPrompt } from "@/src/agent/prompt";
import { guardarSesion, ID_SESION, obtenerOCrearSesion } from "@/src/agent/sesiones";
import { fechaColombia } from "@/src/fechas";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Lo único que ve el usuario cuando algo falla; el detalle técnico va solo a los logs del servidor. */
const MENSAJE_GENERICO = "No pude procesar la solicitud, intenta de nuevo";

const cuerpoSchema = z.object({
  sessionId: z.string().regex(ID_SESION),
  message: z.string().trim().min(1).max(4000),
});

function error(status: number, detalle: unknown) {
  console.error("[api/chat]", detalle);
  return Response.json({ error: MENSAJE_GENERICO }, { status });
}

export async function POST(req: Request) {
  if (!hayClave()) return error(503, "Falta la variable de entorno ANTHROPIC_API_KEY en el servidor.");
  try {
    const cuerpo = cuerpoSchema.safeParse(await req.json().catch(() => null));
    if (!cuerpo.success) return error(400, cuerpo.error.issues);

    const ctx = { directory: process.cwd(), sessionId: cuerpo.data.sessionId };
    const sesion = await obtenerOCrearSesion(ctx, cuerpo.data.sessionId, fechaColombia(new Date()));
    const respuesta = await procesarTurno(sesion, cuerpo.data.message, ctx, {
      llm: crearProveedor(),
      systemPrompt: await cargarSystemPrompt(process.cwd()),
      maxIteraciones: config.maxIteraciones,
      maxTokensSesion: config.maxTokensSesion,
    });
    await guardarSesion(ctx, sesion);
    return Response.json(respuesta);
  } catch (e) {
    return error(500, e);
  }
}
