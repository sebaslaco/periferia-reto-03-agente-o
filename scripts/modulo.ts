/**
 * Módulo reutilizable (PRD 9.4): genera modulo/agent.md y modulo/skill/ordenes-compra/SKILL.md
 * desde las mismas fuentes que usa la app (agent/prompt.md y src/knowledge/ordenes-compra.md).
 *
 *   bun run modulo               → (re)genera los archivos
 *   bun run modulo --verificar   → falla si los archivos del módulo difieren de las fuentes
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const AGENTE = `---
description: Asistente de la analista de compras que lee, valida y crea órdenes de compra en SAP con confirmación humana.
mode: primary
permission:
  edit: deny
  bash: deny
---

`;

const SKILL = `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra en SAP — maestros, reglas de control RC1–RC10 y qué hacer en cada excepción.
---

`;

/** Contenido esperado de cada archivo del módulo, calculado desde las fuentes de la app. */
export async function archivosModulo(raiz: string): Promise<Record<string, string>> {
  const [prompt, conocimiento] = await Promise.all([
    readFile(path.join(raiz, "agent", "prompt.md"), "utf8"),
    readFile(path.join(raiz, "src", "knowledge", "ordenes-compra.md"), "utf8"),
  ]);
  return {
    "modulo/agent.md": `${AGENTE}${prompt.trim()}\n`,
    "modulo/skill/ordenes-compra/SKILL.md": `${SKILL}${conocimiento.trim()}\n`,
  };
}

/** Lista los archivos del módulo que no coinciden con sus fuentes (vacía = todo sincronizado). */
export async function verificarModulo(raiz: string): Promise<string[]> {
  const esperados = await archivosModulo(raiz);
  const diferencias: string[] = [];
  for (const [relativa, contenido] of Object.entries(esperados)) {
    const actual = await readFile(path.join(raiz, relativa), "utf8").catch(() => null);
    if (actual !== contenido) diferencias.push(relativa);
  }
  return diferencias;
}

if (import.meta.main) {
  const raiz = path.resolve(import.meta.dir, "..");
  if (process.argv.includes("--verificar")) {
    const diferencias = await verificarModulo(raiz);
    if (diferencias.length > 0) {
      console.error(`❌ El módulo difiere de las fuentes de la app: ${diferencias.join(", ")}. Ejecuta: bun run modulo`);
      process.exit(1);
    }
    console.log("✅ modulo/ coincide con agent/prompt.md y src/knowledge/ordenes-compra.md");
  } else {
    for (const [relativa, contenido] of Object.entries(await archivosModulo(raiz))) {
      await mkdir(path.dirname(path.join(raiz, relativa)), { recursive: true });
      await writeFile(path.join(raiz, relativa), contenido);
      console.log(`Generado ${relativa}`);
    }
  }
}
