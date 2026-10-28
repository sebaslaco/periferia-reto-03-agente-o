# SOLUCIÓN – Agente de órdenes de compra (Reto 3)

**Link de prueba:** https://agente-oc-periferia.vercel.app · **Demo sin modelo:** `bun install && bun run demo.ts`

---

## 1. Problema en una frase

La analista administrativa digita a mano en SAP cada orden de compra a partir de un correo con solicitud, cotización y aprobación, sin una validación sistemática de proveedor, autoridad del aprobador ni montos; le duele a ella (tiempo y errores), a contabilidad (correcciones en el cierre) y a la dirección, que no sabe cuántas OC se crean después de la factura.

---

## 2. Arquitectura

```mermaid
flowchart LR
  subgraph Front["Front · app/page.tsx"]
    UI["Chat: historial, tarjetas de herramientas,<br/>markdown, Confirmar / Cancelar"]
  end

  subgraph Backend["Backend · Next.js en Vercel"]
    API["app/api/chat · sessions/:id · health"]
    LOOP["Ciclo del agente<br/>src/agent/loop.ts"]
    SES["Sesiones<br/>src/agent/sesiones.ts"]
    LLM["Adaptador LLM<br/>src/llm/adapter.ts → anthropic.ts"]
    PROMPT["Comportamiento<br/>agent/prompt.md"]
    KNOW["Conocimiento<br/>src/knowledge/ordenes-compra.md"]
  end

  subgraph Ejecucion["Ejecución · src/tools/oc.ts"]
    TOOLS["oc_leer_paquete · oc_validar ·<br/>oc_construir_payload · oc_generar_evidencia · oc_crear"]
    DOM["Reglas puras<br/>src/domain/ (RC1–RC10, parseo, payload, evidencia)"]
    SAP["SapAdapter<br/>src/sap/adapter.ts → mock.ts"]
  end

  FIX[("fixtures/reto-03<br/>(solo lectura)")]
  OUT[("out/ · en Vercel /tmp/out<br/>sap/ordenes.jsonl · control.csv · log.jsonl<br/>&lt;caso&gt;/trazabilidad.json · aprobacion.txt|pdf")]
  CLAUDE(["API de Anthropic"])

  UI -- "POST { sessionId, message }" --> API
  API --> LOOP
  LOOP <--> SES
  PROMPT --> LOOP
  KNOW --> LOOP
  LOOP <--> LLM
  LLM <--> CLAUDE
  LOOP -- "valida args con zod" --> TOOLS
  TOOLS --> DOM
  TOOLS --> SAP
  TOOLS -- lee --> FIX
  TOOLS -- escribe --> OUT
  SAP -- escribe --> OUT
  DOM -. "demo.ts las llama sin modelo" .- TOOLS
```

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| Comportamiento | `agent/prompt.md` | Rol, flujo, reglas de presentación y CA2 (no afirmar valores que no salgan de una herramienta). |
| Conocimiento | `src/knowledge/ordenes-compra.md` | Proceso, maestros, reglas y qué hacer en cada excepción. Se concatena al prompt. |
| Ejecución | `src/tools/oc.ts` | Las 5 herramientas con el contrato 6.2 (`description`, `args` zod, `execute` → string JSON, nunca lanza). |
| Reglas de negocio | `src/domain/` | Funciones puras y determinísticas: parseo, RC1–RC10, payload 7.4, evidencia. |
| SAP | `src/sap/adapter.ts`, `src/sap/mock.ts` | Interfaz exacta de 7.4 y simulación sobre archivos. |

Un cambio de reglas de negocio toca `src/domain/` y, si aplica, `src/knowledge/`; no toca el servidor ni el ciclo.

---

## 3. Ciclo del agente

**Bucle** (`src/agent/loop.ts`): por cada mensaje del usuario se arma `[system, …historial, mensaje]` y se llama al proveedor con las definiciones de herramientas. Si el modelo pide herramientas, el backend valida los argumentos con zod, ejecuta, agrega los resultados al historial y vuelve a llamar al modelo. Cuando el modelo responde sin pedir herramientas, termina el turno.

