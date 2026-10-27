/**
 * SAP simulado: guarda órdenes de compra en memoria.
 *
 * - Asigna un consecutivo de OC (4500000001, 4500000002, ...).
 * - Bloquea duplicados: una solicitud genera como máximo una OC (idempotente).
 * - Registra cada acción en un log de auditoría (quién, qué, cuándo, resultado).
 *
 * Nota: al ser memoria, en Vercel los datos se reinician cuando la función se recicla.
 * Para producción se reemplaza por un adaptador SAP real con la misma interfaz.
 */

export type ResultadoAuditoria = "ok" | "rechazado" | "duplicado" | "aprobado" | "cancelado" | "error";

export interface EventoAuditoria {
  id: number;
  fecha: string; // ISO 8601
  actor: string; // quién: "agente", "usuario", "demo", ...
  accion: string; // qué: nombre de la herramienta o decisión
  solicitudId?: string;
  resultado: ResultadoAuditoria;
  detalle?: Record<string, unknown>;
}

export interface OrdenCompra {
  numero: string;
  solicitudId: string;
  estado: "creada";
  fechaCreacion: string;
  creadaPor: string;
  datos: Record<string, unknown>;
}

export interface ResultadoCreacion {
  estado: "creada" | "duplicada";
  orden: OrdenCompra;
}

export interface OpcionesSap {
  /** Reloj inyectable para que la demo sea determinística. */
  reloj?: () => Date;
  /** Primer número de OC. */
  consecutivoInicial?: number;
}

export class SapSimulado {
  private readonly reloj: () => Date;
  private readonly consecutivoInicial: number;
  private siguienteNumero: number;
  private readonly ordenesPorSolicitud = new Map<string, OrdenCompra>();
  private readonly eventos: EventoAuditoria[] = [];

  constructor(opciones: OpcionesSap = {}) {
    this.reloj = opciones.reloj ?? (() => new Date());
    this.consecutivoInicial = opciones.consecutivoInicial ?? 4500000001;
    this.siguienteNumero = this.consecutivoInicial;
  }

  ahora(): string {
    return this.reloj().toISOString();
  }

  registrarAuditoria(evento: Omit<EventoAuditoria, "id" | "fecha">): EventoAuditoria {
    const completo: EventoAuditoria = { id: this.eventos.length + 1, fecha: this.ahora(), ...evento };
    this.eventos.push(completo);
    return completo;
  }

  /** Crea la OC o, si la solicitud ya tiene una, devuelve la existente sin crear otra. */
  crearOrden(params: { solicitudId: string; datos: Record<string, unknown>; actor: string }): ResultadoCreacion {
    const existente = this.ordenesPorSolicitud.get(params.solicitudId);
    if (existente) {
      this.registrarAuditoria({
        actor: params.actor,
        accion: "crear_orden",
        solicitudId: params.solicitudId,
        resultado: "duplicado",
        detalle: { numero: existente.numero, motivo: "La solicitud ya tiene una OC; no se crea otra." },
      });
      return { estado: "duplicada", orden: existente };
    }

    const orden: OrdenCompra = {
      numero: String(this.siguienteNumero++),
      solicitudId: params.solicitudId,
      estado: "creada",
      fechaCreacion: this.ahora(),
      creadaPor: params.actor,
      datos: params.datos,
    };
    this.ordenesPorSolicitud.set(params.solicitudId, orden);
    this.registrarAuditoria({
      actor: params.actor,
      accion: "crear_orden",
      solicitudId: params.solicitudId,
      resultado: "ok",
      detalle: { numero: orden.numero },
    });
    return { estado: "creada", orden };
  }

  obtenerOrdenPorSolicitud(solicitudId: string): OrdenCompra | undefined {
    return this.ordenesPorSolicitud.get(solicitudId);
  }

  listarOrdenes(): OrdenCompra[] {
    return [...this.ordenesPorSolicitud.values()];
  }

  auditoria(solicitudId?: string): EventoAuditoria[] {
    return solicitudId ? this.eventos.filter((e) => e.solicitudId === solicitudId) : [...this.eventos];
  }

  reiniciar(): void {
    this.ordenesPorSolicitud.clear();
    this.eventos.length = 0;
    this.siguienteNumero = this.consecutivoInicial;
  }
}

/** Instancia compartida por la app (sobrevive a las recargas en desarrollo). */
const global = globalThis as unknown as { __sapSimulado?: SapSimulado };
export const sap: SapSimulado = global.__sapSimulado ?? (global.__sapSimulado = new SapSimulado());
