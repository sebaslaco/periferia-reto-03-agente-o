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

## Hipótesis de trabajo (validar contra el PRD; el PRD siempre manda)

### Controles y su salida
| # | Control | Si falla |
|---|---|---|
| 1 | Documentos completos | Rechazar |
| 2 | Solicitud sin OC previa (duplicado) | Rechazar |
| 3 | Proveedor existe y está activo | Rechazar |
| 4 | NIT de la cotización coincide con el maestro | Rechazar |
| 5 | Centro de costo y subárea válidos | Rechazar |
| 6 | Monto de la solicitud = cotización | Rechazar |
| 7 | IVA y plazo de pago válidos | Rechazar |
| 8 | Aprobación del líder del centro | Rechazar |
| 9 | Monto dentro del tope del líder | Escalar (aprobador superior) |
| 10 | Sin factura previa a la OC | Escalar (compra retroactiva) |

Criterio: lo objetivo y corregible por el solicitante se **rechaza**; lo válido que requiere más autoridad o regularización se **escala**. Si todo pasa: resumen → confirmación humana → crear OC.

### Modelo de datos
- **Maestros:** Proveedor (nit, nombre, estado, condicion_pago), CentroCosto (codigo, subarea, lider, tope_aprobacion), IndicadorIva (codigo, tasa), CondicionPago (codigo, dias).
- **Caso:** Correo, Solicitud (id, proveedor, centro_costo, monto, fecha), Item, Cotizacion, Aprobacion, Factura (opcional).
- **Resultados:** OrdenCompra (numero, solicitud_id, estado, fecha_creacion), EventoAuditoria.
- Relaciones clave: Solicitud → OrdenCompra (0..1); Solicitud → Factura (0..1); Solicitud → EventoAuditoria (0..n).

Ajusta nombres y campos a los JSON reales de `fixtures/reto-03/` cuando estén disponibles.
