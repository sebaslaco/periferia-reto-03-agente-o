/** Reglas de control RC1–RC10 (PRD 7.3). Funciones puras: misma entrada → mismo resultado. */
import { dia, normalizarNombre } from "./parseo";
import type { CentroCosto, Derivados, Hallazgo, Maestros, Paquete, Proveedor, Validacion } from "./tipos";

const TOLERANCIA_COTIZACION = 0.02; // RC5: 2 %
const TOLERANCIA_TOTAL = 1; // RC10: ± 1 unidad monetaria

const formatoMonto = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

/** RC1: por NIT de la solicitud; si no hay NIT, por nombre normalizado. */
export function buscarProveedor(paquete: Paquete, maestros: Maestros): Proveedor | undefined {
  const { proveedor_nit, proveedor_nombre } = paquete.solicitud;
  if (proveedor_nit) return maestros.proveedores.find((p) => p.nit === proveedor_nit);
  const nombre = normalizarNombre(proveedor_nombre);
  return maestros.proveedores.find((p) => normalizarNombre(p.nombre) === nombre);
}

export function buscarCentro(paquete: Paquete, maestros: Maestros): CentroCosto | undefined {
  return maestros.centrosCosto.find((c) => c.centro_costo === paquete.solicitud.centro_costo);
}

function rc1(paquete: Paquete, proveedor: Proveedor | undefined): Hallazgo | null {
  const s = paquete.solicitud;
  const criterio = s.proveedor_nit ? `NIT ${s.proveedor_nit}` : `nombre "${s.proveedor_nombre}"`;
  if (!proveedor)
    return {
      regla: "RC1",
      mensaje: `El proveedor (${criterio}) no existe en el maestro de proveedores.`,
      accion_sugerida: "Solicitar la creación del proveedor en el maestro o corregir el NIT de la solicitud.",
      datos: { nit: s.proveedor_nit ?? null, nombre: s.proveedor_nombre },
    };
  if (!proveedor.activo)
    return {
      regla: "RC1",
      mensaje: `El proveedor ${proveedor.nombre} (NIT ${proveedor.nit}) está inactivo en el maestro.`,
      accion_sugerida: "Pedir la reactivación del proveedor o elegir un proveedor activo.",
      datos: { nit: proveedor.nit, codigo_sap: proveedor.codigo_sap },
    };
  return null;
}

function rc2(paquete: Paquete, centro: CentroCosto | undefined): Hallazgo | null {
  const a = paquete.aprobacion;
  const cc = paquete.solicitud.centro_costo;
  if (!a)
    return { regla: "RC2", mensaje: "No hay correo de aprobación.", accion_sugerida: `Pedir la aprobación de un aprobador de ${cc}.` };
  if (!a.aprobado)
    return {
      regla: "RC2",
      mensaje: `El correo de aprobación de ${a.de} no contiene "Aprobado".`,
      accion_sugerida: "Pedir al líder una aprobación explícita.",
      datos: { aprobador: a.de },
    };
  const autorizados = centro?.aprobadores.map((x) => x.email.toLowerCase()) ?? [];
  if (!autorizados.includes(a.de))
    return {
      regla: "RC2",
      mensaje: `${a.de} no es aprobador del centro de costo ${cc}.`,
      accion_sugerida: `Pedir la aprobación de un aprobador de ${cc}${autorizados.length ? `: ${autorizados.join(", ")}` : ""}.`,
      datos: { aprobador: a.de, centro_costo: cc },
    };
  return null;
}

/** RC3: tope del aprobador; si el aprobador no es válido para el centro, el mayor tope del centro. */
function rc3(paquete: Paquete, centro: CentroCosto | undefined): Hallazgo | null {
  if (!centro || centro.aprobadores.length === 0) return null; // ya lo reportan RC2/RC4
  const { valor_total, centro_costo } = paquete.solicitud;
  const aprobador = centro.aprobadores.find((x) => x.email.toLowerCase() === paquete.aprobacion?.de);
  const tope = aprobador ? aprobador.tope : Math.max(...centro.aprobadores.map((x) => x.tope));
  if (valor_total <= tope) return null;
  const quien = aprobador ? `del aprobador ${aprobador.email}` : `de los aprobadores de ${centro_costo}`;
  const superior = centro.aprobadores.find((x) => x.tope >= valor_total);
  return {
    regla: "RC3",
    mensaje: `El valor ${formatoMonto(valor_total)} supera el tope ${quien} (${formatoMonto(tope)}).`,
    accion_sugerida: superior
      ? `Pedir la aprobación de ${superior.email} (tope ${formatoMonto(superior.tope)}).`
      : `Ningún aprobador de ${centro_costo} tiene tope suficiente; escalar a la dirección o dividir la compra según política.`,
    datos: { valor_total, tope },
  };
}

function rc4(paquete: Paquete, centro: CentroCosto | undefined): Hallazgo | null {
  const { centro_costo, subarea } = paquete.solicitud;
  if (!centro)
    return {
      regla: "RC4",
      mensaje: `El centro de costo ${centro_costo} no existe en el maestro.`,
      accion_sugerida: "Corregir el centro de costo en la solicitud.",
      datos: { centro_costo },
    };
  if (!centro.subareas.includes(subarea))
    return {
      regla: "RC4",
      mensaje: `La subárea "${subarea}" no pertenece al centro de costo ${centro_costo}.`,
      accion_sugerida: `Corregir la subárea; las válidas son: ${centro.subareas.join(", ")}.`,
      datos: { centro_costo, subarea },
    };
  return null;
}

