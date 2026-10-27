# periferia-reto-03-agente-o

Agente conversacional de órdenes de compra – Prueba IA Periferia (Reto 3).

Chat web en español que conversa con Claude, llama herramientas tipadas con zod y crea órdenes de compra en un **SAP simulado**, siempre con **confirmación humana** antes de crear la OC.

## Estructura

| Ruta | Qué es |
|---|---|
| `app/page.tsx` | Chat web: mensajes, tarjetas de herramientas (nombre, entrada, salida) y botones Confirmar / Cancelar. |
| `app/api/chat/route.ts` | Backend: lee `ANTHROPIC_API_KEY`, carga `agent/prompt.md` y registra las herramientas de `src/tools/oc.ts`. |
| `agent/prompt.md` | System prompt del agente. |
| `src/tools/oc.ts` | Herramientas (esquemas zod + funciones en código). Hoy: `ping` y `crear_registro_demo` (exige confirmación). |
| `src/sap/sap-simulado.ts` | SAP simulado: consecutivo de OC, bloqueo de duplicados por id de solicitud y log de auditoría. |
| `demo.ts` | Demo sin modelo de IA: llama las herramientas directamente; salida determinística. |
| `fixtures/reto-03/` | Aquí van los maestros y casos del reto (`sol-001` a `sol-006`). |
| `agent/SOLUCION.md` | Documento de la solución. |

## Requisitos

- [Bun](https://bun.sh) 1.x
- Una API key de Anthropic (solo para el chat; la demo no la necesita).

## Instalación

```bash
bun install
cp .env.example .env.local   # y escribe tu ANTHROPIC_API_KEY en .env.local
```

`.env.local` está en `.gitignore`: la clave nunca se sube al repositorio.

## Ejecución local

```bash
bun run dev          # abre http://localhost:3000
bun run demo.ts      # demo sin IA (también: bun run demo)
bun run typecheck    # revisa tipos
bun run build        # compila como en producción
```

Prueba en el chat: “haz un ping” y luego “crea un registro demo para la solicitud DEMO-001”. Aparecerán los botones **Confirmar / Cancelar**; la OC solo se crea si confirmas. Si repites la misma solicitud, el SAP simulado devuelve la OC existente en lugar de crear otra.

## Despliegue en Vercel

1. En [vercel.com](https://vercel.com) → **Add New… → Project** → importa este repositorio de GitHub. Nombre del proyecto: `agente-oc-periferia`.
2. Framework: **Next.js** (se detecta solo). Vercel detecta `bun.lock` y usa Bun para instalar.
3. En **Settings → Environment Variables** agrega `ANTHROPIC_API_KEY` (y opcionalmente `ANTHROPIC_MODEL`, por defecto `claude-sonnet-5-5`).
4. **Deploy**. Cada push a `main` publica una nueva versión automáticamente.

> El SAP simulado guarda los datos en memoria: en Vercel se reinician cuando la función se recicla. Es suficiente para la demo; en producción se reemplaza por un adaptador SAP real.