| Control | Implementación |
|---|---|
| Tope de iteraciones (CA1) | `MAX_ITERACIONES` (25). Al alcanzarlo, el agente responde con lo que hizo y lo que falta ("escribe «continúa»"). |
| Tope de tokens por sesión | `MAX_TOKENS_SESION` (300 000). Se acumulan los tokens de entrada y salida que informa el proveedor; al superarlo se pide abrir una sesión nueva. |
| Timeout al proveedor | `LLM_TIMEOUT_MS` (60 s) por llamada. Mensaje claro: "El modelo tardó demasiado en responder…". |
| Errores (CA5) | Errores del proveedor o internos → mensaje claro sin detalles técnicos; el detalle va a los logs del servidor. El turno incompleto se descarta para que la sesión siga sana. |
| Registro (CA4) | Cada llamada a herramienta aparece como tarjeta en el chat (`toolCalls[]`) y como línea en `out/log.jsonl`, junto con las decisiones humanas y las confirmaciones forzadas. |

**Confirmación humana aplicada en código (CA3)**, no solo en el prompt:

1. Si `oc_validar` devuelve `apta = true` con confirmaciones, la sesión guarda ese caso como **pendiente de confirmación** (con las reglas RC involucradas).
2. El turno termina con una pregunta explícita. Si el modelo no la escribió, el sistema la agrega (solo si la respuesta no termina ya en pregunta). La API devuelve `needsConfirmation = true` y el chat resalta el mensaje con los botones **Confirmar** / **Cancelar**.
3. `oc_crear` solo recibe `confirmado = true` si **el mensaje actual del usuario** es una confirmación ("confirmo", "sí, créala"…) **y** ese caso tiene una confirmación pendiente. Si el modelo envía `confirmado = true` sin eso, el backend lo **fuerza a `false`**, la herramienta responde que falta la confirmación, la tarjeta muestra el aviso y queda registro en `log.jsonl`.
4. "Cancelar" o "no" descartan las confirmaciones pendientes.

Además, `oc_crear` vuelve a validar todo desde los fixtures antes de crear: si el modelo intenta crear una OC de una solicitud con bloqueos, la herramienta la rechaza y el intento queda en `out/control.csv` como **"bloqueada"** (HU-5). Lo mismo con "pendiente" (falta confirmación) e "idempotente" (ya existía).

---

## 4. Elección del modelo

| | |
|---|---|
| Proveedor | Anthropic (API Messages vía HTTP, detrás de la interfaz propia `ProveedorLLM`). |
| Modelo | `claude-sonnet-5-5` por defecto, configurable con `ANTHROPIC_MODEL`. |
| Por qué | Buen uso de herramientas con esquemas JSON grandes (el paquete y el payload viajan entre herramientas), buen español y menor costo y latencia que un modelo de gama más alta. El modelo solo orquesta y explica: las decisiones las toma el código, así que no hace falta el modelo más caro. |

**Costo estimado por caso** (medido con un modelo simulado que recorre el flujo completo de `sol-004` en dos turnos: procesar + "confirmo"; 6 llamadas al modelo):

| Concepto | Valor |
|---|---|
| System prompt (prompt + conocimiento) | ~6 800 caracteres (~2 000 tokens) por llamada |
| Definiciones de herramientas | ~9 700 caracteres (~2 800 tokens) por llamada |
| Entrada total del caso (el historial se reenvía en cada llamada) | ~131 000 caracteres ≈ **37 000 tokens** |
| Salida total del caso (argumentos de herramientas + respuestas) | ≈ **2 000–3 000 tokens** |

Con el precio de referencia de la gama Sonnet, USD 3 por millón de tokens de entrada y USD 15 por millón de salida **[REVISAR SEBAS: confirmar el precio publicado de `claude-sonnet-5-5`]**:

- Entrada: 37 000 × 3 / 1 000 000 ≈ USD 0,11
- Salida: 3 000 × 15 / 1 000 000 ≈ USD 0,05
- **≈ USD 0,15 por caso con confirmación** (un caso sin confirmación, un solo turno, ≈ USD 0,08–0,10).

Cómo bajarlo: *prompt caching* del system prompt y de las herramientas (se repiten en cada llamada), devolver al modelo un resumen del paquete en lugar del texto completo de la cotización, y un modelo más pequeño para casos sin excepciones.

