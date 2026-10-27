/**
 * Demo sin modelo de IA: llama a las herramientas directamente.
 * Ejecutar con:  bun run demo.ts
 *
 * El reloj es fijo, así que la salida es siempre la misma (determinística).
 * Cuando lleguen los fixtures del Reto 3, aquí se procesarán los casos sol-001 a sol-006.
 */
import { SapSimulado } from "./src/sap/sap-simulado";
import { crearRegistroDemo, ping, registrarDecisionHumana, type ContextoHerramientas } from "./src/tools/oc";

const sap = new SapSimulado({ reloj: () => new Date("2026-01-01T08:00:00-05:00") });
const agente: ContextoHerramientas = { sap, actor: "demo" };
const usuario: ContextoHerramientas = { sap, actor: "usuario-demo" };

function paso(titulo: string, valor: unknown) {
  console.log(`\n▶ ${titulo}`);
  console.log(JSON.stringify(valor, null, 2));
}

paso("ping", ping({ mensaje: "hola" }, agente));

// Confirmación humana simulada: aprobado → se ejecuta la herramienta.
registrarDecisionHumana(usuario, { herramienta: "crear_registro_demo", aprobado: true, solicitudId: "DEMO-001" });
paso("crear_registro_demo DEMO-001 (confirmado)", crearRegistroDemo({ solicitud_id: "DEMO-001", descripcion: "Registro de prueba" }, agente));

// Mismo id otra vez: el SAP simulado no crea un duplicado.
registrarDecisionHumana(usuario, { herramienta: "crear_registro_demo", aprobado: true, solicitudId: "DEMO-001" });
paso("crear_registro_demo DEMO-001 (repetido)", crearRegistroDemo({ solicitud_id: "DEMO-001", descripcion: "Registro de prueba" }, agente));

// Confirmación humana simulada: cancelado → la herramienta NO se ejecuta.
registrarDecisionHumana(usuario, { herramienta: "crear_registro_demo", aprobado: false, solicitudId: "DEMO-002", motivo: "Cancelado por el usuario" });

console.log("\n▶ Órdenes en el SAP simulado");
console.table(sap.listarOrdenes().map(({ numero, solicitudId, estado, fechaCreacion }) => ({ numero, solicitudId, estado, fechaCreacion })));

console.log("\n▶ Log de auditoría");
console.table(sap.auditoria().map(({ id, fecha, actor, accion, solicitudId, resultado }) => ({ id, fecha, actor, accion, solicitudId: solicitudId ?? "", resultado })));

const ok = sap.listarOrdenes().length === 1 && sap.obtenerOrdenPorSolicitud("DEMO-002") === undefined;
console.log(ok ? "\n✅ Demo correcta: 1 OC creada, duplicado bloqueado, cancelación respetada." : "\n❌ Resultado inesperado.");
process.exit(ok ? 0 : 1);
