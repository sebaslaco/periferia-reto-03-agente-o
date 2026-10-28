/** Interfaz del adaptador SAP (PRD 7.4). La implementación de pruebas está en mock.ts. */
import type { OrdenCompra } from "../domain/tipos";

export type { OrdenCompra };

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>;
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>;
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>;
}
