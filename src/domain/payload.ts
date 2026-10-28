/** Construcción del payload OrdenCompra (PRD 7.4) con trazabilidad de cada valor. Funciones puras. */
import { buscarProveedor } from "./reglas";
import { ordenCompraSchema, type Maestros, type OrdenCompra, type Paquete, type Trazabilidad, type Validacion } from "./tipos";

const MAX_DESCRIPCION = 40; // límite SAP del texto breve

/** "H" si la descripción habla de horas; "UN" por defecto. */
export function unidadDe(descripcion: string): "UN" | "H" {
  return /\bhoras?\b/i.test(descripcion) ? "H" : "UN";
}

export function truncar(texto: string, max = MAX_DESCRIPCION): string {
  return texto.length <= max ? texto : texto.slice(0, max).trimEnd();
}

export interface EntradaPayload {
  paquete: Paquete;
  maestros: Maestros;
  validacion: Validacion;
  cotizacionRef: string | null;
  evidenciaSha256: string;
}

export type ResultadoPayload =
  | { ok: true; orden: OrdenCompra; trazabilidad: Trazabilidad[] }
  | { ok: false; error: string };

export function construirOrden(e: EntradaPayload): ResultadoPayload {
  const { paquete, validacion } = e;
  if (!validacion.apta)
    return { ok: false, error: `La solicitud tiene bloqueos (${validacion.bloqueos.map((b) => b.regla).join(", ")}); no se construye la OC.` };
  const proveedor = buscarProveedor(paquete, e.maestros);
  if (!proveedor || !paquete.aprobacion) return { ok: false, error: "Faltan proveedor o aprobación para construir la OC." };

  const s = paquete.solicitud;
  const traza: Trazabilidad[] = [];
  const t = <V extends string | number | null>(campo: string, valor: V, fuente: string): V => {
    traza.push({ campo, valor, fuente });
    return valor;
  };
  const fuenteProveedor = s.proveedor_nit ? "maestro.proveedores (por NIT de solicitud)" : "maestro.proveedores (por nombre normalizado)";
  const condiciones = s.condiciones_pago ?? validacion.derivados.condiciones_pago;
  const iva = s.indicador_iva ?? validacion.derivados.indicador_iva;
  if (!condiciones || !iva) return { ok: false, error: "Faltan condiciones de pago o indicador de IVA y no se pudieron derivar." };

  const orden: OrdenCompra = {
    referencia: {
      solicitud_id: t("referencia.solicitud_id", s.solicitud_id, "solicitud.solicitud_id"),
      correo_id: t("referencia.correo_id", paquete.correo.id, "correo.id"),
      cotizacion_ref: t("referencia.cotizacion_ref", e.cotizacionRef, "cotizacion"),
    },
    sociedad: t("sociedad", "1000", "constante SAP (PRD 7.4)"),
    organizacion_compras: t("organizacion_compras", "1000", "constante SAP (PRD 7.4)"),
    proveedor: {
      codigo_sap: t("proveedor.codigo_sap", proveedor.codigo_sap, fuenteProveedor),
      nit: t("proveedor.nit", proveedor.nit, fuenteProveedor),
      nombre: t("proveedor.nombre", proveedor.nombre, fuenteProveedor),
    },
    moneda: t("moneda", s.moneda, "solicitud.moneda"),
    condiciones_pago: t(
      "condiciones_pago",
      condiciones,
      s.condiciones_pago ? "solicitud.condiciones_pago" : "derivado (maestro.proveedores.condiciones_pago_default, RC7)",
    ),
    aprobador: {
      email: t("aprobador.email", paquete.aprobacion.de, "aprobacion.de"),
      fecha_aprobacion: t("aprobador.fecha_aprobacion", paquete.aprobacion.fecha, "aprobacion.fecha"),
      evidencia_sha256: t("aprobador.evidencia_sha256", e.evidenciaSha256, "derivado (sha256 de la evidencia de aprobación)"),
    },
    posiciones: [
      {
        numero: t("posiciones[0].numero", 10, "constante SAP (posiciones 10, 20, 30…)"),
        descripcion: t("posiciones[0].descripcion", truncar(s.descripcion), "solicitud.descripcion (truncada a 40)"),
        cantidad: t("posiciones[0].cantidad", s.cantidad, "solicitud.cantidad"),
        unidad: t("posiciones[0].unidad", unidadDe(s.descripcion), "derivado (solicitud.descripcion: H si son horas, UN por defecto)"),
        precio_unitario: t("posiciones[0].precio_unitario", s.valor_unitario, "solicitud.valor_unitario"),
        centro_costo: t("posiciones[0].centro_costo", s.centro_costo, "solicitud.centro_costo"),
        subarea: t("posiciones[0].subarea", s.subarea, "solicitud.subarea"),
        indicador_iva: t(
          "posiciones[0].indicador_iva",
          iva,
          s.indicador_iva ? "solicitud.indicador_iva" : "derivado (maestro.proveedores.indicador_iva_default, RC6)",
        ),
      },
    ],
    excepciones: validacion.confirmaciones.map((c, i) => ({
      codigo: t(`excepciones[${i}].codigo`, c.regla, "validacion (RC)"),
      detalle: c.mensaje,
      confirmado_por: null,
    })),
  };

  const valida = ordenCompraSchema.safeParse(orden);
  if (!valida.success) return { ok: false, error: `El payload no cumple el esquema: ${valida.error.issues.map((i) => i.message).join("; ")}` };
  return { ok: true, orden: valida.data, trazabilidad: traza };
}

/** Marca las excepciones como confirmadas por quien confirmó y cuándo. */
export function confirmarExcepciones(orden: OrdenCompra, confirmadoPor: string, confirmadoEn: string): OrdenCompra {
  return { ...orden, excepciones: orden.excepciones.map((x) => ({ ...x, confirmado_por: confirmadoPor, confirmado_en: confirmadoEn })) };
}
