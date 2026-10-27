/** Todas las fechas del sistema se expresan en hora de Colombia. */
export const ZONA_HORARIA = "America/Bogota";

const formato = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** ISO 8601 en hora de Colombia con su desfase, p. ej. "2026-01-01T09:30:00-05:00". */
export function fechaColombia(fecha: Date): string {
  const p = Object.fromEntries(formato.formatToParts(fecha).map((x) => [x.type, x.value]));
  const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  // Desfase real de la zona en ese instante (Colombia hoy es -05:00 todo el año).
  const minutos = Math.round((Date.parse(`${local}Z`) - Math.floor(fecha.getTime() / 1000) * 1000) / 60000);
  const signo = minutos < 0 ? "-" : "+";
  const abs = Math.abs(minutos);
  const desfase = `${signo}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${local}${desfase}`;
}