function rc5(paquete: Paquete): Hallazgo | null {
  const { valor_total } = paquete.solicitud;
  const cot = paquete.cotizacion;
  if (!cot)
    return {
      regla: "RC5",
      mensaje: "No hay cotización para contrastar el valor de la solicitud.",
      accion_sugerida: "Confirmar que se crea la OC sin cotización o pedirla al solicitante.",
      datos: { valor_solicitud: valor_total },
    };
  const diferencia = Math.abs(cot.total - valor_total) / valor_total;
  if (diferencia <= TOLERANCIA_COTIZACION) return null;
  const pct = Math.round(diferencia * 10000) / 100;
  return {
    regla: "RC5",
    mensaje: `La cotización (${formatoMonto(cot.total)}) difiere ${pct} % de la solicitud (${formatoMonto(valor_total)}); el máximo es 2 %.`,
    accion_sugerida: "Confirmar con el solicitante cuál valor aplica antes de crear la OC.",
    datos: { valor_solicitud: valor_total, valor_cotizacion: cot.total, diferencia_pct: pct },
  };
}

function rc6(paquete: Paquete, proveedor: Proveedor | undefined): { hallazgo: Hallazgo; valor: string } | null {
  if (paquete.solicitud.indicador_iva || !proveedor) return null;
  const valor = proveedor.indicador_iva_default;
  return {
    valor,
    hallazgo: {
      regla: "RC6",
      mensaje: `La solicitud no informa indicador de IVA; se deriva ${valor} del maestro de proveedores (${proveedor.nombre}).`,
      accion_sugerida: `Confirmar que el indicador de IVA ${valor} es correcto.`,
      datos: { indicador_iva_derivado: valor },
    },
  };
}

function rc7(paquete: Paquete, proveedor: Proveedor | undefined): string | null {
  if (paquete.solicitud.condiciones_pago || !proveedor) return null;
  return proveedor.condiciones_pago_default;
}

function rc8(paquete: Paquete): Hallazgo | null {
  const f = paquete.factura;
  const { fecha_solicitud } = paquete.solicitud;
  if (!f || dia(f.fecha) >= fecha_solicitud) return null;
  return {
    regla: "RC8",
    mensaje: `Compra retroactiva: la factura ${f.numero} (${dia(f.fecha)}) es anterior a la solicitud (${fecha_solicitud}).`,
    accion_sugerida: "Confirmar la creación de la OC retroactiva; quedará marcada en el log de control.",
    datos: { factura: f.numero, fecha_factura: dia(f.fecha), fecha_solicitud },
  };
}

function rc9(paquete: Paquete): Hallazgo | null {
  const a = paquete.aprobacion;
  const { fecha_solicitud } = paquete.solicitud;
  if (!a || dia(a.fecha) >= fecha_solicitud) return null;
  return {
    regla: "RC9",
    mensaje: `La aprobación (${dia(a.fecha)}) es anterior a la fecha de la solicitud (${fecha_solicitud}).`,
    accion_sugerida: "Confirmar que la aprobación corresponde a esta solicitud.",
    datos: { fecha_aprobacion: dia(a.fecha), fecha_solicitud },
  };
}

function rc10(paquete: Paquete): Hallazgo | null {
  const { cantidad, valor_unitario, valor_total } = paquete.solicitud;
  const calculado = cantidad * valor_unitario;
  if (Math.abs(calculado - valor_total) <= TOLERANCIA_TOTAL) return null;
  return {
    regla: "RC10",
    mensaje: `Cantidad × valor unitario (${formatoMonto(calculado)}) no coincide con el valor total (${formatoMonto(valor_total)}).`,
    accion_sugerida: "Pedir al solicitante que corrija cantidad, valor unitario o valor total.",
    datos: { cantidad, valor_unitario, valor_total, calculado },
  };
}

const presentes = (lista: (Hallazgo | null)[]): Hallazgo[] => lista.filter((h): h is Hallazgo => h !== null);

/** Aplica RC1–RC10 y devuelve { apta, bloqueos, confirmaciones, derivados, retroactiva }. */
export function validar(paquete: Paquete, maestros: Maestros): Validacion {
  const proveedor = buscarProveedor(paquete, maestros);
  const centro = buscarCentro(paquete, maestros);

  const bloqueos = presentes([rc1(paquete, proveedor), rc2(paquete, centro), rc3(paquete, centro), rc4(paquete, centro), rc10(paquete)]);

  const iva = rc6(paquete, proveedor);
  const condiciones = rc7(paquete, proveedor);
  const retro = rc8(paquete);
  const confirmaciones = presentes([rc5(paquete), iva?.hallazgo ?? null, retro, rc9(paquete)]);

  const derivados: Derivados = {};
  if (iva) derivados.indicador_iva = iva.valor;
  if (condiciones) derivados.condiciones_pago = condiciones;

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva: retro !== null };
}
