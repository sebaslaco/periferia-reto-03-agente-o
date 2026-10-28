# periferia-reto-03-agente-o

Agente conversacional de órdenes de compra – Prueba IA Periferia (Reto 3).

Chat web en español que conversa con Claude, llama herramientas tipadas con zod y crea órdenes de compra en un **SAP simulado**, siempre con **confirmación humana** antes de crear la OC.

## Estructura

| Ruta | Qué es |
|---|---|
| `app/page.tsx` | Chat web: historial, tarjetas de herramientas (nombre, argumentos, resultado resumido), markdown y botones Confirmar / Cancelar. |
| `app/api/*` | API HTTP: `/api/chat`, `/api/sessions/:id`, `/api/health`. |
| `src/agent/` | Ciclo del agente (`loop.ts`), registro de herramientas, sesiones, detección de confirmaciones y carga del prompt. |
| `src/llm/` | Interfaz propia del proveedor (`adapter.ts`) e implementación Anthropic (`anthropic.ts`). |
| `agent/prompt.md` | System prompt (comportamiento). Se envía junto con `src/knowledge/ordenes-compra.md`. |
| `src/tools/oc.ts` | Herramientas `oc_leer_paquete`, `oc_validar`, `oc_construir_payload`, `oc_generar_evidencia`, `oc_crear` (contrato PRD 6.2). |
| `src/domain/` | Reglas RC1–RC10, parseo, payload y evidencia como funciones puras. |
| `src/sap/adapter.ts`, `src/sap/mock.ts` | Interfaz `SapAdapter` y SAP simulado sobre archivos (`out/sap/ordenes.jsonl`). |
| `src/knowledge/ordenes-compra.md` | Conocimiento del proceso: reglas, maestros y qué hacer en cada excepción. |
| `demo.ts` | Procesa sol-001 a sol-006 llamando las herramientas sin modelo de IA; verifica el resultado esperado. |
| `fixtures/reto-03/` | Aquí van los maestros y casos del reto (`sol-001` a `sol-006`). |
| `SOLUCION.md` | Documento de la solución (arquitectura, controles, adaptador SAP, análisis). |

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

Salidas en `out/` (configurable con `OUT_DIR`; en Vercel se usa `/tmp/out`): `sap/ordenes.jsonl`, `control.csv`, `log.jsonl` y, por caso, `trazabilidad.json`, `aprobacion.txt` y `aprobacion.pdf`.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | `{ sessionId, creada, tokens, pendientes, historial[] }` |
| `GET` | `/api/health` | `{ ok, provider, model }` (`ok` = hay clave configurada; nunca expone la clave) |

- `sessionId`: 8 a 64 caracteres `[A-Za-z0-9_-]`; el chat lo genera y lo guarda en el navegador.
- `toolCalls[]`: `{ nombre, args, ok, resumen, resultado, nota? }` por cada herramienta ejecutada en el turno.
- `needsConfirmation`: `true` cuando un caso quedó con confirmación humana pendiente. Para confirmar se envía un mensaje como «confirmo»; para cancelar, «cancelar».
- Errores: `{ error: "No pude procesar la solicitud, intenta de nuevo" }`; el detalle técnico queda solo en los logs del servidor.

Ejemplo:

```bash
curl -s -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"sessionId":"prueba-0001","message":"Procesa la solicitud sol-004"}'
```

## Variables de entorno

| Variable | Obligatoria | Por defecto |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sí (solo para el chat) | — |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-5-5` |
| `MAX_ITERACIONES` | No | `25` |
| `MAX_TOKENS_SESION` | No | `300000` |
| `LLM_TIMEOUT_MS` | No | `60000` |
| `OUT_DIR` | No | `./out` (en Vercel `/tmp/out`) |

## Despliegue en Vercel

1. En [vercel.com](https://vercel.com) → **Add New… → Project** → importa este repositorio de GitHub. Nombre del proyecto: `agente-oc-periferia`.
2. Framework: **Next.js** (se detecta solo). Vercel detecta `bun.lock` y usa Bun para instalar.
3. En **Settings → Environment Variables** agrega `ANTHROPIC_API_KEY` (y, si quieres, las variables opcionales de la tabla anterior).
4. **Deploy**. Cada push a `main` publica una nueva versión automáticamente.

> En Vercel el disco es de solo lectura: las salidas van a `/tmp/out` y se pierden cuando la función se recicla. Es suficiente para la demo; en producción se reemplaza por un adaptador SAP real.
