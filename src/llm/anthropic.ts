/** Implementación de ProveedorLLM para Anthropic (Messages API vía HTTP). */
import { ErrorProveedor, type DefinicionHerramienta, type Mensaje, type ProveedorLLM, type RespuestaLLM } from "./adapter";

const URL_API = "https://api.anthropic.com/v1/messages";
const VERSION_API = "2023-06-01";

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface MensajeApi {
  role: "user" | "assistant";
  content: Bloque[];
}

interface RespuestaApi {
  content: Bloque[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface OpcionesAnthropic {
  apiKey: string;
  modelo: string;
  timeoutMs: number;
  maxTokensRespuesta?: number;
}

/** Convierte el historial propio al formato de Anthropic, uniendo mensajes consecutivos del mismo rol. */
function aMensajesApi(mensajes: Mensaje[]): { system: string; messages: MensajeApi[] } {
  const system = mensajes.flatMap((m) => (m.rol === "sistema" ? [m.texto] : [])).join("\n\n");
  const messages: MensajeApi[] = [];
  const agregar = (role: MensajeApi["role"], content: Bloque[]) => {
    if (content.length === 0) return;
    const ultimo = messages.at(-1);
    if (ultimo?.role === role) ultimo.content.push(...content);
    else messages.push({ role, content });
  };
  for (const m of mensajes) {
    if (m.rol === "usuario") agregar("user", [{ type: "text", text: m.texto }]);
    if (m.rol === "asistente")
      agregar("assistant", [
        ...(m.texto ? [{ type: "text" as const, text: m.texto }] : []),
        ...m.llamadas.map((l) => ({ type: "tool_use" as const, id: l.id, name: l.nombre, input: l.args })),
      ]);
    if (m.rol === "herramienta")
      agregar("user", m.resultados.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.contenido })));
  }
  return { system, messages };
}

export class ProveedorAnthropic implements ProveedorLLM {
  readonly proveedor = "anthropic";
  readonly modelo: string;

  constructor(private readonly opciones: OpcionesAnthropic) {
    this.modelo = opciones.modelo;
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const { system, messages } = aMensajesApi(mensajes);
    let respuesta: Response;
    try {
      respuesta = await fetch(URL_API, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.opciones.apiKey, "anthropic-version": VERSION_API },
        body: JSON.stringify({
          model: this.modelo,
          max_tokens: this.opciones.maxTokensRespuesta ?? 4096,
          system,
          messages,
          tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.parametros })),
        }),
        signal: AbortSignal.timeout(this.opciones.timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
        throw new ErrorProveedor("El modelo tardó demasiado en responder. Intenta de nuevo en un momento.", `timeout ${this.opciones.timeoutMs} ms`);
      throw new ErrorProveedor("No pude comunicarme con el modelo. Intenta de nuevo.", e instanceof Error ? e.message : "fallo de red");
    }

    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => "");
      const mensaje =
        respuesta.status === 429 || respuesta.status === 529
          ? "El modelo está ocupado en este momento. Intenta de nuevo en unos segundos."
          : "No pude procesar la solicitud, intenta de nuevo";
      throw new ErrorProveedor(mensaje, `HTTP ${respuesta.status}: ${cuerpo.slice(0, 500)}`);
    }

    const datos = (await respuesta.json()) as RespuestaApi;
    return {
      texto: datos.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim(),
      llamadas: datos.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, nombre: b.name, args: b.input }] : [])),
      uso: { entrada: datos.usage?.input_tokens ?? 0, salida: datos.usage?.output_tokens ?? 0 },
    };
  }
}
