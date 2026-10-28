/** Funciones puras para normalizar los textos de los fixtures (PRD 7.2). */
import type { AprobacionArchivo, Paquete } from "./tipos";

/** "900.555.111-2" → "900555111" (quita puntos, espacios y dígito de verificación). */
export function normalizarNit(nit: string): string {
  return nit.split("-")[0]!.replace(/\D/g, "");
}

/** "COP 11.400.000" → 11400000. Devuelve null si no hay un número válido. */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.replace(/[A-Za-z$\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  return Number(limpio);
}

/** Minúsculas, sin tildes ni puntuación: "TecnoSuministros S.A.S." → "tecnosuministros sas". */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Día (AAAA-MM-DD) de una fecha ISO; para comparar solo la fecha, no la hora. */
export function dia(fecha: string): string {
  return fecha.slice(0, 10);
}

function campo(texto: string, etiqueta: RegExp): string | null {
  const m = texto.match(etiqueta);
  return m?.[1]?.trim() ?? null;
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export type Cotizacion = NonNullable<Paquete["cotizacion"]>;

/** Extrae los datos de cotizacion.txt. */
export function parsearCotizacion(texto: string): Cotizacion {
  const totalLinea = campo(texto, /^TOTAL[^:]*:\s*(.+)$/m);
  const total = totalLinea ? parsearMonto(totalLinea) : null;
  if (total === null) throw new Error("La cotización no tiene un TOTAL numérico.");
  const nit = campo(texto, /^NIT:\s*(.+)$/m);
  const fecha = campo(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m);
  const diasValidez = campo(texto, /^Validez de la oferta:\s*(\d+)\s*d[ií]as/m);
  return {
    proveedor: campo(texto, /^Proveedor:\s*(.+)$/m) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total,
    moneda: totalLinea?.match(/\b(COP|USD)\b/)?.[1] ?? "COP",
    validez_hasta: fecha && diasValidez ? sumarDias(fecha, Number(diasValidez)) : null,
    texto,
  };
}

/** Número de la cotización (primera línea "COTIZACIÓN XXX"), para la referencia de la OC. */
export function referenciaCotizacion(texto: string): string | null {
  return campo(texto, /^COTIZACI[OÓ]N\s+(\S+)/m);
}

/** Extrae los datos de factura.txt. */
export function parsearFactura(texto: string): NonNullable<Paquete["factura"]> {
  const numero = campo(texto, /No\.\s*(\S+)/);
  const fecha = campo(texto, /^Fecha de emisi[oó]n:\s*(\d{4}-\d{2}-\d{2})/m);
  const totalLinea = campo(texto, /^TOTAL:\s*(.+)$/m);
  const total = totalLinea ? parsearMonto(totalLinea) : null;
  if (!numero || !fecha || total === null) throw new Error("La factura no tiene número, fecha o total legibles.");
  return { numero, fecha, total };
}

/** Aprobado = el cuerpo contiene "Aprobado" y no es una negación ("no aprobado"). */
export function normalizarAprobacion(a: AprobacionArchivo): NonNullable<Paquete["aprobacion"]> {
  const aprobado = /\baprobad[oa]\b/i.test(a.cuerpo) && !/\bno\s+aprobad[oa]\b/i.test(a.cuerpo);
  return { de: a.de.toLowerCase(), fecha: a.fecha, aprobado, texto: a.cuerpo };
}
