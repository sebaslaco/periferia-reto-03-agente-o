/** Sesiones en memoria, respaldadas en archivo (OUT_DIR/sesiones/<id>.json). */
import path from "node:path";
import type { Mensaje } from "../llm/adapter";
import { directorioSalida, escribirSalida, leerTextoOpcional, type ContextoHerramienta } from "../infra/archivos";
import type { EntradaHistorial } from "./tipos";

export interface ConfirmacionPendiente {
  solicitud_id: string | null;
  reglas: string[];
}

export interface Sesion {
  id: string;
  creada: string;
  /** Conversación completa que se envía al modelo (sin el system prompt). */
  mensajes: Mensaje[];
  /** Historial visible en el chat. */
  historial: EntradaHistorial[];
  tokens: number;
  /** Casos con confirmación humana pendiente, por nombre de caso. */
  pendientes: Record<string, ConfirmacionPendiente>;
}

export const ID_SESION = /^[A-Za-z0-9_-]{8,64}$/;

const memoria = (globalThis as unknown as { __sesiones?: Map<string, Sesion> }).__sesiones ?? new Map<string, Sesion>();
(globalThis as unknown as { __sesiones?: Map<string, Sesion> }).__sesiones = memoria;

const archivo = (id: string) => path.join("sesiones", `${id}.json`);

export async function obtenerSesion(ctx: ContextoHerramienta, id: string): Promise<Sesion | null> {
  const enMemoria = memoria.get(id);
  if (enMemoria) return enMemoria;
  const texto = await leerTextoOpcional(path.join(directorioSalida(ctx), archivo(id)));
  if (!texto) return null;
  const sesion = JSON.parse(texto) as Sesion;
  memoria.set(id, sesion);
  return sesion;
}

export async function obtenerOCrearSesion(ctx: ContextoHerramienta, id: string, ahora: string): Promise<Sesion> {
  const existente = await obtenerSesion(ctx, id);
  if (existente) return existente;
  const nueva: Sesion = { id, creada: ahora, mensajes: [], historial: [], tokens: 0, pendientes: {} };
  memoria.set(id, nueva);
  return nueva;
}

export async function guardarSesion(ctx: ContextoHerramienta, sesion: Sesion): Promise<void> {
  memoria.set(sesion.id, sesion);
  await escribirSalida(ctx, archivo(sesion.id), JSON.stringify(sesion));
}