---

## 5. Matriz de controles

| Regla | Qué verifica | Tipo | Dónde se implementa | Caso que la ejercita |
|---|---|---|---|---|
| RC1 | Proveedor existe (por NIT de la solicitud; sin NIT, por nombre normalizado) y está activo | Bloqueo | `src/domain/reglas.ts` · `rc1`, `buscarProveedor` | sol-002 (NIT 901999000 inexistente); sol-006 lo encuentra por nombre |
| RC2 | Aprobación existe, dice "Aprobado" y el remitente es aprobador del centro | Bloqueo | `reglas.ts` · `rc2`; `parseo.ts` · `normalizarAprobacion` | sol-003 (fvargas no es aprobador de CC-2020) |
| RC3 | `valor_total` ≤ tope del aprobador del centro | Bloqueo | `reglas.ts` · `rc3` | sol-003 (74.000.000 > 30.000.000) |
| RC4 | Subárea pertenece al centro de costo | Bloqueo | `reglas.ts` · `rc4` | Ningún caso de los fixtures la incumple |
| RC5 | Cotización vs. solicitud ≤ 2 % (sin cotización también confirma) | Confirmación | `reglas.ts` · `rc5`; `parseo.ts` · `parsearCotizacion` | sol-004 (26.500.000 vs 25.000.000 = 6 %) |
| RC6 | Sin indicador de IVA → se deriva del proveedor y se confirma | Confirmación + derivado | `reglas.ts` · `rc6` | sol-006 (C1) |
| RC7 | Sin condiciones de pago → se derivan del proveedor (solo informa) | Derivado | `reglas.ts` · `rc7` | sol-006 (Z030) |
| RC8 | Factura con fecha anterior a la solicitud → `retroactiva = true` | Confirmación | `reglas.ts` · `rc8`; `parseo.ts` · `parsearFactura` | sol-005 (factura 2026-08-10 < solicitud 2026-08-27) |
| RC9 | Fecha de aprobación (día) ≥ fecha de solicitud | Confirmación | `reglas.ts` · `rc9` | sol-004 queda justo en el límite (aprobada el mismo día, 18:45) y pasa |
| RC10 | `cantidad × valor_unitario` = `valor_total` (± 1) | Bloqueo | `reglas.ts` · `rc10` | Ningún caso de los fixtures la incumple |

Todas son funciones puras (`validar(paquete, maestros)`), sin acceso a disco ni al modelo. `demo.ts` verifica el resultado esperado de los seis casos.

**La más difícil: RC3.** El PRD dice "tope del aprobador para ese centro", pero en sol-003 el firmante (fvargas) no es aprobador de CC-2020, así que no tiene un tope en ese centro. Había que decidir si RC3 se omite (porque RC2 ya bloquea) o se evalúa igual. Elegimos evaluarla contra el **mayor tope de los aprobadores del centro** (30.000.000): así la analista recibe las dos razones y una acción sugerida útil (ningún aprobador de CC-2020 alcanza 74 millones, hay que escalar). La interacción RC2/RC3 es la regla que más interpretación exigió; la dejamos documentada en los supuestos.

---

