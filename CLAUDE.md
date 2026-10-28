# CLAUDE.md – Reto 3 Periferia IT Group: agente de órdenes de compra

## Contexto
Prueba técnica de IA para Periferia IT Group. Hay **2 horas** para completarla una vez se entreguen el PRD y los fixtures. Prioriza velocidad, claridad y que todo funcione.

**Objetivo:** agente conversacional en TypeScript (Bun) que lee solicitudes de compra, valida controles contra los maestros corporativos y crea órdenes de compra (OC) en un SAP simulado, siempre con confirmación humana antes de crear la OC.

## Entregables obligatorios
1. `agent/prompt.md` (system prompt), `src/tools/oc.ts` (herramientas tipadas con zod), backend y frontend de chat que muestre las llamadas a herramientas y las solicitudes de confirmación humana.
2. `demo.ts`: procesa los 6 casos (`fixtures/reto-03/solicitudes/sol-001` a `sol-006`) llamando a las herramientas directamente, **sin modelo de IA**, con resultado determinístico.
3. URL pública en Vercel (proyecto `agente-oc-periferia`).
4. `SOLUCION.md`: arquitectura, ciclo del agente, matriz de controles, diseño de un adaptador SAP real para producción y análisis crítico de las órdenes retroactivas. Incluir análisis de costos del modelo.

## Reglas de diseño (no negociables)
- Todas las validaciones viven en código, como funciones puras y determinísticas. El modelo solo orquesta y explica; nunca decide si un control pasa.
- `crear_orden` exige confirmación humana y es idempotente: una solicitud genera como máximo una OC.
- Cada control evaluado y cada decisión quedan en un log de auditoría (quién, qué, cuándo, resultado).
- No inventar datos: todo dato se traza a un archivo de `fixtures/`. Si falta, se rechaza.
- La API key se lee de la variable de entorno `ANTHROPIC_API_KEY`. Nunca en el código ni en el repositorio.

## Stack
Next.js (App Router) + Bun + TypeScript estricto + Vercel AI SDK (proveedor Anthropic) + zod. Despliegue en Vercel desde la rama `main`.

## Forma de trabajo
- El usuario (Sebastián) es líder técnico y de producto, **no desarrollador**. Explica todo en español y en términos simples.
- Trabaja por fases y espera aprobación cuando se pida análisis o plan.
- Al terminar cada fase, haz **push a `main`** (Vercel publica solo desde `main`).
- No agregues funcionalidades que no se pidieron.

## Reglas de control (PRD 7.3 — el PRD manda sobre este archivo)
| # | Regla | Tipo |
|---|---|---|
| RC1 | Proveedor existe en `proveedores.json` (por NIT; sin NIT, por nombre normalizado) y está `activo`. | Bloqueo |
| RC2 | Aprobación existe, contiene "Aprobado" y viene de un aprobador listado del `centro_costo`. | Bloqueo |
| RC3 | `valor_total` ≤ `tope` del aprobador para ese centro. | Bloqueo |
| RC4 | `subarea` pertenece al `centro_costo`. | Bloqueo |
| RC5 | Diferencia cotización vs solicitud ≤ 2 % (si excede o no hay cotización: confirmar). | Confirmación |
| RC6 | Sin `indicador_iva` → se deriva del proveedor y se confirma. | Confirmación + derivado |
| RC7 | Sin `condiciones_pago` → se deriva del proveedor; solo se informa. | Derivado |
| RC8 | Factura con fecha < `fecha_solicitud` → `retroactiva = true`; confirmar y registrar en control. | Confirmación |
| RC9 | Fecha de aprobación (día) ≥ `fecha_solicitud`; si no, confirmar. | Confirmación |
| RC10 | `cantidad × valor_unitario` = `valor_total` (± 1). | Bloqueo |

`oc_crear` solo crea si `apta = true` y (confirmaciones vacías o `confirmado = true`). Idempotente por `solicitud_id`.

## Datos (PRD 7.1, 7.2, 7.4)
- **Fixtures por caso** (`fixtures/reto-03/solicitudes/<caso>/`): `correo.json`, `solicitud.json`, `cotizacion.txt`, `aprobacion.json`, `factura.txt` (solo retroactivo).
- **Maestros**: proveedores (`codigo_sap, nit, nombre, condiciones_pago_default, indicador_iva_default, activo`), centros de costo (`centro_costo, subareas[], aprobadores[{email, tope}]`), indicadores de IVA, condiciones de pago.
- **Paquete normalizado**: `{ correo, solicitud, cotizacion|null, aprobacion|null, factura|null }`.
- **Salidas** (`OUT_DIR`, por defecto `./out`; en Vercel `/tmp/out`): `sap/ordenes.jsonl`, `control.csv`, `log.jsonl`, `<caso>/trazabilidad.json`, `<caso>/aprobacion.txt|pdf`.

## Dónde vive cada cosa
- Comportamiento: `agent/prompt.md` · Conocimiento: `src/knowledge/ordenes-compra.md` · Ejecución: `src/tools/oc.ts`.
- Reglas de negocio puras: `src/domain/` · Disco: `src/infra/archivos.ts` · SAP: `src/sap/adapter.ts` (interfaz) y `src/sap/mock.ts`.
