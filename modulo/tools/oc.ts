/**
 * Herramientas del módulo reutilizable (PRD 9.4): son las mismas que usa la app.
 * Se re-exportan desde src/tools/oc.ts (sin copiar código) y no dependen del servidor HTTP.
 * Cada export es { description, args (zod), execute(args, ctx) } y se expone como oc_<export>.
 */
export { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "../../src/tools/oc";
export type { ContextoHerramienta } from "../../src/tools/oc";
