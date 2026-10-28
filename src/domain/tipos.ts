/** Esquemas zod del dominio: fixtures (PRD 7.1), paquete normalizado (7.2) y orden de compra (7.4). */
import { z } from "zod";

// ---------- Fixtures (7.1) ----------

export const solicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string(),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number(),
  valor_unitario: z.number(),
  valor_total: z.number(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha_solicitud debe tener formato AAAA-MM-DD"),
});
export type Solicitud = z.infer<typeof solicitudSchema>;

export const correoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
});

export const aprobacionArchivoSchema = z.object({
  de: z.string(),
  para: z.string(),
  cc: z.array(z.string()).optional(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
});
export type AprobacionArchivo = z.infer<typeof aprobacionArchivoSchema>;

export const proveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
});
export type Proveedor = z.infer<typeof proveedorSchema>;

export const centroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
});
export type CentroCosto = z.infer<typeof centroCostoSchema>;

export const indicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() });
export const condicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() });

export interface Maestros {
  proveedores: Proveedor[];
  centrosCosto: CentroCosto[];
  indicadoresIva: z.infer<typeof indicadorIvaSchema>[];
  condicionesPago: z.infer<typeof condicionPagoSchema>[];
}

// ---------- Paquete normalizado (7.2) ----------

export const paqueteSchema = z.object({
  correo: correoSchema.describe("Correo de entrada: id, remitente, asunto y fecha"),
  solicitud: solicitudSchema.describe("Solicitud de compra normalizada"),
  cotizacion: z
    .object({
      proveedor: z.string(),
      nit: z.string().nullable(),
      total: z.number(),
      moneda: z.string(),
      validez_hasta: z.string().nullable(),
      texto: z.string(),
    })
    .nullable()
    .describe("Cotización del proveedor; null si no vino"),
  aprobacion: z
    .object({ de: z.string(), fecha: z.string(), aprobado: z.boolean(), texto: z.string() })
    .nullable()
    .describe("Correo de aprobación del líder; null si no vino"),
  factura: z
    .object({ numero: z.string(), fecha: z.string(), total: z.number() })
    .nullable()
    .describe("Factura del proveedor; null si no vino"),
});
export type Paquete = z.infer<typeof paqueteSchema>;

// ---------- Resultado de validación (7.3) ----------

export type CodigoRegla = "RC1" | "RC2" | "RC3" | "RC4" | "RC5" | "RC6" | "RC7" | "RC8" | "RC9" | "RC10";

export interface Hallazgo {
  regla: CodigoRegla;
  mensaje: string;
  accion_sugerida: string;
  datos?: Record<string, string | number | boolean | null>;
}

export const derivadosSchema = z.object({
  indicador_iva: z.string().optional().describe("Indicador de IVA derivado del maestro de proveedores (RC6)"),
  condiciones_pago: z.string().optional().describe("Condiciones de pago derivadas del maestro de proveedores (RC7)"),
});
export type Derivados = z.infer<typeof derivadosSchema>;

export interface Validacion {
  apta: boolean;
  bloqueos: Hallazgo[];
  confirmaciones: Hallazgo[];
  derivados: Derivados;
  retroactiva: boolean;
}

// ---------- Orden de compra (7.4) ----------

export const ordenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string().min(1), nit: z.string().min(1), nombre: z.string().min(1) }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string().min(1),
  aprobador: z.object({
    email: z.string().min(1),
    fecha_aprobacion: z.string().min(1),
    evidencia_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int().positive().multipleOf(10),
        descripcion: z.string().min(1).max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number().nonnegative(),
        centro_costo: z.string().min(1),
        subarea: z.string().min(1),
        indicador_iva: z.string().min(1),
      }),
    )
    .min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
});
export type OrdenCompra = z.infer<typeof ordenCompraSchema>;

export interface Trazabilidad {
  campo: string;
  valor: string | number | null;
  fuente: string; // "solicitud.<campo>", "cotizacion", "maestro.<nombre>", "derivado (...)", "correo", "aprobacion", "constante SAP"
}
