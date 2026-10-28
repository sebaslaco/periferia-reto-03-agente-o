/** Configuración del agente desde variables de entorno (con valores por defecto). */
import { ProveedorAnthropic } from "../llm/anthropic";
import type { ProveedorLLM } from "../llm/adapter";

function entero(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre]);
  return Number.isInteger(valor) && valor > 0 ? valor : porDefecto;
}

export const config = {
  proveedor: "anthropic",
  modelo: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  maxIteraciones: entero("MAX_ITERACIONES", 25),
  maxTokensSesion: entero("MAX_TOKENS_SESION", 300_000),
  timeoutMs: entero("LLM_TIMEOUT_MS", 60_000),
};

export const hayClave = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** Proveedor configurado. Para cambiar de proveedor basta con devolver otra implementación de ProveedorLLM. */
export function crearProveedor(): ProveedorLLM {
  return new ProveedorAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "", modelo: config.modelo, timeoutMs: config.timeoutMs });
}
