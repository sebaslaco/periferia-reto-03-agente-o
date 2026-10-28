import { readFile } from "node:fs/promises";
import path from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";
import * as oc from "@/src/tools/oc";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODELO_POR_DEFECTO = "claude-sonnet-5-5";

let promptEnCache: string | undefined;
async function cargarSystemPrompt(): Promise<string> {
  promptEnCache ??= await readFile(path.join(process.cwd(), "agent", "prompt.md"), "utf8");
  return promptEnCache;
}

/**
 * Puente provisional (fase A): expone las herramientas oc_* al AI SDK con el nombre <archivo>_<export>.
 * El ciclo del agente definitivo (adaptador LLM, sesiones, confirmación en el chat) llega en la fase B.
 */
function herramientas(ctx: oc.ContextoHerramienta) {
  return {
    oc_leer_paquete: tool({
      description: oc.leer_paquete.description,
      inputSchema: z.object(oc.leer_paquete.args),
      execute: (a) => oc.leer_paquete.execute(a, ctx),
    }),
    oc_validar: tool({
      description: oc.validar.description,
      inputSchema: z.object(oc.validar.args),
      execute: (a) => oc.validar.execute(a, ctx),
    }),
    oc_construir_payload: tool({
      description: oc.construir_payload.description,
      inputSchema: z.object(oc.construir_payload.args),
      execute: (a) => oc.construir_payload.execute(a, ctx),
    }),
    oc_generar_evidencia: tool({
      description: oc.generar_evidencia.description,
      inputSchema: z.object(oc.generar_evidencia.args),
      execute: (a) => oc.generar_evidencia.execute(a, ctx),
    }),
    oc_crear: tool({
      description: oc.crear.description,
      inputSchema: z.object(oc.crear.args),
      execute: (a) => oc.crear.execute(a, ctx),
    }),
  };
}

/** Lo único que ve el usuario cuando algo falla; el detalle técnico va solo a los logs del servidor. */
const MENSAJE_GENERICO = "No pude procesar la solicitud, intenta de nuevo";

function respuestaDeError(detalle: unknown) {
  console.error("[api/chat]", detalle);
  return Response.json({ error: MENSAJE_GENERICO }, { status: 500 });
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return respuestaDeError("Falta la variable de entorno ANTHROPIC_API_KEY en el servidor.");
  }

  try {
    const { messages, id } = (await req.json()) as { messages: UIMessage[]; id?: string };
    const tools = herramientas({ directory: process.cwd(), sessionId: id ?? "web" });
    const result = streamText({
      model: anthropic(process.env.ANTHROPIC_MODEL || MODELO_POR_DEFECTO),
      system: await cargarSystemPrompt(),
      messages: await convertToModelMessages(messages, { tools }),
      tools,
      toolApproval: { oc_crear: "user-approval" },
      stopWhen: isStepCount(10),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        tools,
        originalMessages: messages,
        onError: (error) => {
          console.error("[api/chat]", error);
          return MENSAJE_GENERICO;
        },
      }),
    });
  } catch (error) {
    return respuestaDeError(error);
  }
}
