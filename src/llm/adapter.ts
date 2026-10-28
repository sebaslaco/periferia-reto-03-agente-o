/**
 * Interfaz propia del proveedor de modelo de lenguaje (PRD 6.1).
 * El ciclo del agente solo conoce estos tipos; cambiar de proveedor = otra implementación de ProveedorLLM.
 */

export interface LlamadaHerramienta {
  id: string;
  nombre: string;
  args: unknown;
}

export interface ResultadoHerramienta {
  id: string;
  nombre: string;
  /** JSON serializado { ok, data } | { ok, error } tal como lo devolvió la herramienta. */
  contenido: string;
}

export type Mensaje =
  | { rol: "sistema"; texto: string }
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "herramienta"; resultados: ResultadoHerramienta[] };

export interface DefinicionHerramienta {
  nombre: string;
  descripcion: string;
  /** JSON Schema de los argumentos. */
  parametros: Record<string, unknown>;
}

export interface RespuestaLLM {
  texto: string;
  llamadas: LlamadaHerramienta[];
  uso: { entrada: number; salida: number };
}

/** Error del proveedor con un mensaje apto para mostrar al usuario (sin detalles técnicos). */
export class ErrorProveedor extends Error {
  constructor(
    readonly mensajeUsuario: string,
    readonly detalle: string,
  ) {
    super(detalle);
  }
}

export interface ProveedorLLM {
  readonly proveedor: string;
  readonly modelo: string;
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM>;
}
