/**
 * Ciclo del agente (PRD 6.3): prompt → modelo → herramientas → … → respuesta.
 * - CA1: tope de iteraciones por turno y de tokens por sesión.
 * - CA3: la confirmación humana se aplica en código: oc_crear solo recibe confirmado=true si el
 *   mensaje actual del usuario confirma y ese caso tiene una confirmación pendiente.
 * - CA4: cada llamada queda en el historial (toolCalls) y en out/log.jsonl (lo hacen las herramientas).
 * - CA5: los errores del proveedor se convierten en un mensaje claro y la sesión sigue viva.
 */
import { fechaColombia } from "../fechas";
import { registrarLlamada, type ContextoHerramienta } from "../infra/archivos";
import { ErrorProveedor, type Mensaje, type ProveedorLLM, type ResultadoHerramienta } from "../llm/adapter";
import { esCancelacion, esConfirmacion } from "./confirmacion";
import { definiciones, ejecutarHerramienta, resumir } from "./herramientas";
import type { Sesion } from "./sesiones";
import type { RespuestaChat, ToolCallVisible } from "./tipos";

export interface OpcionesCiclo {
  llm: ProveedorLLM;
  systemPrompt: string;
  maxIteraciones: number;
  maxTokensSesion: number;
}

type Json = Record<string, unknown>;
const esObjeto = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const parsear = (texto: string): unknown => {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
};
const reglas = (v: unknown) => (Array.isArray(v) ? v.flatMap((h) => (esObjeto(h) && typeof h.regla === "string" ? [h.regla] : [])) : []);

const casosMencionados = (texto: string) => new Set((texto.toLowerCase().match(/sol-\d{3}/g) ?? []).map((c) => c));

/** Casos que el mensaje actual del usuario confirma: pendientes y, si el mensaje nombra casos, solo esos. */
function casosConfirmados(sesion: Sesion, mensaje: string): Set<string> {
  if (!esConfirmacion(mensaje)) return new Set();
  const mencionados = casosMencionados(mensaje);
  return new Set(Object.keys(sesion.pendientes).filter((c) => mencionados.size === 0 || mencionados.has(c)));
}

export async function procesarTurno(sesion: Sesion, mensaje: string, ctx: ContextoHerramienta, op: OpcionesCiclo): Promise<RespuestaChat> {
  const toolCalls: ToolCallVisible[] = [];
  const respuesta = (reply: string, needsConfirmation = false): RespuestaChat => {
    sesion.historial.push({ rol: "asistente", texto: reply, ts: fechaColombia(new Date()), toolCalls, needsConfirmation });
    return { sessionId: sesion.id, reply, toolCalls, needsConfirmation };
  };

  sesion.historial.push({ rol: "usuario", texto: mensaje, ts: fechaColombia(new Date()) });
  if (sesion.tokens >= op.maxTokensSesion)
    return respuesta("Esta sesión alcanzó su límite de uso. Abre una conversación nueva para continuar.");

  // Decisión humana sobre confirmaciones pendientes (se toma del mensaje, no del modelo).
  const confirmados = casosConfirmados(sesion, mensaje);
  const tocadosEnTurno = new Set<string>();
  for (const caso of confirmados) await registrarDecision(ctx, caso, "confirmada", mensaje);
  if (esCancelacion(mensaje))
    for (const caso of Object.keys(sesion.pendientes)) {
      await registrarDecision(ctx, caso, "cancelada", mensaje);
      delete sesion.pendientes[caso];
    }

  const respaldo = sesion.mensajes.length;
  sesion.mensajes.push({ rol: "usuario", texto: mensaje });
  const sistema: Mensaje = { rol: "sistema", texto: op.systemPrompt };
  let textoFinal = "";

  try {
    for (let i = 0; i < op.maxIteraciones; i++) {
      const r = await op.llm.enviar([sistema, ...sesion.mensajes], definiciones);
      sesion.tokens += r.uso.entrada + r.uso.salida;
      sesion.mensajes.push({ rol: "asistente", texto: r.texto, llamadas: r.llamadas });
      textoFinal = r.texto;
      if (r.llamadas.length === 0) return respuesta(cerrarTurno(textoFinal, sesion, tocadosEnTurno), necesitaConfirmacion(sesion, tocadosEnTurno));

      const resultados: ResultadoHerramienta[] = [];
      for (const llamada of r.llamadas) {
        const { args, nota } = aplicarControlConfirmacion(llamada.nombre, llamada.args, confirmados);
        if (nota) await registrarLlamada(ctx, { herramienta: "agente:confirmacion_forzada", args, ok: true, error: nota, duracion_ms: 0 });
        const contenido = await ejecutarHerramienta(llamada.nombre, args, ctx);
        const resultado = parsear(contenido);
        actualizarPendientes(sesion, llamada.nombre, args, resultado, tocadosEnTurno);
        toolCalls.push({ nombre: llamada.nombre, args, ok: esObjeto(resultado) && resultado.ok === true, resumen: resumir(llamada.nombre, resultado), resultado, ...(nota ? { nota } : {}) });
        resultados.push({ id: llamada.id, nombre: llamada.nombre, contenido: nota ? `${contenido}\n\nNota del sistema: ${nota}` : contenido });
      }
      sesion.mensajes.push({ rol: "herramienta", resultados });
    }
    // CA1: se alcanzó el tope de iteraciones.
    const hechas = toolCalls.map((t) => `${t.nombre} (${t.ok ? "ok" : "error"})`).join(", ");
    const reply =
      `${textoFinal ? `${textoFinal}\n\n` : ""}Llegué al límite de ${op.maxIteraciones} pasos en este turno.\n\n` +
      `**Lo que hice:** ${hechas || "nada"}.\n\n**Lo que falta:** terminar el proceso; escribe «continúa» para seguir.`;
    sesion.mensajes.push({ rol: "usuario", texto: "(El sistema detuvo el turno por el tope de iteraciones.)" });
    sesion.mensajes.push({ rol: "asistente", texto: reply, llamadas: [] });
    return respuesta(cerrarTurno(reply, sesion, tocadosEnTurno), necesitaConfirmacion(sesion, tocadosEnTurno));
  } catch (e) {
    // CA5: mensaje claro, detalle solo en el log del servidor; se descarta el turno incompleto para que la sesión siga sana.
    console.error("[agente]", e instanceof ErrorProveedor ? e.detalle : e);
    sesion.mensajes.length = respaldo;
    const reply = e instanceof ErrorProveedor ? e.mensajeUsuario : "No pude procesar la solicitud, intenta de nuevo";
    return respuesta(reply);
  }
}

