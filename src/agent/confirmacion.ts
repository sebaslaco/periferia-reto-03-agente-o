/** Detección determinística de confirmaciones y cancelaciones en el mensaje del usuario (CA3). */

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NEGACION = /\b(no|cancelar|cancela|cancelo|cancelada|detente|espera|rechazo|rechazar)\b/;
const AFIRMACION = /\b(confirmo|confirmado|confirmar|confirma|si|procede|proceder|adelante|creala|crealas|crear|crea|dale|ok|okay|de acuerdo|autorizo)\b/;

export function esCancelacion(texto: string): boolean {
  return NEGACION.test(normalizar(texto));
}

/** "confirmo", "sí, créala", "adelante"… sí; "no confirmo", "cancelar" no. */
export function esConfirmacion(texto: string): boolean {
  const t = normalizar(texto);
  return !NEGACION.test(t) && AFIRMACION.test(t);
}
