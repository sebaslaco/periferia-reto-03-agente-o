/**
 * Herramientas del agente de órdenes de compra.
 *
 * Cada herramienta tiene:
 * - un esquema zod (valida la entrada que envía el modelo),
 * - una función pura en código que hace el trabajo (la usa el chat y también demo.ts, sin modelo de IA).
 *
 * Las validaciones de negocio del Reto 3 se agregarán aquí cuando lleguen el PRD y los fixtures.
 * Por ahora solo hay herramientas de prueba de la infraestructura.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { SapSimulado } from "../sap/sap-simulado";

export interface ContextoHerramientas {
  sap: SapSimulado;
  /** Quién ejecuta la herramienta, para la auditoría. */
  actor: string;
}

// ---------- ping ----------

export const pingInput = z.object({
  mensaje: z.string().optional().describe("Texto opcional que se devuelve tal cual."),
});
export type PingInput = z.infer<typeof pingInput>;

export function ping(input: PingInput, ctx: ContextoHerramientas) {
  const salida = { respuesta: "pong", eco: input.mensaje ?? null, fecha: ctx.sap.ahora() };
  ctx.sap.registrarAuditoria({ actor: ctx.actor, accion: "ping", resultado: "ok" });
  return salida;
}

// ---------- crear_registro_demo (exige confirmación humana) ----------

export const crearRegistroDemoInput = z.object({
  solicitud_id: z.string().trim().min(1).describe("Identificador de la solicitud. Una solicitud genera como máximo un registro."),
  descripcion: z.string().trim().min(1).describe("Descripción corta del registro de prueba."),
});
export type CrearRegistroDemoInput = z.infer<typeof crearRegistroDemoInput>;

export function crearRegistroDemo(input: CrearRegistroDemoInput, ctx: ContextoHerramientas) {
  const { estado, orden } = ctx.sap.crearOrden({
    solicitudId: input.solicitud_id,
    datos: { descripcion: input.descripcion },
    actor: ctx.actor,
  });
  return {
    estado,
    numero_oc: orden.numero,
    solicitud_id: orden.solicitudId,
    fecha_creacion: orden.fechaCreacion,
    mensaje:
      estado === "creada"
        ? `Se creó la OC ${orden.numero}.`
        : `La solicitud ${orden.solicitudId} ya tenía la OC ${orden.numero}; no se creó otra.`,
  };
}

/** Registra en auditoría la decisión del humano sobre una herramienta que exige confirmación. */
export function registrarDecisionHumana(
  ctx: ContextoHerramientas,
  params: { herramienta: string; aprobado: boolean; solicitudId?: string; motivo?: string },
) {
  return ctx.sap.registrarAuditoria({
    actor: ctx.actor,
    accion: `confirmacion:${params.herramienta}`,
    solicitudId: params.solicitudId,
    resultado: params.aprobado ? "aprobado" : "cancelado",
    detalle: params.motivo ? { motivo: params.motivo } : undefined,
  });
}

// ---------- Registro para el modelo ----------

/** Herramientas que no se ejecutan hasta que el humano pulse "Confirmar". */
export const herramientasConConfirmacion = ["crear_registro_demo"] as const;

export function crearHerramientas(ctx: ContextoHerramientas) {
  return {
    ping: tool({
      description: "Prueba de conexión. Devuelve 'pong' y la fecha del servidor.",
      inputSchema: pingInput,
      execute: async (input) => ping(input, ctx),
    }),
    crear_registro_demo: tool({
      description:
        "Crea un registro de prueba (OC simulada) en el SAP simulado. Requiere confirmación humana. " +
        "Es idempotente: si la solicitud ya tiene registro, devuelve el existente.",
      inputSchema: crearRegistroDemoInput,
      execute: async (input) => crearRegistroDemo(input, ctx),
    }),
  } satisfies ToolSet;
}

export type HerramientasOC = ReturnType<typeof crearHerramientas>;
