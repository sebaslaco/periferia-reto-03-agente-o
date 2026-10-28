/** Lectura de fixtures y escritura de salidas (out/). Única capa que toca el disco. */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fechaColombia } from "../fechas";
import {
  centroCostoSchema,
  condicionPagoSchema,
  indicadorIvaSchema,
  proveedorSchema,
  type Maestros,
} from "../domain/tipos";
import type { z } from "zod";

export interface ContextoHerramienta {
  /** Raíz del proyecto; todas las rutas se resuelven desde aquí. */
  directory: string;
  sessionId: string;
}

/** Carpeta de salida: OUT_DIR, o /tmp/out en Vercel (disco de solo lectura), o ./out. */
export function directorioSalida(ctx: ContextoHerramienta): string {
  if (process.env.OUT_DIR) return path.resolve(ctx.directory, process.env.OUT_DIR);
  return process.env.VERCEL ? "/tmp/out" : path.join(ctx.directory, "out");
}

export const rutaFixtures = (ctx: ContextoHerramienta, ...partes: string[]) =>
  path.join(ctx.directory, "fixtures", "reto-03", ...partes);

/** Lee un archivo de texto; null si no existe. */
export async function leerTextoOpcional(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
}

/** Lee y valida un JSON; mensaje legible si está malformado o no cumple el esquema. */
export function parsearJson<T>(texto: string, esquema: z.ZodType<T>, nombre: string): T {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    throw new Error(`${nombre} no es un JSON válido.`);
  }
  const r = esquema.safeParse(crudo);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ");
    throw new Error(`${nombre} tiene datos inválidos: ${detalle}`);
  }
  return r.data;
}

async function leerMaestro<T>(ctx: ContextoHerramienta, archivo: string, esquema: z.ZodType<T>): Promise<T[]> {
  const texto = await leerTextoOpcional(rutaFixtures(ctx, "maestros", archivo));
  if (texto === null) throw new Error(`Falta el maestro ${archivo}.`);
  return parsearJson(texto, esquema.array(), `maestros/${archivo}`);
}

export async function cargarMaestros(ctx: ContextoHerramienta): Promise<Maestros> {
  const [proveedores, centrosCosto, indicadoresIva, condicionesPago] = await Promise.all([
    leerMaestro(ctx, "proveedores.json", proveedorSchema),
    leerMaestro(ctx, "centros-costo.json", centroCostoSchema),
    leerMaestro(ctx, "indicadores-iva.json", indicadorIvaSchema),
    leerMaestro(ctx, "condiciones-pago.json", condicionPagoSchema),
  ]);
  return { proveedores, centrosCosto, indicadoresIva, condicionesPago };
}

export async function escribirSalida(ctx: ContextoHerramienta, relativa: string, contenido: string | Uint8Array): Promise<string> {
  const ruta = path.join(directorioSalida(ctx), relativa);
  await mkdir(path.dirname(ruta), { recursive: true });
  await writeFile(ruta, contenido);
  return ruta;
}

export async function agregarLinea(ctx: ContextoHerramienta, relativa: string, linea: string, encabezado?: string): Promise<void> {
  const ruta = path.join(directorioSalida(ctx), relativa);
  await mkdir(path.dirname(ruta), { recursive: true });
  if (encabezado && (await leerTextoOpcional(ruta)) === null) await writeFile(ruta, `${encabezado}\n`);
  await appendFile(ruta, `${linea}\n`);
}

// ---------- Log de herramientas (CA4) ----------

export async function registrarLlamada(
  ctx: ContextoHerramienta,
  entrada: { herramienta: string; args: unknown; ok: boolean; data?: unknown; error?: string; duracion_ms: number },
): Promise<void> {
  await agregarLinea(ctx, "log.jsonl", JSON.stringify({ ts: fechaColombia(new Date()), sessionId: ctx.sessionId, ...entrada }));
}

// ---------- Log de control (HU-5) ----------

export type ResultadoControl = "creada" | "idempotente" | "bloqueada" | "pendiente" | "rechazada";

const ENCABEZADO_CONTROL = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts,confirmado_por,confirmado_en";
const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function registrarControl(
  ctx: ContextoHerramienta,
  fila: {
    solicitud_id: string;
    resultado: ResultadoControl;
    numero_oc: string | null;
    retroactiva: boolean;
    bloqueos: string[];
    confirmaciones: string[];
    confirmado_por: string | null;
    confirmado_en: string | null;
  },
): Promise<void> {
  const valores = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    fechaColombia(new Date()),
    fila.confirmado_por ?? "",
    fila.confirmado_en ?? "",
  ];
  await agregarLinea(ctx, "control.csv", valores.map(csv).join(","), ENCABEZADO_CONTROL);
}
