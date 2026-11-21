/**
 * Capa de almacenamiento intercambiable.
 *
 * Hoy: AlmacenLocal (datos en este dispositivo, localStorage).
 * Mañana: AlmacenRemoto (misma interfaz, habla con la API del servidor
 * definida en api/openapi.yaml), para que la PWA y el asistente de
 * WhatsApp compartan la misma agenda. La interfaz de la app no cambia.
 *
 * Interfaz:
 *   listarReservas(): Promise<Reserva[]>
 *   guardarReserva(r): Promise<Reserva>
 *   eliminarReserva(id): Promise<void>
 *   leerConfig(): Promise<Config>
 *   guardarConfig(c): Promise<Config>
 */

/**
 * Catálogo TBS (noviembre 2026).
 * precio = USD por persona · minPersonas/maxPersonas = guía (se avisa, no se bloquea)
 * duracionMin: las marcadas "SUPUESTA" no están en el catálogo y deben confirmarse.
 */
const GASEOSA = { id: 'gaseosa', nombre: 'Gaseosa ilimitada', precio: 2 };
export const PLANES_POR_DEFECTO = [
  // Catering / buffet (meseros se cotizan aparte)
  { id: 'cat-graduacion', categoria: 'Catering / buffet', nombre: 'Paquete graduación', precio: 5, minPersonas: 80, color: '#E6C766', duracionMin: 120 /* SUPUESTA */ },
  { id: 'cat-buffet-8', categoria: 'Catering / buffet', nombre: 'Buffet $8', precio: 8, minPersonas: 50, color: '#C9A227', duracionMin: 120 },
  { id: 'cat-buffet-1250', categoria: 'Catering / buffet', nombre: 'Buffet $12.50', precio: 12.5, minPersonas: 50, color: '#9C7A17', duracionMin: 120 },
  // Menús servidos
  { id: 'menu-1450', categoria: 'Menús servidos', nombre: 'Menú servido $14.50', precio: 14.5, color: '#7FB3E0', duracionMin: 120 /* SUPUESTA */ },
  { id: 'menu-1550', categoria: 'Menús servidos', nombre: 'Menú servido $15.50', precio: 15.5, color: '#3E7CB1', duracionMin: 120 /* SUPUESTA */ },
  { id: 'menu-1650', categoria: 'Menús servidos', nombre: 'Menú servido $16.50', precio: 16.5, color: '#24507A', duracionMin: 120 /* SUPUESTA */ },
  // Parrilla en vivo (sin logística, incluye show)
  { id: 'parr-social', categoria: 'Parrilla en vivo', nombre: 'Parrilla eventos sociales', precio: 15, minPersonas: 25, color: '#F08A5D', duracionMin: 180 /* SUPUESTA */ },
  { id: 'parr-1', categoria: 'Parrilla en vivo', nombre: 'Parrilla Paquete 1', precio: 17.5, minPersonas: 25, color: '#D9534F', duracionMin: 180 /* SUPUESTA */ },
  { id: 'parr-2', categoria: 'Parrilla en vivo', nombre: 'Parrilla Paquete 2', precio: 25, minPersonas: 25, color: '#A8322E', duracionMin: 180 /* SUPUESTA */ },
  { id: 'parr-3', categoria: 'Parrilla en vivo', nombre: 'Parrilla Paquete 3', precio: 45, minPersonas: 25, color: '#6E1E1B', duracionMin: 180 /* SUPUESTA */ },
  // Eventos sociales
  { id: 'evt-integral', categoria: 'Eventos sociales', nombre: 'Organización integral', precio: 35, minPersonas: 100, color: '#9B6BC2', duracionMin: 300 /* SUPUESTA */ },
  // Agasajos navideños 2026
  { id: 'nav-menu-1', categoria: 'Agasajos navideños', nombre: 'Navidad Menú 1 · Clásico', precio: 17.5, minPersonas: 10, color: '#6FCF97', duracionMin: 120, adicionales: [GASEOSA] },
  { id: 'nav-menu-2', categoria: 'Agasajos navideños', nombre: 'Navidad Menú 2 · Mar y tierra', precio: 16.5, minPersonas: 10, color: '#3FA36B', duracionMin: 120, adicionales: [GASEOSA] },
  { id: 'nav-menu-3', categoria: 'Agasajos navideños', nombre: 'Navidad Menú 3 · La gran cena', precio: 17.5, minPersonas: 10, color: '#1F6B43', duracionMin: 120, adicionales: [GASEOSA] },
  { id: 'nav-local', categoria: 'Agasajos navideños', nombre: 'Agasajo en el local', precio: null /* FALTA */, minPersonas: 6, maxPersonas: 30, color: '#3FA7A3', duracionMin: 120 /* SUPUESTA */ },
];

export const CONFIG_POR_DEFECTO = {
  planes: PLANES_POR_DEFECTO,
  apertura: '12:00',
  cierre: '23:00',
  margenMin: 60,
  anticipoPct: 25,
  diasPagoTotal: 7, // SUPUESTO: "si el evento es en pocos días" → menos de 7 días
};

const K_RES = 'tbs.reservas.v1';
const K_CFG = 'tbs.config.v2';

function leer(clave, porDefecto) {
  try {
    const v = localStorage.getItem(clave);
    return v ? JSON.parse(v) : porDefecto;
  } catch {
    return porDefecto;
  }
}
function escribir(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { console.error('No se pudo guardar', e); throw e; }
}

export class AlmacenLocal {
  async listarReservas() { return leer(K_RES, []); }
  async guardarReserva(r) {
    const todas = leer(K_RES, []);
    const i = todas.findIndex(x => x.id === r.id);
    if (i >= 0) todas[i] = r; else todas.push(r);
    escribir(K_RES, todas);
    return r;
  }
  async eliminarReserva(id) { escribir(K_RES, leer(K_RES, []).filter(x => x.id !== id)); }
  async leerConfig() { return { ...CONFIG_POR_DEFECTO, ...leer(K_CFG, {}) }; }
  async guardarConfig(c) { escribir(K_CFG, c); return c; }
  /** Respaldo completo (exportar/importar JSON) */
  async exportar() { return { version: 1, exportadoEn: new Date().toISOString(), config: await this.leerConfig(), reservas: await this.listarReservas() }; }
  async importar(datos) {
    if (!datos || !Array.isArray(datos.reservas)) throw new Error('Archivo de respaldo no válido');
    escribir(K_RES, datos.reservas);
    if (datos.config) escribir(K_CFG, datos.config);
  }
}

/** Esqueleto para cuando exista el servidor (ver api/openapi.yaml). */
export class AlmacenRemoto {
  constructor(baseUrl, token) { this.base = baseUrl.replace(/\/$/, ''); this.token = token; }
  async _f(ruta, opciones = {}) {
    const res = await fetch(this.base + ruta, {
      ...opciones,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`, ...(opciones.headers || {}) },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
  listarReservas() { return this._f('/reservas'); }
  guardarReserva(r) { return this._f(`/reservas/${encodeURIComponent(r.id)}`, { method: 'PUT', body: JSON.stringify(r) }); }
  eliminarReserva(id) { return this._f(`/reservas/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  leerConfig() { return this._f('/config'); }
  guardarConfig(c) { return this._f('/config', { method: 'PUT', body: JSON.stringify(c) }); }
}
