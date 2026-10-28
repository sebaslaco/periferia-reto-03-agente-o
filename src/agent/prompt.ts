/** System prompt = comportamiento (agent/prompt.md) + conocimiento (src/knowledge/ordenes-compra.md). */
import { readFile } from "node:fs/promises";
import path from "node:path";

let enCache: string | undefined;

export async function cargarSystemPrompt(directorio: string): Promise<string> {
  if (enCache) return enCache;
  const [comportamiento, conocimiento] = await Promise.all([
    readFile(path.join(directorio, "agent", "prompt.md"), "utf8"),
    readFile(path.join(directorio, "src", "knowledge", "ordenes-compra.md"), "utf8"),
  ]);
  enCache = `${comportamiento.trim()}\n\n---\n\n${conocimiento.trim()}`;
  return enCache;
}