/** oc_crear con confirmado=true solo si el usuario acaba de confirmar ese caso; si no, se fuerza a false. */
function aplicarControlConfirmacion(nombre: string, args: unknown, confirmados: Set<string>): { args: unknown; nota?: string } {
  if (nombre !== "oc_crear" || !esObjeto(args) || args.confirmado !== true) return { args };
  const caso = typeof args.caso === "string" ? args.caso : "";
  if (confirmados.has(caso)) return { args };
  return {
    args: { ...args, confirmado: false },
    nota: `confirmado se forzó a false: el usuario no confirmó ${caso || "el caso"} en su último mensaje. Pregúntale y espera su respuesta.`,
  };
}

/** Lleva el registro de confirmaciones pendientes por caso según los resultados de las herramientas. */
function actualizarPendientes(sesion: Sesion, nombre: string, args: unknown, resultado: unknown, tocados: Set<string>): void {
  if (!esObjeto(args) || typeof args.caso !== "string" || !esObjeto(resultado)) return;
  const caso = args.caso;
  const data = esObjeto(resultado.data) ? resultado.data : {};
  if (nombre === "oc_validar" && resultado.ok === true) {
    tocados.add(caso);
    const pendientes = reglas(data.confirmaciones);
    if (data.apta === true && pendientes.length > 0) {
      const paquete = esObjeto(args.paquete) && esObjeto(args.paquete.solicitud) ? args.paquete.solicitud : {};
      sesion.pendientes[caso] = { solicitud_id: typeof paquete.solicitud_id === "string" ? paquete.solicitud_id : null, reglas: pendientes };
    } else delete sesion.pendientes[caso];
  }
  if (nombre === "oc_crear") {
    tocados.add(caso);
    if (resultado.ok === true) delete sesion.pendientes[caso];
    else if (/requiere confirmaci[oó]n humana/.test(String(resultado.error)) && !sesion.pendientes[caso])
      sesion.pendientes[caso] = { solicitud_id: null, reglas: [] };
  }
}

function necesitaConfirmacion(sesion: Sesion, tocados: Set<string>): boolean {
  return [...tocados].some((c) => sesion.pendientes[c]);
}

/** ¿El último párrafo ya es una pregunta? Ignora markdown y emojis al final ("**¿Confirmas…?**"). */
export function terminaEnPregunta(texto: string): boolean {
  const ultimaLinea = texto.trim().split("\n").at(-1) ?? "";
  return ultimaLinea.replace(/[^\p{L}\p{N}?]+$/u, "").endsWith("?");
}

/** CA3: si queda una confirmación pendiente, el turno termina con una pregunta explícita. */
function cerrarTurno(texto: string, sesion: Sesion, tocados: Set<string>): string {
  const casos = [...tocados].filter((c) => sesion.pendientes[c]);
  if (casos.length === 0 || terminaEnPregunta(texto)) return texto || "Listo.";
  const detalle = casos.map((c) => `${c}${sesion.pendientes[c]!.reglas.length ? ` (${sesion.pendientes[c]!.reglas.join(", ")})` : ""}`).join(", ");
  return `${texto ? `${texto}\n\n` : ""}**¿Confirmas que cree la orden de compra de ${detalle} con estas excepciones?** Responde «confirmo» o «cancelar».`;
}

async function registrarDecision(ctx: ContextoHerramienta, caso: string, decision: "confirmada" | "cancelada", mensaje: string) {
  await registrarLlamada(ctx, { herramienta: `decision_humana:${decision}`, args: { caso, mensaje }, ok: true, duracion_ms: 0 });
}
