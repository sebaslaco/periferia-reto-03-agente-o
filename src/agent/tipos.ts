/** Tipos que comparten el backend y el front del chat. */

export interface ToolCallVisible {
  nombre: string;
  args: unknown;
  ok: boolean;
  resumen: string;
  resultado: unknown;
  /** Nota del agente, p. ej. cuando se forzó confirmado=false. */
  nota?: string;
}

export interface EntradaHistorial {
  rol: "usuario" | "asistente";
  texto: string;
  ts: string;
  toolCalls?: ToolCallVisible[];
  needsConfirmation?: boolean;
}

export interface RespuestaChat {
  sessionId: string;
  reply: string;
  toolCalls: ToolCallVisible[];
  needsConfirmation: boolean;
}
