/**
 * TBS Reservas — lógica de negocio pura (sin DOM, sin almacenamiento).
 *
 * Este módulo es el "cerebro" compartido: lo usa la PWA hoy y lo usará
 * mañana el servidor del asistente de WhatsApp, para que ambos apliquen
 * exactamente las mismas reglas (validación, márgenes, horarios libres).
 * Funciona igual en el navegador y en Node (ES module, sin dependencias).
 */

export const MARGEN_RECOMENDADO_MIN = 60;

export const ESTADOS = ['confirmada', 'pendiente', 'cancelada'];
export const ORIGENES = ['manual', 'whatsapp', 'api'];

/** "HH:MM" -> minutos desde medianoche */
export function aMinutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

/** minutos -> "HH:MM" (admite valores > 24h, se normalizan) */
export function aHora(min) {
  const t = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Inicio y fin absolutos de una reserva, en milisegundos (hora local). */
export function intervalo(r) {
  const [y, mo, d] = r.fecha.split('-').map(Number);
  const inicio = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime() + aMinutos(r.hora) * 60000;
  return { inicio, fin: inicio + Number(r.duracionMin) * 60000 };
}

export function horaFin(r) {
  return aHora(aMinutos(r.hora) + Number(r.duracionMin));
}

export function nuevoId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Valida una reserva. Devuelve una lista de errores (vacía = válida).
 * @param {object} r
 * @param {Array<{id:string}>} planes
 */
export function validarReserva(r, planes = []) {
  const e = [];
  if (!r.planId || (planes.length && !planes.some(p => p.id === r.planId))) e.push('Seleccione un plan válido.');
  if (!r.cliente || !String(r.cliente).trim()) e.push('Ingrese el nombre del cliente.');
  const n = Number(r.personas);
  if (!Number.isInteger(n) || n < 1) e.push('El número de personas debe ser al menos 1.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fecha || '')) e.push('Indique la fecha.');
  if (!/^\d{2}:\d{2}$/.test(r.hora || '')) e.push('Indique el horario.');
  const dur = Number(r.duracionMin);
  if (!Number.isFinite(dur) || dur < 15) e.push('La duración estimada debe ser de al menos 15 minutos.');
  if (r.estado && !ESTADOS.includes(r.estado)) e.push('Estado no reconocido.');
  return e;
}

/** Completa campos por defecto y normaliza tipos. */
export function normalizarReserva(r) {
  const ahora = new Date().toISOString();
  return {
    id: r.id || nuevoId(),
    planId: r.planId,
    personas: Number(r.personas),
    cliente: String(r.cliente || '').trim(),
    telefono: String(r.telefono || '').trim(),
    fecha: r.fecha,
    hora: r.hora,
    duracionMin: Number(r.duracionMin),
    notas: String(r.notas || '').trim(),
    lugar: String(r.lugar || '').trim(),
    adicionales: Array.isArray(r.adicionales) ? r.adicionales : [],
    estado: r.estado || 'confirmada',
    origen: r.origen || 'manual',
    creadoEn: r.creadoEn || ahora,
    actualizadoEn: ahora,
  };
}

/**
 * Revisa la separación entre una reserva y las existentes.
 * Devuelve avisos: { tipo: 'solapa' | 'margen', reserva, minutos }
 *  - 'solapa': los horarios se cruzan (minutos = minutos de cruce)
 *  - 'margen': no se cruzan pero quedan menos de `margenMin` minutos entre ellas
 */
export function analizarMargenes(reserva, existentes, margenMin = MARGEN_RECOMENDADO_MIN) {
  const a = intervalo(reserva);
  const avisos = [];
  for (const otra of existentes) {
    if (otra.id === reserva.id || otra.estado === 'cancelada') continue;
    const b = intervalo(otra);
    if (a.inicio < b.fin && b.inicio < a.fin) {
      const cruce = (Math.min(a.fin, b.fin) - Math.max(a.inicio, b.inicio)) / 60000;
      avisos.push({ tipo: 'solapa', reserva: otra, minutos: Math.round(cruce) });
      continue;
    }
    const brecha = (a.inicio >= b.fin ? a.inicio - b.fin : b.inicio - a.fin) / 60000;
    if (brecha < margenMin) avisos.push({ tipo: 'margen', reserva: otra, minutos: Math.round(brecha) });
  }
  return avisos.sort((x, y) => intervalo(x.reserva).inicio - intervalo(y.reserva).inicio);
}

/**
 * Horarios de inicio disponibles en una fecha, respetando el margen recomendado.
 * Base para que el asistente de WhatsApp proponga horarios por sí mismo.
 * @param {string} fecha 'YYYY-MM-DD'
 * @param {number} duracionMin
 * @param {Array} existentes
 * @param {{apertura?:string, cierre?:string, paso?:number, margenMin?:number}} opciones
 * @returns {string[]} lista de "HH:MM"
 */
export function horariosDisponibles(fecha, duracionMin, existentes, opciones = {}) {
  const { apertura = '12:00', cierre = '23:00', paso = 30, margenMin = MARGEN_RECOMENDADO_MIN } = opciones;
  const ini = aMinutos(apertura);
  let fin = aMinutos(cierre);
  if (fin <= ini) fin += 1440; // cierre después de medianoche
  const libres = [];
  for (let m = ini; m + duracionMin <= fin; m += paso) {
    const candidata = { id: '__candidata__', fecha, hora: aHora(m), duracionMin };
    if (m >= 1440) continue; // inicios después de medianoche pertenecen al día siguiente
    if (analizarMargenes(candidata, existentes, margenMin).length === 0) libres.push(aHora(m));
  }
  return libres;
}

/**
 * Avisos sobre el número de personas frente a la guía del plan.
 * Son recomendaciones: el catálogo indica que se puede adaptar a cada cliente.
 */
export function avisosPersonas(r, plan) {
  const n = Number(r.personas);
  if (!plan || !n) return [];
  const out = [];
  if (plan.minPersonas && n < plan.minPersonas) out.push(`${plan.nombre} es desde ${plan.minPersonas} personas (esta reserva tiene ${n}).`);
  if (plan.maxPersonas && n > plan.maxPersonas) out.push(`${plan.nombre} es hasta ${plan.maxPersonas} personas (esta reserva tiene ${n}).`);
  return out;
}

/**
 * Cotización estimada: precio por persona + adicionales, anticipo y si corresponde pago total.
 * @returns {{porPersona:number|null, total:number|null, anticipo:number|null, pagoTotal:boolean, diasFaltan:number}}
 */
export function cotizar(r, plan, { anticipoPct = 25, diasPagoTotal = 7, hoy = new Date() } = {}) {
  const n = Number(r.personas) || 0;
  const extras = (plan?.adicionales || []).filter(a => (r.adicionales || []).includes(a.id));
  const porPersona = plan?.precio == null ? null : plan.precio + extras.reduce((s, a) => s + a.precio, 0);
  const total = porPersona == null ? null : Math.round(porPersona * n * 100) / 100;
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  const [y, m, d] = (r.fecha || '').split('-').map(Number);
  const diasFaltan = y ? Math.round((new Date(y, m - 1, d).getTime() - inicioHoy) / 86400000) : NaN;
  const pagoTotal = diasFaltan < diasPagoTotal;
  const anticipo = total == null ? null : pagoTotal ? total : Math.round(total * anticipoPct) / 100;
  return { porPersona, total, anticipo, pagoTotal, diasFaltan };
}

/** Texto legible para un aviso (lo usan la PWA y el bot). */
export function describirAviso(aviso, planes = []) {
  const r = aviso.reserva;
  const plan = planes.find(p => p.id === r.planId)?.nombre || 'plan';
  const quien = `${r.cliente} (${plan}, ${r.hora}–${horaFin(r)})`;
  if (aviso.tipo === 'solapa') return `Se cruza ${aviso.minutos} min con la reserva de ${quien}.`;
  return `Solo quedan ${aviso.minutos} min de separación con la reserva de ${quien}. Se recomienda mantener al menos 1 h.`;
}
