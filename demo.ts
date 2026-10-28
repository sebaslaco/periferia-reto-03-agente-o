/**
 * Demo sin modelo de IA (PRD 6.6): procesa sol-001 a sol-006 llamando directamente a las herramientas.
 * Ejecutar con:  bun run demo.ts   (no necesita clave de ningún proveedor)
 *
 * - Limpia la carpeta de salida al inicio (determinismo).
 * - sol-001 se ejecuta dos veces para mostrar la idempotencia.
 * - sol-004, sol-005 y sol-006 se muestran primero como pendientes y luego se crean con confirmado=true.
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { OrdenCompra, Paquete, Validacion } from "./src/domain/tipos";
import { verificarModulo } from "./scripts/modulo";
import { directorioSalida } from "./src/infra/archivos";
import { construir_payload, crear, generar_evidencia, leer_paquete, validar, type ContextoHerramienta } from "./src/tools/oc";

type Respuesta<T> = { ok: true; data: T } | { ok: false; error: string };
const leer = <T>(json: string) => JSON.parse(json) as Respuesta<T>;

interface Creacion {
  numero_oc: string;
  fecha: string | null;
  idempotente: boolean;
  retroactiva: boolean;
}

const ctx: ContextoHerramienta = { directory: import.meta.dir, sessionId: "demo" };

async function procesar(caso: string, confirmado?: boolean): Promise<Respuesta<Creacion>> {
  const titulo = confirmado ? `${caso} (confirmado por el usuario)` : caso;
  console.log(`\n━━ ${titulo} ${"━".repeat(Math.max(0, 60 - titulo.length))}`);

  const paquete = leer<Paquete>(await leer_paquete.execute({ caso }, ctx));
  if (!paquete.ok) return fin({ ok: false, error: paquete.error });

  const v = leer<Validacion>(await validar.execute({ caso, paquete: paquete.data }, ctx));
  if (!v.ok) return fin({ ok: false, error: v.error });
  const { apta, bloqueos, confirmaciones, derivados, retroactiva } = v.data;
  console.log(`  apta:           ${apta}`);
  console.log(`  bloqueos:       ${bloqueos.length ? "" : "—"}`);
  for (const b of bloqueos) console.log(`    · ${b.regla}: ${b.mensaje}`);
  console.log(`  confirmaciones: ${confirmaciones.length ? "" : "—"}`);
  for (const c of confirmaciones) console.log(`    · ${c.regla}: ${c.mensaje}`);
  const listaDerivados = Object.entries(derivados).map(([k, val]) => `${k}=${val}`);
  console.log(`  derivados:      ${listaDerivados.join(", ") || "—"}`);
  console.log(`  retroactiva:    ${retroactiva}`);

  let payload: OrdenCompra | null = null;
  if (apta) {
    const p = leer<{ payload: OrdenCompra; trazabilidad: string }>(await construir_payload.execute({ caso, paquete: paquete.data, derivados }, ctx));
    if (!p.ok) return fin({ ok: false, error: p.error });
    payload = p.data.payload;
    const pos = payload.posiciones[0]!;
    console.log(`  payload:        ${payload.proveedor.nombre} (${payload.proveedor.codigo_sap}) · ${pos.cantidad} ${pos.unidad} × ${pos.precio_unitario} · IVA ${pos.indicador_iva} · ${payload.condiciones_pago}`);
    const e = leer<{ ruta: string; sha256: string }>(await generar_evidencia.execute({ caso }, ctx));
    if (e.ok) console.log(`  evidencia:      ${e.data.ruta} (sha256 ${e.data.sha256.slice(0, 12)}…)`);
  }

  return fin(leer<Creacion>(await crear.execute({ caso, payload, confirmado }, ctx)));
}

function fin(r: Respuesta<Creacion>): Respuesta<Creacion> {
  if (r.ok) console.log(`  ➜ OC ${r.data.numero_oc}${r.data.idempotente ? " (idempotente=true: ya existía, no se creó otra)" : " creada"}`);
  else console.log(`  ➜ Sin OC: ${r.error}`);
  return r;
}

await rm(directorioSalida(ctx), { recursive: true, force: true });

const r = {
  sol001: await procesar("sol-001"),
  sol001bis: await procesar("sol-001"),
  sol002: await procesar("sol-002"),
  sol003: await procesar("sol-003"),
  sol004pend: await procesar("sol-004"),
  sol005pend: await procesar("sol-005"),
  sol006pend: await procesar("sol-006"),
  sol004: await procesar("sol-004", true),
  sol005: await procesar("sol-005", true),
  sol006: await procesar("sol-006", true),
};

const control = await readFile(path.join(directorioSalida(ctx), "control.csv"), "utf8");
console.log("\n━━ out/control.csv ━━");
console.log(control.replace(/,\d{4}-\d{2}-\d{2}T[^,\n]+/g, ",<fecha>").trimEnd());

// Auditoría: toda OC creada con excepciones debe tener confirmado_por y confirmado_en en cada una.
const leerJsonl = async (relativa: string) =>
  (await readFile(path.join(directorioSalida(ctx), relativa), "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
const ordenes = (await leerJsonl("sap/ordenes.jsonl")) as unknown as { numero_oc: string; orden: OrdenCompra }[];
const excepciones = ordenes.flatMap((o) => o.orden.excepciones.map((x) => ({ numero_oc: o.numero_oc, ...x })));
console.log("\n━━ Excepciones confirmadas en out/sap/ordenes.jsonl ━━");
for (const x of excepciones) console.log(`  OC ${x.numero_oc} · ${x.codigo} · confirmado_por="${x.confirmado_por}" · confirmado_en=${x.confirmado_en ? "<fecha>" : "null"}`);
const auditoriaOk = excepciones.length === 3 && excepciones.every((x) => x.confirmado_por === "analista (sesión demo)" && Boolean(x.confirmado_en));
const logCrear = (await leerJsonl("log.jsonl")).filter((l) => l.herramienta === "oc_crear" && l.ok === true);
const logOk = JSON.stringify(logCrear).split("analista (sesión demo)").length - 1 >= 3;
const controlOk = control.split("\n").filter((l) => l.includes(",creada,") && l.includes("analista (sesión demo)")).length === 3;
const modulo = await verificarModulo(import.meta.dir);

const oc = (x: Respuesta<Creacion>) => (x.ok ? x.data.numero_oc : null);
const retroSol005 = control.split("\n").some((l) => l.startsWith("SOL-2026-005,creada,4500000003,true"));
const verificaciones: [string, boolean][] = [
  ["sol-001 → OC 4500000001", oc(r.sol001) === "4500000001"],
  ["sol-001 repetida → 4500000001 idempotente", oc(r.sol001bis) === "4500000001" && r.sol001bis.ok && r.sol001bis.data.idempotente],
  ["sol-002 bloqueada (RC1)", !r.sol002.ok],
  ["sol-003 bloqueada (RC2, RC3)", !r.sol003.ok],
  ["sol-004/005/006 pendientes sin confirmación", !r.sol004pend.ok && !r.sol005pend.ok && !r.sol006pend.ok],
  ["sol-004 confirmada → OC 4500000002", oc(r.sol004) === "4500000002"],
  ["sol-005 confirmada → OC 4500000003, retroactiva en control.csv", oc(r.sol005) === "4500000003" && retroSol005],
  ["sol-006 confirmada → OC 4500000004", oc(r.sol006) === "4500000004"],
  ["Excepciones con confirmado_por y fecha en ordenes.jsonl (sin null)", auditoriaOk],
  ["Confirmación registrada en control.csv y log.jsonl", controlOk && logOk],
  ["modulo/ coincide con agent/prompt.md y src/knowledge/", modulo.length === 0],
];
console.log("\n━━ Verificación ━━");
for (const [nombre, ok] of verificaciones) console.log(`  ${ok ? "✅" : "❌"} ${nombre}`);
const todoOk = verificaciones.every(([, ok]) => ok);
console.log(todoOk ? "\nResultado: todo coincide con lo esperado." : "\nResultado: hay diferencias con lo esperado.");
process.exit(todoOk ? 0 : 1);
