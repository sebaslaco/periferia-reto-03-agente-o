"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EntradaHistorial, RespuestaChat, ToolCallVisible } from "@/src/agent/tipos";

/** Mensaje único para cualquier error: el detalle técnico queda solo en los logs del servidor. */
const MENSAJE_ERROR = "No pude procesar la solicitud, intenta de nuevo";
const CLAVE_SESION = "agente-oc:sessionId";

function nuevaSesion(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function leerSesionGuardada(): string | null {
  try {
    return localStorage.getItem(CLAVE_SESION);
  } catch {
    return null;
  }
}

function guardarSesion(id: string) {
  try {
    localStorage.setItem(CLAVE_SESION, id);
  } catch {}
}

function Json({ valor }: { valor: unknown }) {
  return <pre className="json">{JSON.stringify(valor, null, 2)}</pre>;
}

function TarjetaHerramienta({ t }: { t: ToolCallVisible }) {
  const clase = t.ok ? "ok" : "error";
  return (
    <div className={`tarjeta ${clase}`}>
      <div className="tarjeta-cabecera">
        <span className="herramienta">🔧 {t.nombre}</span>
        <span className={`estado ${clase}`}>{t.ok ? "OK" : "Error"}</span>
      </div>
      <div className="resumen">{t.resumen}</div>
      {t.nota && <div className="nota">⚠️ {t.nota}</div>}
      <details>
        <summary>Argumentos</summary>
        <Json valor={t.args} />
      </details>
      <details>
        <summary>Resultado completo</summary>
        <Json valor={t.resultado} />
      </details>
    </div>
  );
}

export default function Chat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [historial, setHistorial] = useState<EntradaHistorial[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  // Recupera la sesión guardada (si el servidor aún la conserva) o crea una nueva.
  useEffect(() => {
    const guardada = leerSesionGuardada();
    const id = guardada ?? nuevaSesion();
    setSessionId(id);
    guardarSesion(id);
    if (!guardada) return;
    fetch(`/api/sessions/${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ historial: EntradaHistorial[] }>) : null))
      .then((s) => s && setHistorial(s.historial))
      .catch(() => {});
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [historial, pensando]);

  async function enviar(mensaje: string) {
    if (!sessionId || !mensaje.trim() || pensando) return;
    const ahora = new Date().toISOString();
    setHistorial((h) => [...h, { rol: "usuario", texto: mensaje, ts: ahora }]);
    setTexto("");
    setPensando(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: mensaje }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const datos = (await r.json()) as RespuestaChat;
      setHistorial((h) => [
        ...h,
        { rol: "asistente", texto: datos.reply, ts: new Date().toISOString(), toolCalls: datos.toolCalls, needsConfirmation: datos.needsConfirmation },
      ]);
    } catch {
      setHistorial((h) => [...h, { rol: "asistente", texto: MENSAJE_ERROR, ts: new Date().toISOString() }]);
    } finally {
      setPensando(false);
    }
  }

  function reiniciar() {
    const id = nuevaSesion();
    guardarSesion(id);
    setSessionId(id);
    setHistorial([]);
  }

  const ultimo = historial.at(-1);
  const esperaConfirmacion = !pensando && ultimo?.rol === "asistente" && ultimo.needsConfirmation === true;

  return (
    <main className="contenedor">
      <header>
        <div>
          <h1>Asistente de órdenes de compra</h1>
          <p>SAP simulado · ninguna orden se crea con excepciones sin tu confirmación</p>
        </div>
        <button type="button" className="secundario" onClick={reiniciar} disabled={pensando}>
          Nueva conversación
        </button>
      </header>

      <section className="mensajes">
        {historial.length === 0 && (
          <div className="vacio">Escribe un mensaje para empezar. Prueba: “Procesa la solicitud sol-004”.</div>
        )}
        {historial.map((m, i) => (
          <div key={i} className={`mensaje ${m.rol}${m.needsConfirmation ? " confirmacion-pendiente" : ""}`}>
            <div className="autor">{m.rol === "usuario" ? "Tú" : "Asistente"}</div>
            {m.toolCalls?.map((t, j) => <TarjetaHerramienta key={j} t={t} />)}
            {m.rol === "asistente" ? (
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.texto}</ReactMarkdown>
              </div>
            ) : (
              <p className="texto">{m.texto}</p>
            )}
            {m.needsConfirmation && i === historial.length - 1 && esperaConfirmacion && (
              <div className="confirmacion">
                <p>⏸️ El agente espera tu confirmación para crear la orden de compra.</p>
                <div className="botones">
                  <button className="confirmar" onClick={() => enviar("confirmo")}>
                    Confirmar
                  </button>
                  <button className="cancelar" onClick={() => enviar("cancelar")}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {pensando && <div className="pensando">Pensando…</div>}
        <div ref={finRef} />
      </section>

      <form
        className="entrada"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(texto);
        }}
      >
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe tu mensaje…" aria-label="Mensaje" disabled={pensando} />
        <button type="submit" disabled={!texto.trim() || pensando}>
          Enviar
        </button>
      </form>
    </main>
  );
}
