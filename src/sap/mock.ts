/**
 * SAP simulado sobre archivos: cada OC es una línea de out/sap/ordenes.jsonl.
 * Consecutivo desde 4500000001. La idempotencia por solicitud_id la garantiza oc_crear
 * consultando buscarOrdenPorReferencia antes de crear (y crearOrden la vuelve a verificar).
 */
import path from "node:path";
import { fechaColombia } from "../fechas";
import { agregarLinea, cargarMaestros, directorioSalida, leerTextoOpcional, type ContextoHerramienta } from "../infra/archivos";
import type { OrdenCompra, SapAdapter } from "./adapter";

const ARCHIVO = "sap/ordenes.jsonl";
const PRIMER_NUMERO = 4500000001;

interface Registro {
  numero_oc: string;
  fecha: string;
  orden: OrdenCompra;
}

export class SapMock implements SapAdapter {
  constructor(private readonly ctx: ContextoHerramienta) {}

  private async registros(): Promise<Registro[]> {
    const texto = await leerTextoOpcional(path.join(directorioSalida(this.ctx), ARCHIVO));
    if (!texto) return [];
    return texto
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Registro);
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const { proveedores } = await cargarMaestros(this.ctx);
    const p = proveedores.find((x) => x.nit === nit);
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null;
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const r = (await this.registros()).find((x) => x.orden.referencia.solicitud_id === solicitud_id);
    return r ? { numero_oc: r.numero_oc } : null;
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const registros = await this.registros();
    const existente = registros.find((x) => x.orden.referencia.solicitud_id === orden.referencia.solicitud_id);
    if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha };
    const ultimo = registros.reduce((max, r) => Math.max(max, Number(r.numero_oc)), PRIMER_NUMERO - 1);
    const registro: Registro = { numero_oc: String(ultimo + 1), fecha: fechaColombia(new Date()), orden };
    await agregarLinea(this.ctx, ARCHIVO, JSON.stringify(registro));
    return { numero_oc: registro.numero_oc, fecha: registro.fecha };
  }
}