## 6. Diseño del adaptador SAP real (PRD 7.5)

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV`** (API estándar liberada de S/4HANA para crear órdenes de compra), expuesta mediante un *Communication Arrangement* (escenario de compras `SAP_COM_0053`) y, si SAP está on-premise, a través de SAP BTP con Cloud Connector.

| Opción | A favor | En contra | Decisión |
|---|---|---|---|
| OData `API_PURCHASEORDER_PROCESS_SRV` | REST/JSON, estándar, soportado y documentado; deep insert de cabecera + posiciones en una sola llamada (atómico); fácil de consumir desde TypeScript | Requiere S/4HANA (o gateway) y configurar el escenario de comunicación | **Principal** |
| RFC/BAPI `BAPI_PO_CREATE1` | Funciona en ECC; muy probado | Requiere conector RFC (librerías SAP nativas), sesión y `BAPI_TRANSACTION_COMMIT`; difícil en serverless | Alternativa si es ECC, vía Integration Suite |
| SAP Integration Suite | Desacopla, monitoreo, reintentos, transforma a OData o BAPI | Costo de licencia y otra pieza que operar | Recomendable si la empresa ya la tiene |
| Carga por archivo | No requiere conexión en línea | No es en tiempo real; error tardío | **Plan B** |

Dado que la viabilidad no está confirmada, el agente ya depende solo de la interfaz `SapAdapter` (`consultarProveedor`, `crearOrden`, `buscarOrdenPorReferencia`): cambiar de `mock.ts` a `odata.ts`, `bapi.ts` o `archivo.ts` no toca herramientas, reglas ni ciclo.

**Mapeo del payload (7.4 → OData `A_PurchaseOrder`)**

| Payload | OData | BAPI (alternativa) |
|---|---|---|
| `sociedad` | `CompanyCode` | `POHEADER-COMP_CODE` |
| `organizacion_compras` | `PurchasingOrganization` (+ `PurchasingGroup` por configuración) | `POHEADER-PURCH_ORG` |
| — | `PurchaseOrderType = "NB"` | `POHEADER-DOC_TYPE` |
| `proveedor.codigo_sap` | `Supplier` | `POHEADER-VENDOR` |
| `moneda` | `DocumentCurrency` | `POHEADER-CURRENCY` |
| `condiciones_pago` | `PaymentTerms` | `POHEADER-PMNTTRMS` |
| `referencia.solicitud_id` | `CorrespncExternalReference` (clave de idempotencia) | `POHEADER-REF_1` |
| `referencia.cotizacion_ref` | `CorrespncInternalReference` / texto de cabecera | `POHEADER-QUOT_DATE` / textos |
| `posiciones[].numero` | `to_PurchaseOrderItem.PurchaseOrderItem` (10, 20…) | `POITEM-PO_ITEM` |
| `posiciones[].descripcion` | `PurchaseOrderItemText` (40 caracteres) | `POITEM-SHORT_TEXT` |
| `posiciones[].cantidad`, `unidad` | `OrderQuantity`, `PurchaseOrderQuantityUnit` | `POITEM-QUANTITY`, `PO_UNIT` |
| `posiciones[].precio_unitario` | `NetPriceAmount` (ver nota de IVA) | `POITEM-NET_PRICE` |
| `posiciones[].indicador_iva` | `TaxCode` | `POITEM-TAX_CODE` |
| `posiciones[].centro_costo` | `AccountAssignmentCategory = "K"` + `to_AccountAssignment.CostCenter` | `POACCOUNT-COSTCENTER` |
| `posiciones[].subarea` | Según configuración: elemento de imputación adicional, centro de beneficio o campo de extensión | `POACCOUNT-*` / extensión |
| `aprobador.*` y evidencia | Adjunto PDF con `API_CV_ATTACHMENT_SRV` (GOS) + nota de cabecera con email, fecha y sha256 | GOS / `BDS` |

Nota de IVA: las cotizaciones de los fixtures traen precios "IVA incluido". SAP espera precio neto; el adaptador real debe enviar `precio / (1 + tasa del indicador)` o la empresa debe confirmar cómo registra estas compras.

**Autenticación y credenciales.** OAuth 2.0 *client credentials* (BTP Destination) o usuario técnico de comunicación con permisos mínimos (solo crear y leer OC y adjuntos). Las credenciales viven en el gestor de secretos del backend (variables de entorno cifradas de Vercel o Azure Key Vault) y las lee solo el adaptador SAP. Nunca están en el prompt, en el conocimiento ni al alcance del modelo, y nunca se registran en logs.

**Idempotencia y error parcial.**
1. Antes de crear: `buscarOrdenPorReferencia(solicitud_id)` con `GET A_PurchaseOrder?$filter=CorrespncExternalReference eq 'SOL-…'`. Si existe, se devuelve ese número (igual que el mock).
2. Se registra la intención ("enviando") en una tabla de salida antes del `POST`. Si hay timeout o error de red, **no se reintenta a ciegas**: primero se vuelve a consultar por referencia.
3. La creación de cabecera y posiciones es un deep insert atómico: o se crea toda la OC o nada. Con BAPI se revisa la tabla `RETURN` (tipos E/A → `BAPI_TRANSACTION_ROLLBACK`; si no, `COMMIT`).
4. El adjunto de evidencia es una segunda llamada. Si la OC se creó pero el adjunto falló, la OC queda "creada sin evidencia" y el adjunto se reintenta en segundo plano; nunca se vuelve a crear la OC.
5. Los errores de negocio de SAP (proveedor bloqueado, centro cerrado) se devuelven como `{ ok: false, error }` legible, igual que hoy.

**Plan B si la conexión no es viable.** El agente sigue haciendo el 90 % del trabajo: lee, valida, arma el payload y la evidencia. En vez de crear, genera (a) un resumen "listo para pegar" en el orden de campos de la transacción ME21N y (b) un archivo de carga masiva (CSV/Excel compatible con la plantilla de migración o LSMW) con todas las OC aprobadas del día. La analista las carga en SAP y registra el número de OC; el control de retroactivas y bloqueos se mantiene igual.

---

## 7. Lectura del proceso

**Qué está pasando.** El caso sol-005 muestra el patrón: la cotización es del 5 de agosto,
la factura llegó el 10, la solicitud se radicó el 27 y la aprobación el 28. El propio
aprobador escribe "Ya llegó la factura, por favor crear la OC para poder radicarla". La OC
dejó de ser un control previo al gasto y se convirtió en un trámite para poder pagar. El
gasto se comprometió sin validar presupuesto, autoridad ni alternativas de proveedor.

**Por qué ocurre.** La causa principal es la urgencia operativa: el área necesita el bien o
servicio antes de lo que tarda el proceso formal. Se suma que el proceso es el mismo para
todo: el tóner del trimestre sigue el mismo trámite que una licencia de 200 millones. Esto
empuja a comprar directo a proveedores conocidos y regularizar después.

**Qué le diría a la dirección.** Prohibir la compra retroactiva sin ofrecer una alternativa
solo esconde el problema. Propongo segmentar el proceso:
1. Carril ágil con tolerancia por área y categoría. Compras de bajo monto, recurrentes o de
   urgencia justificada pueden comprometerse con topes definidos por área y por tipo de
   insumo, producto o servicio. Se apoyan en acuerdos marco con proveedores homologados y
   se regularizan en un plazo fijo.
2. Carril competitivo para compras de mayor valor. Procesos de abastecimiento con varios
   proveedores (RFI, RFP y evaluación comparativa), con cotización y aprobación obligatorias
   antes de comprometer el gasto.
3. El agente mide; la dirección decide. Hoy el agente marca retroactiva = true y exige
   confirmación. Si la dirección decide rechazarlas, basta con cambiar la regla RC8 de
   confirmación a bloqueo, sin tocar el servidor.

**Indicadores para la dirección** (todos salen de out/control.csv):
| Indicador | Para qué |
|---|---|
| % de OC retroactivas por área, proveedor y categoría | Dimensionar el desvío y dónde se concentra (en la muestra: 1 de 6 casos) |
| Lead time cotización → OC y solicitud → OC | Medir si el proceso formal es lo que empuja a saltarlo |
| Tasa de paso directo vs. confirmaciones vs. bloqueos, por regla RC | Ver qué controles frenan más y si el flujo normal ya no requiere digitación |
| Análisis de causa raíz (FCA) mensual de bloqueos y retroactivas | Atacar las causas más frecuentes, no los casos uno a uno |
| Salud de los maestros: proveedores duplicados, NIT inválidos, aprobadores y topes desactualizados | Separar los bloqueos por mala calidad del dato maestro de los bloqueos por una solicitud mal hecha |

---

## 8. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Ciclo del agente propio** con interfaz `ProveedorLLM` (`enviar(mensajes, herramientas)`) | Vercel AI SDK (`streamText` + aprobación por botones) | El PRD exige un adaptador propio y un ciclo con tope de iteraciones, sesiones y confirmación por mensaje (6.1–6.3). Con el SDK, el control quedaba repartido entre librería y front. El ciclo propio es un archivo corto y legible y cambiar de proveedor es escribir otra clase. Costo: perdimos el streaming y los tipos del SDK. |
| 2 | **Confirmación aplicada en código** (pendientes por caso + `confirmado` forzado a `false`) | Confiar en que el prompt le pida al modelo esperar la confirmación | Un prompt se puede saltar (alucinación o *prompt injection* dentro de un correo). En código, ni el modelo ni un texto malicioso pueden crear una OC con excepciones sin un mensaje humano de confirmación. Costo: la detección de "confirmo" es por palabras clave (ver supuestos). |
| 3 | **Parseo determinístico** de cotización y factura con expresiones regulares | Pedirle al modelo que extraiga NIT, total y fechas | Los montos y NIT deciden los controles; deben ser reproducibles y auditables (`demo.ts` corre sin modelo). Costo: si cambia el formato del texto, hay que ajustar el parser; en producción, OCR + plantillas por proveedor. |
| 4 | **Archivos en `out/`** (`/tmp/out` en Vercel) y sesiones en memoria con respaldo en archivo | Base de datos (Postgres, KV) | El PRD dice "sin base de datos" y el foco era la lógica. Costo: en Vercel los datos son efímeros y no se comparten entre instancias (la numeración puede reiniciar). En producción: base de datos o el propio SAP. |
| 5 | **Respuesta JSON sin streaming** (`{ reply, toolCalls[], needsConfirmation }`) | Streaming de eventos (SSE) | Contrato simple de documentar y probar con `curl`; el front muestra "Pensando…". Costo: en casos largos el usuario espera 10–30 s sin ver el progreso. |
| 6 | **Las herramientas recalculan desde los fixtures** y rechazan paquete, derivados o payload modificados | Confiar en los objetos que el modelo devuelve | Mitiga el riesgo del PRD "el modelo arregla un monto". Costo: algo más de lectura de disco por llamada (despreciable). |

---

## 9. Supuestos

1. **Rúbrica.** El PRD cita una rúbrica en la sección 10, pero el documento entregado no la incluye. Nos guiamos por los criterios de aceptación de las HU y la sección 6.
2. **RC3 cuando el firmante no es aprobador del centro:** se compara contra el mayor tope de los aprobadores de ese centro (sol-003 → RC2 y RC3).
3. **RC1 usa el NIT de la solicitud**; solo si falta, el nombre normalizado (minúsculas, sin tildes ni puntuación). El NIT de la cotización no se usa para buscar (sol-006 se encuentra por nombre).
4. **RC8 y RC9 comparan solo la fecha (día)**, no la hora; la fecha local de las aprobaciones ya trae zona horaria de Colombia.
5. **"Aprobado"**: el cuerpo debe contener "aprobado/aprobada" y no una negación ("no aprobado").
6. **Descripción** de la posición truncada a 40 caracteres (texto breve SAP), quitando espacios al final.
7. **Unidad inferida**: `H` si la descripción menciona horas; `UN` por defecto. `MES` no se infiere (sol-001 dice "12 meses" pero son 120 licencias).
8. **Precio unitario** = `valor_unitario` de la solicitud (IVA incluido, como en las cotizaciones). El paso a precio neto queda para el adaptador real.
9. **Palabras aceptadas como confirmación**: confirmo, confirmado, sí, procede, adelante, créala, dale, ok, de acuerdo, autorizo… siempre que el mensaje no contenga una negación (no, cancelar, espera, rechazo). Si el mensaje nombra casos (`sol-004`), solo confirma esos.
10. **`oc_crear` acepta `payload: null`** para registrar en `control.csv` el intento sobre una solicitud bloqueada (que no tiene payload).
11. **`validez_hasta`** de la cotización = fecha de la cotización + días de validez.
12. **`/tmp` efímero en Vercel**: las OC, logs y sesiones se pierden cuando la función se recicla; la numeración puede volver a 4500000001.
13. **Una posición por solicitud**: los fixtures traen un solo ítem; el esquema admite varias.

---

## 10. Cobertura

| HU | Estado | Evidencia | Qué falta para producción |
|---|---|---|---|
| HU-1 Leer el paquete | Hecho | `oc_leer_paquete`; adjuntos ausentes → `null` con `faltantes` | Leer `.xlsx`, PDF y `.eml` reales (P1 `oc_leer_excel` no hecho); ingesta desde el buzón |
| HU-2 Validar | Hecho | `oc_validar` + `src/domain/reglas.ts`; los 6 casos en `demo.ts` | Maestros en línea desde SAP; reglas parametrizables (tolerancia 2 %, política de retroactivas) |
| HU-3 Construir el payload | Hecho | Esquema zod 7.4; `out/<caso>/trazabilidad.json` | Varias posiciones, precio neto, campos de imputación reales de la empresa |
| HU-4 Evidencia | Hecho (P0 txt y P1 pdf) | `aprobacion.txt` con sha256 y `aprobacion.pdf` | Firma digital o sello de tiempo si auditoría lo exige; adjuntar a la OC en SAP |
| HU-5 Crear la OC | Hecho | `SapMock`, consecutivo desde 4500000001, idempotencia, `control.csv` con creada/idempotente/bloqueada/pendiente | Adaptador SAP real (sección 6) y almacenamiento persistente |
| HU-6 Errores | Hecho | `{ ok: false, error }` legible para caso inexistente, JSON malformado, datos inválidos, montos no numéricos; nunca lanza | Alertas y monitoreo |
| Bonus 9.4 módulo reutilizable | No hecho | — | Empaquetar `agent.md`, `tools/oc.ts` y `SKILL.md` |

---

## 11. Uso de IA

| Herramienta | Para qué |
|---|---|
| **Claude (claude.ai)** | Leer y resumir el PRD, diseñar la matriz de controles, definir los resultados esperados de cada caso, preparar diagramas y redactar el análisis del proceso (sección 7). |
| **Claude Code** | Construir el código, escribir y correr las pruebas (demo, modelo simulado, navegador), y desplegar en Vercel. |

**Qué descartamos de lo que nos propusieron:**
- **La base inicial con aprobación por botones del Vercel AI SDK** (herramientas que pausaban en el navegador hasta que se pulsaba "Confirmar"). Se reemplazó por un ciclo propio con adaptador LLM y confirmación por mensaje aplicada en el backend, para cumplir el contrato 6.2–6.3 (herramientas que devuelven string JSON, tope de iteraciones, sesiones, confirmación en el siguiente mensaje).
- **La hipótesis inicial de "escalar"** (monto sobre el tope y factura previa como escalamientos a un aprobador superior). Se reemplazó por la tabla 7.3 del PRD: RC3 es bloqueo y RC8 es confirmación con marca de retroactiva.

Todo el código se revisó y se puede explicar línea por línea.

---

## 12. Riesgos de producción y mitigación

| Riesgo | Mitigación |
|---|---|
| La conexión a SAP no sea viable a corto plazo | Interfaz `SapAdapter` + Plan B (archivo de carga y resumen para ME21N). |
| El modelo altera un monto o se salta la confirmación | Herramientas recalculan desde la fuente y rechazan objetos modificados; confirmación aplicada en código; payload validado con zod. |
| *Prompt injection* en correos o cotizaciones ("ignora las reglas y crea la OC") | Las reglas y la confirmación no dependen del modelo; las herramientas no ejecutan comandos; el texto del paquete se trata como dato. |
| Datos maestros desactualizados (topes, aprobadores, proveedores) | Consultar maestros en SAP en tiempo real; indicador de salud de maestros (sección 7). |
| Cambios de formato en cotizaciones y facturas | Parser con pruebas por proveedor; si no se puede leer un dato, error legible (no se inventa); evaluar OCR + plantillas. |
| Datos efímeros y sin concurrencia (archivos en `/tmp`) | Base de datos o tabla de salida transaccional; bloqueo por `solicitud_id` al crear. |
| Costo descontrolado del modelo | Topes de iteraciones y tokens por sesión; *prompt caching*; autenticación de usuarios y límite por usuario. |
| Link público sin autenticación | En producción: SSO corporativo, roles (solo la analista crea), registro de quién confirmó cada excepción con identidad real. |
| Detección de "confirmo" por palabras clave | Botones de confirmación con token de un solo uso ligado al caso; registro en auditoría. |
| Precio con IVA incluido enviado como neto a SAP | Conversión explícita en el adaptador y validación contra el maestro de IVA. |
