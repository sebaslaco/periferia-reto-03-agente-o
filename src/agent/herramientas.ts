/**
 * Registro de herramientas: cada export de src/tools/oc.ts se expone al modelo como oc_<export>.
 * Valida los argumentos con zod antes de ejecutar; si no cumplen, devuelve el error al modelo.
 */
import { z } from "zod";
import * as oc from "../tools/oc";
import type { DefinicionHerramienta } from "../llm/adapter";

/** Forma de una herramienta (PRD 6.2). `execute` en sintaxis de método para aceptar cada firma concreta. */
interface Herramienta {
  description: string;
  args: z.ZodRawShape;
  execute(args: Record<string, unknown>, ctx: oc.ContextoHerramienta): Promise<string>;
}

function esHerramienta(valor: unknown): valor is Herramienta {
  return (
    typeof valor === "object" &&
    valor !== null &&
    "description" in valor &&
    "args" in valor &&
    "execute" in valor &&
    typeof valor.execute === "function"
  );
}

const registro = new Map<string, Herramienta>(
  Object.entries(oc).flatMap(([nombre, valor]): [string, Herramienta][] => (esHerramienta(valor) ? [[`oc_${nombre}`, valor]] : [])),
);

export const definiciones: DefinicionHerramienta[] = [...registro].map(([nombre, h]) => {
  const { $schema: _omitido, ...parametros } = z.toJSONSchema(z.object(h.args));
  return { nombre, descripcion: h.description, parametros };
});

export async function ejecutarHerramienta(nombre: string, args: unknown, ctx: oc.ContextoHerramienta): Promise<string> {
  const h = registro.get(nombre);
  if (!h) return JSON.stringify({ ok: false, error: `La herramienta ${nombre} no existe.` });
  const parse = z.object(h.args).safeParse(args);
  if (!parse.success) {
    const detalle = parse.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ");
    return JSON.stringify({ ok: false, error: `Argumentos inválidos: ${detalle}` });
  }
  return h.execute(parse.data, ctx);
}

// ---------- Resumen legible del resultado para el chat ----------

type Json = Record<string, unknown>;
const esObjeto = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const reglas = (v: unknown) => (Array.isArray(v) ? v.flatMap((h) => (esObjeto(h) && typeof h.regla === "string" ? [h.regla] : [])) : []);

export function resumir(nombre: string, resultado: unknown): string {
  if (!esObjeto(resultado)) return "Respuesta no válida";
  if (resultado.ok !== true) return `Error: ${String(resultado.error ?? "desconocido")}`;
  const d = esObjeto(resultado.data) ? resultado.data : {};
  switch (nombre) {
    case "oc_leer_paquete": {
      const s = esObjeto(d.solicitud) ? d.solicitud : {};
      const faltan = Array.isArray(d.faltantes) && d.faltantes.length ? ` · faltan: ${d.faltantes.join(", ")}` : "";
      return `Paquete ${String(s.solicitud_id ?? "")} · ${String(s.proveedor_nombre ?? "")} · ${String(s.valor_total ?? "")} ${String(s.moneda ?? "")}${faltan}`;
    }
    case "oc_validar": {
      const b = reglas(d.bloqueos);
      const c = reglas(d.confirmaciones);
      return `apta=${String(d.apta)} · bloqueos: ${b.join(", ") || "ninguno"} · confirmaciones: ${c.join(", ") || "ninguna"} · retroactiva=${String(d.retroactiva)}`;
    }
    case "oc_construir_payload": {
      const p = esObjeto(d.payload) ? d.payload : {};
      const prov = esObjeto(p.proveedor) ? p.proveedor : {};
      return `OC lista para SAP · ${String(prov.nombre ?? "")} · trazabilidad en ${String(d.trazabilidad ?? "")}`;
    }
    case "oc_generar_evidencia":
      return `Evidencia: ${String(d.ruta ?? "")} y ${String(d.ruta_pdf ?? "")}`;
    case "oc_crear":
      return `OC ${String(d.numero_oc ?? "")}${d.idempotente === true ? " (ya existía, idempotente)" : " creada"}${d.retroactiva === true ? " · retroactiva" : ""}`;
    default:
      return "Completada";
  }
}
