/**
 * Herramientas del agente de órdenes de compra (contrato PRD 6.2).
 * Cada export es { description, args, execute(args, ctx) }; el modelo la ve como oc_<export>.
 * execute devuelve SIEMPRE un string JSON { ok: true, data } o { ok: false, error } y nunca lanza.
 *
 * Las herramientas solo orquestan: la lógica de negocio vive en src/domain (funciones puras).
 * Para que el modelo no pueda alterar montos, cada herramienta recalcula desde los fixtures
 * y rechaza un paquete, derivados o payload que no coincidan con lo recalculado.
 */
import path from "node:path";
import { z } from "zod";
import { contenidoEvidencia, pdfEvidencia, sha256, textoEvidencia } from "../domain/evidencia";
import { normalizarAprobacion, parsearCotizacion, parsearFactura, referenciaCotizacion } from "../domain/parseo";
import { confirmarExcepciones, construirOrden } from "../domain/payload";
import { validar as aplicarReglas } from "../domain/reglas";
import {
  aprobacionArchivoSchema,
  correoSchema,
  derivadosSchema,
  ordenCompraSchema,
  paqueteSchema,
  solicitudSchema,
  type AprobacionArchivo,
  type OrdenCompra,
  type Paquete,
  type Validacion,
} from "../domain/tipos";
import {
  cargarMaestros,
  directorioSalida,
  escribirSalida,
  leerTextoOpcional,
  parsearJson,
  registrarControl,
  registrarLlamada,
  rutaFixtures,
  type ContextoHerramienta,
  type ResultadoControl,
} from "../infra/archivos";
import { SapMock } from "../sap/mock";

export type { ContextoHerramienta };

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

/** Error esperado de negocio o de datos: su mensaje se devuelve tal cual al modelo. */
class ErrorHerramienta extends Error {}

/** Envoltorio común: valida args con zod, nunca lanza, registra en out/log.jsonl. */
async function ejecutar<A extends z.ZodRawShape, T>(
  nombre: string,
  args: A,
  entrada: unknown,
  ctx: ContextoHerramienta,
  fn: (a: z.infer<z.ZodObject<A>>) => Promise<T>,
): Promise<string> {
  const inicio = Date.now();
  let resultado: Resultado<T>;
  const parse = z.object(args).safeParse(entrada);
  if (!parse.success) {
    const detalle = parse.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ");
    resultado = { ok: false, error: `Argumentos inválidos: ${detalle}` };
  } else {
    try {
      resultado = { ok: true, data: await fn(parse.data) };
    } catch (e) {
      const mensaje = e instanceof ErrorHerramienta || e instanceof Error ? e.message : "Error inesperado.";
      if (!(e instanceof ErrorHerramienta)) console.error(`[oc_${nombre}]`, e);
      resultado = { ok: false, error: mensaje };
    }
  }
  try {
    await registrarLlamada(ctx, {
      herramienta: `oc_${nombre}`,
      args: entrada,
      ok: resultado.ok,
      ...(resultado.ok ? {} : { error: resultado.error }),
      duracion_ms: Date.now() - inicio,
    });
  } catch (e) {
    console.error("[log.jsonl]", e);
  }
  return JSON.stringify(resultado);
}

// ---------- Lectura de un caso ----------

const casoArg = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Nombre de caso inválido")
  .describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo sol-001");

async function leerArchivoCaso(ctx: ContextoHerramienta, caso: string, archivo: string): Promise<string | null> {
  return leerTextoOpcional(rutaFixtures(ctx, "solicitudes", caso, archivo));
}

async function leerAprobacionArchivo(ctx: ContextoHerramienta, caso: string): Promise<AprobacionArchivo | null> {
  const texto = await leerArchivoCaso(ctx, caso, "aprobacion.json");
  return texto === null ? null : parsearJson(texto, aprobacionArchivoSchema, `${caso}/aprobacion.json`);
}

