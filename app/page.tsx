"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";
import { useEffect, useRef, useState } from "react";

type ParteHerramienta = ToolUIPart | DynamicToolUIPart;

const ESTADOS: Record<ParteHerramienta["state"], { texto: string; clase: string }> = {
  "input-streaming": { texto: "Preparando…", clase: "pendiente" },
  "input-available": { texto: "Ejecutando…", clase: "pendiente" },
  "approval-requested": { texto: "Requiere tu confirmación", clase: "espera" },
  "approval-responded": { texto: "Respuesta enviada", clase: "pendiente" },
  "output-available": { texto: "Completada", clase: "ok" },
  "output-error": { texto: "Error", clase: "error" },
  "output-denied": { texto: "Cancelada por el usuario", clase: "error" },
};

/** Mensaje único para cualquier error: el detalle técnico queda solo en los logs del servidor. */
const MENSAJE_ERROR = "No pude procesar la solicitud, intenta de nuevo";

function Json({ valor }: { valor: unknown }) {
  return <pre className="json">{JSON.stringify(valor, null, 2)}</pre>;
}

function TarjetaHerramienta({
  part,
  responder,
  ocupado,
}: {
  part: ParteHerramienta;
  responder: (id: string, aprobado: boolean) => void;
  ocupado: boolean;
}) {
  const estado = ESTADOS[part.state];
  const pideConfirmacion = part.state === "approval-requested" && !part.approval.isAutomatic;

  return (
    <div className={`tarjeta ${estado.clase}`}>
      <div className="tarjeta-cabecera">
        <span className="herramienta">🔧 {getToolName(part)}</span>
        <span className={`estado ${estado.clase}`}>{estado.texto}</span>
      </div>
      {part.input !== undefined && (
        <>
          <div className="etiqueta">Entrada</div>
          <Json valor={part.input} />
        </>
      )}
      {part.state === "output-available" && (
        <>
          <div className="etiqueta">Salida</div>
          <Json valor={part.output} />
        </>
      )}
      {part.state === "output-error" && <div className="error-texto">{MENSAJE_ERROR}</div>}
      {pideConfirmacion && (
        <div className="confirmacion">
          <p>Esta acción necesita aprobación humana antes de ejecutarse. ¿Deseas continuar?</p>
          {part.approval.requestReason && <p className="motivo">{part.approval.requestReason}</p>}
          <div className="botones">
            <button className="confirmar" disabled={ocupado} onClick={() => responder(part.approval.id, true)}>
              Confirmar
            </button>
            <button className="cancelar" disabled={ocupado} onClick={() => responder(part.approval.id, false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Chat() {
  const { messages, sendMessage, addToolApprovalResponse, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [texto, setTexto] = useState("");
  const finRef = useRef<HTMLDivElement>(null);
  const ocupado = status === "submitted" || status === "streaming";

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const responder = (id: string, aprobado: boolean) =>
    addToolApprovalResponse({ id, approved: aprobado, reason: aprobado ? undefined : "Cancelado por el usuario" });

  return (
    <main className="contenedor">
      <header>
        <h1>Asistente de órdenes de compra</h1>
        <p>SAP simulado · toda acción que crea una orden requiere tu confirmación</p>
      </header>

      <section className="mensajes">
        {messages.length === 0 && (
          <div className="vacio">Escribe un mensaje para empezar. Prueba: “haz un ping”.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`mensaje ${m.role}`}>
            <div className="autor">{m.role === "user" ? "Tú" : "Asistente"}</div>
            {m.parts.map((part, i) => {
              if (part.type === "text") return <p key={i} className="texto">{part.text}</p>;
              if (isToolUIPart(part))
                return <TarjetaHerramienta key={part.toolCallId} part={part} responder={responder} ocupado={ocupado} />;
              return null;
            })}
          </div>
        ))}
        {status === "submitted" && <div className="pensando">Pensando…</div>}
        {error && <div className="error-global">{MENSAJE_ERROR}</div>}
        <div ref={finRef} />
      </section>

      <form
        className="entrada"
        onSubmit={(e) => {
          e.preventDefault();
          if (!texto.trim() || ocupado) return;
          sendMessage({ text: texto });
          setTexto("");
        }}
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escribe tu mensaje…"
          aria-label="Mensaje"
        />
        {ocupado ? (
          <button type="button" onClick={() => stop()}>
            Detener
          </button>
        ) : (
          <button type="submit" disabled={!texto.trim()}>
            Enviar
          </button>
        )}
      </form>
    </main>
  );
}
