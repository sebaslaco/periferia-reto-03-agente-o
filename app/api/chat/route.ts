import { readFile } from "node:fs/promises";
import path from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  getToolName,
  isStepCount,
  isToolUIPart,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { sap } from "@/src/sap/sap-simulado";
import { crearHerramientas, herramientasConConfirmacion, registrarDecisionHumana } from "@/src/tools/oc";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODELO_POR_DEFECTO = "claude-sonnet-5-5";

let promptEnCache: string | undefined;
async function cargarSystemPrompt(): Promise<string> {
  promptEnCache ??= await readFile(path.join(process.cwd(), "agent", "prompt.md"), "utf8");
  return promptEnCache;
}

/** Deja en auditoría lo que el humano decidió (Confirmar / Cancelar) en el último mensaje. */
function auditarDecisiones(messages: UIMessage[]) {
  const ultimo = messages.at(-1);
  if (ultimo?.role !== "assistant") return;
  for (const part of ultimo.parts) {
    if (!isToolUIPart(part) || part.state !== "approval-responded" || part.approval.isAutomatic) continue;
    const input = (part.input ?? {}) as { solicitud_id?: unknown };
    registrarDecisionHumana(
      { sap, actor: "usuario" },
      {
        herramienta: getToolName(part),
        aprobado: part.approval.approved,
        solicitudId: typeof input.solicitud_id === "string" ? input.solicitud_id : undefined,
        motivo: part.approval.reason,
      },
    );
  }
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Falta la variable de entorno ANTHROPIC_API_KEY en el servidor." },
      { status: 500 },
    );
  }

  const { messages } = (await req.json()) as { messages: UIMessage[] };
  auditarDecisiones(messages);

  const tools = crearHerramientas({ sap, actor: "agente" });
  const result = streamText({
    model: anthropic(process.env.ANTHROPIC_MODEL || MODELO_POR_DEFECTO),
    system: await cargarSystemPrompt(),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    toolApproval: Object.fromEntries(herramientasConConfirmacion.map((h) => [h, "user-approval" as const])),
    stopWhen: isStepCount(10),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      onError: (error) => (error instanceof Error ? error.message : "Error inesperado en el servidor."),
    }),
  });
}