/** Lee y normaliza el paquete del caso (PRD 7.2). Adjunto opcional ausente → null. */
async function leerPaqueteCaso(ctx: ContextoHerramienta, caso: string): Promise<{ paquete: Paquete; faltantes: string[] }> {
  const [correoTxt, solicitudTxt, cotizacionTxt, facturaTxt] = await Promise.all([
    leerArchivoCaso(ctx, caso, "correo.json"),
    leerArchivoCaso(ctx, caso, "solicitud.json"),
    leerArchivoCaso(ctx, caso, "cotizacion.txt"),
    leerArchivoCaso(ctx, caso, "factura.txt"),
  ]);
  if (correoTxt === null && solicitudTxt === null) throw new ErrorHerramienta(`No existe el caso "${caso}" o está vacío.`);
  if (correoTxt === null) throw new ErrorHerramienta(`Paquete incompleto: falta correo.json en ${caso}. Pedir el correo original al solicitante.`);
  if (solicitudTxt === null) throw new ErrorHerramienta(`Paquete incompleto: falta solicitud.json en ${caso}. Pedir el Excel de solicitud al solicitante.`);

  const aprobacion = await leerAprobacionArchivo(ctx, caso);
  const paquete: Paquete = {
    correo: parsearJson(correoTxt, correoSchema, `${caso}/correo.json`),
    solicitud: parsearJson(solicitudTxt, solicitudSchema, `${caso}/solicitud.json`),
    cotizacion: cotizacionTxt === null ? null : parsearCotizacion(cotizacionTxt),
    aprobacion: aprobacion === null ? null : normalizarAprobacion(aprobacion),
    factura: facturaTxt === null ? null : parsearFactura(facturaTxt),
  };
  const faltantes = [
    ...(cotizacionTxt === null ? ["cotizacion"] : []),
    ...(aprobacion === null ? ["aprobacion"] : []),
  ];
  return { paquete, faltantes };
}

