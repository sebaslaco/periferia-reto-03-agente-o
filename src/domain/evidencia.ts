/** Evidencia de aprobación (HU-4): texto con encabezados y cuerpo, su sha256 y una versión PDF. */
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { AprobacionArchivo } from "./tipos";

/** Contenido canónico del correo de aprobación; el sha256 se calcula sobre este texto. */
export function contenidoEvidencia(a: AprobacionArchivo): string {
  return [
    `De: ${a.de}`,
    `Para: ${a.para}`,
    ...(a.cc?.length ? [`CC: ${a.cc.join(", ")}`] : []),
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    a.cuerpo,
  ].join("\n");
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Archivo aprobacion.txt: contenido + línea con su sha256. */
export function textoEvidencia(contenido: string): string {
  return `${contenido}\n\n---\nSHA-256 del contenido: ${sha256(contenido)}\n`;
}

/** Mismo contenido en PDF (fuente estándar Helvetica, WinAnsi). */
export async function pdfEvidencia(contenido: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Evidencia de aprobación");
  doc.setCreationDate(new Date(0)); // fijo para que el archivo sea reproducible
  doc.setModificationDate(new Date(0));
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const lineas = textoEvidencia(contenido).split("\n").flatMap((l) => partir(l, 90));
  let pagina = doc.addPage();
  let y = pagina.getHeight() - 50;
  for (const linea of lineas) {
    if (y < 50) {
      pagina = doc.addPage();
      y = pagina.getHeight() - 50;
    }
    pagina.drawText(linea, { x: 50, y, size: 10, font: fuente });
    y -= 14;
  }
  return doc.save();
}

function partir(linea: string, ancho: number): string[] {
  if (linea.length <= ancho) return [linea];
  const partes: string[] = [];
  for (let i = 0; i < linea.length; i += ancho) partes.push(linea.slice(i, i + ancho));
  return partes;
}