/** Serialización estable (claves ordenadas, sin undefined) para comparar objetos. */
function canonico(valor: unknown): string {
  return JSON.stringify(valor, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function exigirIgual(recibido: unknown, esperado: unknown, que: string): void {
  if (canonico(recibido) !== canonico(esperado))
    throw new ErrorHerramienta(`${que} no coincide con lo leído de los fixtures. Vuelve a llamar las herramientas anteriores sin modificar sus resultados.`);
}

/** Recalcula todo desde los fixtures: paquete, validación y (si es posible) payload. */
async function recalcular(ctx: ContextoHerramienta, caso: string) {
  const { paquete } = await leerPaqueteCaso(ctx, caso);
  const maestros = await cargarMaestros(ctx);
  const validacion = aplicarReglas(paquete, maestros);
  const aprobacionArchivo = await leerAprobacionArchivo(ctx, caso);
  const evidenciaSha256 = aprobacionArchivo ? sha256(contenidoEvidencia(aprobacionArchivo)) : "";
  const cotizacionRef = paquete.cotizacion ? referenciaCotizacion(paquete.cotizacion.texto) : null;
  const payload = construirOrden({ paquete, maestros, validacion, cotizacionRef, evidenciaSha256 });
  return { paquete, validacion, payload };
}

/** Ruta legible relativa a la carpeta de salida, p. ej. "out/sol-004/aprobacion.txt" (también en Vercel). */
function rutaVisible(ctx: ContextoHerramienta, ruta: string): string {
  return path.posix.join("out", path.relative(directorioSalida(ctx), ruta).split(path.sep).join("/"));
}

const codigos = (v: Validacion) => ({ bloqueos: v.bloqueos.map((b) => b.regla), confirmaciones: v.confirmaciones.map((c) => c.regla) });

// ---------- Herramientas ----------

const argsLeer = { caso: casoArg };
export const leer_paquete = {
  description: "Lee y normaliza el paquete de un caso (correo, solicitud, cotización, aprobación y factura); los adjuntos ausentes vienen como null.",
  args: argsLeer,
  execute: (args: z.infer<z.ZodObject<typeof argsLeer>>, ctx: ContextoHerramienta) =>
    ejecutar("leer_paquete", argsLeer, args, ctx, async ({ caso }) => {
      const { paquete, faltantes } = await leerPaqueteCaso(ctx, caso);
      return { ...paquete, faltantes };
    }),
};

const argsValidar = {
  caso: casoArg,
  paquete: paqueteSchema.describe("Paquete normalizado devuelto por oc_leer_paquete, sin modificar"),
};
export const validar = {
  description: "Aplica las reglas de control RC1–RC10 al paquete y devuelve apta, bloqueos, confirmaciones, derivados y retroactiva.",
  args: argsValidar,
  execute: (args: z.infer<z.ZodObject<typeof argsValidar>>, ctx: ContextoHerramienta) =>
    ejecutar("validar", argsValidar, args, ctx, async ({ caso, paquete }) => {
      const r = await recalcular(ctx, caso);
      exigirIgual(paquete, r.paquete, "El paquete recibido");
      return r.validacion;
    }),
};

const argsPayload = {
  caso: casoArg,
  paquete: paqueteSchema.describe("Paquete normalizado devuelto por oc_leer_paquete, sin modificar"),
  derivados: derivadosSchema.describe("Objeto derivados devuelto por oc_validar, sin modificar"),
};
export const construir_payload = {
  description: "Construye la orden de compra exactamente como quedaría en SAP y guarda la trazabilidad de cada valor.",
  args: argsPayload,
  execute: (args: z.infer<z.ZodObject<typeof argsPayload>>, ctx: ContextoHerramienta) =>
    ejecutar("construir_payload", argsPayload, args, ctx, async ({ caso, paquete, derivados }) => {
      const r = await recalcular(ctx, caso);
      exigirIgual(paquete, r.paquete, "El paquete recibido");
      exigirIgual(derivados, r.validacion.derivados, "Los derivados recibidos");
      if (!r.payload.ok) throw new ErrorHerramienta(r.payload.error);
      const ruta = await escribirSalida(ctx, path.join(caso, "trazabilidad.json"), JSON.stringify(r.payload.trazabilidad, null, 2));
      return { payload: r.payload.orden, trazabilidad: rutaVisible(ctx, ruta) };
    }),
};

const argsEvidencia = { caso: casoArg };
export const generar_evidencia = {
  description: "Genera la evidencia del correo de aprobación (aprobacion.txt con sha256 y aprobacion.pdf) en la carpeta de salida del caso.",
  args: argsEvidencia,
  execute: (args: z.infer<z.ZodObject<typeof argsEvidencia>>, ctx: ContextoHerramienta) =>
    ejecutar("generar_evidencia", argsEvidencia, args, ctx, async ({ caso }) => {
      const aprobacion = await leerAprobacionArchivo(ctx, caso);
      if (!aprobacion) throw new ErrorHerramienta(`El caso ${caso} no tiene correo de aprobación; no hay evidencia que generar.`);
      const contenido = contenidoEvidencia(aprobacion);
      const rutaTxt = await escribirSalida(ctx, path.join(caso, "aprobacion.txt"), textoEvidencia(contenido));
      const rutaPdf = await escribirSalida(ctx, path.join(caso, "aprobacion.pdf"), await pdfEvidencia(contenido));
      return { ruta: rutaVisible(ctx, rutaTxt), ruta_pdf: rutaVisible(ctx, rutaPdf), sha256: sha256(contenido) };
    }),
};

const argsCrear = {
  caso: casoArg,
  payload: ordenCompraSchema
    .nullable()
    .describe("Payload devuelto por oc_construir_payload, sin modificar (null solo si la solicitud tiene bloqueos y no hay payload)"),
  confirmado: z
    .boolean()
    .optional()
    .describe("true solo si el usuario confirmó explícitamente en su último mensaje las excepciones informadas"),
};
export const crear = {
  description: "Crea la orden de compra en SAP (simulado) si la solicitud es apta y, cuando hay confirmaciones, el usuario las confirmó; es idempotente.",
  args: argsCrear,
  execute: (args: z.infer<z.ZodObject<typeof argsCrear>>, ctx: ContextoHerramienta) =>
    ejecutar("crear", argsCrear, args, ctx, async ({ caso, payload, confirmado }) => {
      const r = await recalcular(ctx, caso);
      const { solicitud_id } = r.paquete.solicitud;
      const { bloqueos, confirmaciones } = codigos(r.validacion);
      const control = (resultado: ResultadoControl, numero_oc: string | null = null) =>
        registrarControl(ctx, { solicitud_id, resultado, numero_oc, retroactiva: r.validacion.retroactiva, bloqueos, confirmaciones });
      const sap = new SapMock(ctx);

      const existente = await sap.buscarOrdenPorReferencia(solicitud_id);
      if (existente) {
        await control("idempotente", existente.numero_oc);
        return { numero_oc: existente.numero_oc, fecha: null, idempotente: true, retroactiva: r.validacion.retroactiva };
      }
      if (!r.validacion.apta) {
        await control("bloqueada");
        throw new ErrorHerramienta(`No se crea la OC: la solicitud tiene bloqueos (${bloqueos.join(", ")}).`);
      }
      if (confirmaciones.length > 0 && confirmado !== true) {
        await control("pendiente");
        throw new ErrorHerramienta(
          `No se crea la OC: requiere confirmación humana de ${confirmaciones.join(", ")}. Pregunta al usuario y vuelve a llamar con confirmado=true solo si confirma.`,
        );
      }
      if (!r.payload.ok) {
        await control("rechazada");
        throw new ErrorHerramienta(r.payload.error);
      }
      try {
        exigirIgual(payload, r.payload.orden, "El payload recibido");
      } catch (e) {
        await control("rechazada");
        throw e;
      }
      const orden: OrdenCompra = confirmaciones.length > 0 ? confirmarExcepciones(r.payload.orden, `analista (sesión ${ctx.sessionId})`) : r.payload.orden;
      const creada = await sap.crearOrden(orden);
      await control("creada", creada.numero_oc);
      return { ...creada, idempotente: false, retroactiva: r.validacion.retroactiva };
    }),
};
