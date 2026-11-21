import {
  validarReserva, normalizarReserva, analizarMargenes, horariosDisponibles,
  describirAviso, horaFin, aMinutos, aHora, nuevoId, avisosPersonas, cotizar,
} from './core/reservas.js';
import { AlmacenLocal } from './core/almacen.js';

const almacen = new AlmacenLocal();
const $ = (s, el = document) => el.querySelector(s);
const HORA_PX = 56;
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const estado = {
  vista: matchMedia('(max-width: 640px)').matches ? 'dia' : 'semana',
  fecha: hoy(),
  reservas: [],
  config: null,
  editando: null,
  duracionTocada: false,
};

/* ---------- utilidades de fecha ---------- */
function hoy() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function deIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function sumarDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function lunes(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function mismoDia(a, b) { return iso(a) === iso(b); }
const fmt = (d, o) => d.toLocaleDateString('es', o);
function durTexto(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? ' ' + m : ''}` : `${m} min`; }
const usd = n => '$' + Number(n).toFixed(2).replace(/\.00$/, '');
function porCategoria(planes) {
  const g = new Map();
  for (const p of planes) { const c = p.categoria || 'Otros'; if (!g.has(c)) g.set(c, []); g.get(c).push(p); }
  return g;
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function plan(id) { return estado.config.planes.find(p => p.id === id) || { nombre: 'Sin plan', color: '#777' }; }
function delDia(fechaIso) {
  return estado.reservas.filter(r => r.fecha === fechaIso).sort((a, b) => aMinutos(a.hora) - aMinutos(b.hora));
}
function activas(lista) { return lista.filter(r => r.estado !== 'cancelada'); }

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('ver');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('ver'), 2600);
}

/* ---------- render principal ---------- */
function render() {
  document.querySelectorAll('.vistas button').forEach(b => b.setAttribute('aria-selected', b.dataset.vista === estado.vista));
  $('#leyenda').innerHTML = [...porCategoria(estado.config.planes)].map(([cat, ps]) =>
    `<span class="ley-cat" title="${esc(ps.map(p => p.nombre).join(' · '))}">${ps.map(p => `<i style="background:${p.color}"></i>`).join('')}${esc(cat)}</span>`).join('')
    + `<span><i style="border:1px dashed var(--aviso)"></i>Menos de ${estado.config.margenMin} min entre reservas</span>`;
  const f = estado.fecha;
  if (estado.vista === 'mes') {
    $('#titulo').textContent = fmt(f, { month: 'long', year: 'numeric' });
    renderMes();
  } else if (estado.vista === 'semana') {
    const l = lunes(f), d = sumarDias(l, 6);
    $('#titulo').textContent = l.getMonth() === d.getMonth()
      ? `${l.getDate()} – ${d.getDate()} ${fmt(d, { month: 'long', year: 'numeric' })}`
      : `${fmt(l, { day: 'numeric', month: 'short' })} – ${fmt(d, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    renderRejilla(Array.from({ length: 7 }, (_, i) => sumarDias(l, i)));
  } else {
    $('#titulo').textContent = fmt(f, { weekday: 'long', day: 'numeric', month: 'long' });
    renderRejilla([f]);
  }
}

function diaConAlerta(fechaIso) {
  const lista = activas(delDia(fechaIso));
  return lista.some(r => analizarMargenes(r, lista, estado.config.margenMin).length > 0);
}

function renderMes() {
  const f = estado.fecha;
  const primero = new Date(f.getFullYear(), f.getMonth(), 1);
  const inicio = lunes(primero);
  let html = '<div class="mes">' + DIAS.map(d => `<div class="dsem">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = sumarDias(inicio, i);
    const di = iso(d);
    const lista = delDia(di);
    const clases = ['dia', d.getMonth() !== f.getMonth() && 'fuera', mismoDia(d, hoy()) && 'hoy'].filter(Boolean).join(' ');
    html += `<div class="${clases}" data-fecha="${di}">
      <div class="num"><b>${d.getDate()}</b>${diaConAlerta(di) ? '<span class="alerta-dia" title="Reservas con poco margen">⚠</span>' : ''}</div>
      ${lista.slice(0, 3).map(r => `<div class="chip ${r.estado}" style="--c:${plan(r.planId).color}" data-id="${r.id}">${r.hora} ${esc(r.cliente)} · ${r.personas}p</div>`).join('')}
      ${lista.length > 3 ? `<div class="mas">+${lista.length - 3} más</div>` : ''}
    </div>`;
    if (i === 34 && sumarDias(inicio, 35).getMonth() !== f.getMonth()) break; // 5 semanas bastan
  }
  $('#calendario').innerHTML = html + '</div>';
}

/** Rango de horas visible: horario de atención ampliado para que quepan todas las reservas. */
function rangoMinutos(dias) {
  let ini = aMinutos(estado.config.apertura) - 60;
  let fin = aMinutos(estado.config.cierre);
  if (fin <= ini) fin += 1440;
  fin += 60;
  for (const d of dias) for (const r of delDia(iso(d))) {
    const m = aMinutos(r.hora);
    ini = Math.min(ini, m);
    fin = Math.max(fin, m + r.duracionMin);
  }
  ini = Math.max(0, Math.floor(ini / 60) * 60);
  fin = Math.min(1440 + 360, Math.ceil(fin / 60) * 60);
  return [ini, fin];
}

/** Asigna carriles a reservas que se cruzan para dibujarlas lado a lado. */
function carriles(lista) {
  const out = new Map();
  let grupo = [], finGrupo = -1;
  const cerrar = () => {
    const lanes = [];
    for (const r of grupo) {
      const ini = aMinutos(r.hora);
      let k = lanes.findIndex(f => f <= ini);
      if (k < 0) { k = lanes.length; lanes.push(0); }
      lanes[k] = ini + r.duracionMin;
      out.set(r.id, { k, n: 0 });
    }
    for (const r of grupo) out.get(r.id).n = lanes.length;
    grupo = []; finGrupo = -1;
  };
  for (const r of lista) {
    const ini = aMinutos(r.hora);
    if (grupo.length && ini >= finGrupo) cerrar();
    grupo.push(r); finGrupo = Math.max(finGrupo, ini + r.duracionMin);
  }
  if (grupo.length) cerrar();
  return out;
}

function renderRejilla(dias) {
  const [ini, fin] = rangoMinutos(dias);
  const alto = (fin - ini) / 60 * HORA_PX;
  const y = m => (m - ini) / 60 * HORA_PX;
  const margen = estado.config.margenMin;

  let html = `<div class="rejilla-scroll" style="overflow-x:auto"><div class="rejilla" style="grid-template-columns:52px repeat(${dias.length}, minmax(${dias.length > 1 ? 92 : 0}px, 1fr))">`;
  html += '<div class="cab"><div></div>' + dias.map(d =>
    `<div class="${mismoDia(d, hoy()) ? 'hoy' : ''}" data-ir="${iso(d)}">${DIAS[(d.getDay() + 6) % 7]}<b>${d.getDate()}</b></div>`).join('') + '</div>';

  html += `<div class="horas" style="height:${alto}px">`;
  for (let m = ini + 60; m < fin; m += 60) html += `<span style="top:${y(m)}px">${aHora(m)}</span>`;
  html += '</div>';

  for (const d of dias) {
    const di = iso(d);
    const lista = delDia(di);
    const lanes = carriles(lista);
    html += `<div class="col ${mismoDia(d, hoy()) ? 'hoy' : ''}" data-fecha="${di}" data-ini="${ini}" style="height:${alto}px">`;

    // Separaciones cortas o cruces entre reservas consecutivas
    const act = activas(lista);
    for (let i = 1; i < act.length; i++) {
      const prevFin = Math.max(...act.slice(0, i).map(r => aMinutos(r.hora) + r.duracionMin));
      const sigIni = aMinutos(act[i].hora);
      const brecha = sigIni - prevFin;
      if (brecha >= margen) continue;
      if (brecha < 0) {
        html += `<div class="brecha solapa" style="top:${y(sigIni)}px;height:${Math.max(14, -brecha / 60 * HORA_PX)}px" title="Reservas cruzadas">⚠ cruce ${-brecha} min</div>`;
      } else {
        html += `<div class="brecha" style="top:${y(prevFin) - (brecha === 0 ? 7 : 0)}px;height:${Math.max(14, brecha / 60 * HORA_PX)}px" title="Se recomienda al menos ${margen} min">⚠ ${brecha} min</div>`;
      }
    }

    for (const r of lista) {
      const p = plan(r.planId);
      const m = aMinutos(r.hora);
      const { k, n } = lanes.get(r.id);
      const ancho = 100 / n;
      html += `<div class="bloque ${r.estado}" data-id="${r.id}"
        style="--c:${p.color};top:${y(m)}px;height:${Math.max(22, r.duracionMin / 60 * HORA_PX - 2)}px;left:calc(${k * ancho}% + 3px);right:auto;width:calc(${ancho}% - 6px)"
        title="${esc(`${r.cliente} · ${p.nombre} · ${r.personas} personas · ${r.hora}–${horaFin(r)}`)}">
        <strong>${esc(r.cliente)}</strong>
        <small>${r.hora}–${horaFin(r)} · ${r.personas}p</small>
        <small>${esc(p.nombre)}${r.estado !== 'confirmada' ? ' · ' + r.estado : ''}</small>
      </div>`;
    }
    if (mismoDia(d, hoy())) {
      const ahora = new Date(); const am = ahora.getHours() * 60 + ahora.getMinutes();
      if (am > ini && am < fin) html += `<div class="ahora" style="top:${y(am)}px"></div>`;
    }
    html += '</div>';
  }
  html += '</div></div>';
  if (dias.length === 1 && !delDia(iso(dias[0])).length) html += '<p class="vacio">Sin reservas este día. Toque un horario para agregar una.</p>';
  $('#calendario').innerHTML = html;
}

/* ---------- eventos del calendario ---------- */
$('#calendario').addEventListener('click', e => {
  const item = e.target.closest('[data-id]');
  if (item) { abrirReserva(estado.reservas.find(r => r.id === item.dataset.id)); return; }
  const ir = e.target.closest('[data-ir]');
  if (ir) { estado.fecha = deIso(ir.dataset.ir); estado.vista = 'dia'; render(); return; }
  const dia = e.target.closest('.mes .dia');
  if (dia) { estado.fecha = deIso(dia.dataset.fecha); estado.vista = 'dia'; render(); return; }
  const col = e.target.closest('.col');
  if (col) {
    const rect = col.getBoundingClientRect();
    const min = Number(col.dataset.ini) + (e.clientY - rect.top) / HORA_PX * 60;
    const hora = aHora(Math.min(1425, Math.floor(min / 30) * 30));
    abrirReserva(null, { fecha: col.dataset.fecha, hora });
  }
});

document.querySelectorAll('.vistas button').forEach(b => b.addEventListener('click', () => { estado.vista = b.dataset.vista; render(); }));
$('#btnHoy').onclick = () => { estado.fecha = hoy(); render(); };
function mover(dir) {
  const f = estado.fecha;
  if (estado.vista === 'mes') estado.fecha = new Date(f.getFullYear(), f.getMonth() + dir, 1);
  else estado.fecha = sumarDias(f, estado.vista === 'semana' ? 7 * dir : dir);
  render();
}
$('#btnPrev').onclick = () => mover(-1);
$('#btnSig').onclick = () => mover(1);
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || e.target.matches('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') mover(-1);
  if (e.key === 'ArrowRight') mover(1);
  if (e.key === 'n') abrirReserva();
});

/* ---------- formulario de reserva ---------- */
const dlg = $('#dlgReserva');
const form = $('#formReserva');
dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-cerrar]')) dlg.close(); });

function opcionesDuracion(valor) {
  const ops = [];
  for (let m = 30; m <= 360; m += 30) ops.push(m);
  if (valor && !ops.includes(valor)) ops.push(valor), ops.sort((a, b) => a - b);
  form.duracionMin.innerHTML = ops.map(m => `<option value="${m}">${durTexto(m)}</option>`).join('');
}

function abrirReserva(r = null, base = {}) {
  estado.editando = r;
  estado.duracionTocada = !!r;
  const planes = estado.config.planes;
  form.planId.innerHTML = [...porCategoria(planes)].map(([cat, ps]) => `<optgroup label="${esc(cat)}">${ps.map(p =>
    `<option value="${p.id}">${esc(p.nombre)}${p.precio != null ? ` — ${usd(p.precio)} p/p` : ''}${p.minPersonas ? ` · desde ${p.minPersonas}` : ''}</option>`).join('')}</optgroup>`).join('');
  const v = r || {
    planId: planes[0]?.id, personas: planes[0]?.minPersonas || 2, cliente: '', telefono: '', notas: '', lugar: '', adicionales: [], estado: 'confirmada',
    fecha: base.fecha || iso(estado.vista === 'mes' ? (mismoDia(estado.fecha, hoy()) || estado.fecha < hoy() ? hoy() : estado.fecha) : estado.fecha),
    hora: base.hora || '20:00',
    duracionMin: planes[0]?.duracionMin || 120,
  };
  opcionesDuracion(v.duracionMin);
  for (const k of ['planId', 'personas', 'cliente', 'telefono', 'notas', 'lugar', 'fecha', 'hora', 'duracionMin', 'estado']) form[k].value = v[k] ?? '';
  renderAdicionales(v.adicionales || []);
  $('#dlgTitulo').textContent = r ? 'Editar reserva' : 'Nueva reserva';
  $('#btnEliminar').hidden = !r;
  $('#campoEstado').hidden = !r;
  $('#errores').textContent = '';
  actualizarAvisos();
  dlg.showModal();
  if (!r) setTimeout(() => form.cliente.focus(), 50);
}

function renderAdicionales(marcados) {
  const ads = plan(form.planId.value).adicionales || [];
  const caja = $('#campoAdicionales');
  caja.hidden = !ads.length;
  caja.innerHTML = ads.length ? '<span>Adicionales</span>' + ads.map(a =>
    `<label class="check"><input type="checkbox" name="adicionales" value="${a.id}" ${marcados.includes(a.id) ? 'checked' : ''}> ${esc(a.nombre)} (+${usd(a.precio)} p/p)</label>`).join('') : '';
}

function leerForm() {
  const fdata = new FormData(form);
  const fd = Object.fromEntries(fdata);
  return { ...fd, adicionales: fdata.getAll('adicionales'), id: estado.editando?.id || '__nueva__', personas: Number(fd.personas), duracionMin: Number(fd.duracionMin), estado: fd.estado || 'confirmada' };
}

function actualizarResumen(r) {
  const p = plan(r.planId);
  const c = cotizar(r, p, estado.config);
  const notas = avisosPersonas(r, p);
  let html = '';
  if (c.total != null && r.personas > 0) {
    html += `<div class="cifras"><span>${r.personas} × ${usd(c.porPersona)}</span><b>Total estimado ${usd(c.total)}</b>`
      + (c.pagoTotal
        ? `<span class="pago-total">Faltan ${Math.max(0, c.diasFaltan)} día(s): cobrar el total por adelantado</span>`
        : `<span>Anticipo ${estado.config.anticipoPct}%: <b>${usd(c.anticipo)}</b></span>`) + '</div>';
  } else if (p.precio == null) {
    html += '<div class="cifras"><span>Este plan no tiene precio cargado.</span></div>';
  }
  if (p.categoria === 'Catering / buffet') html += '<p class="nota">Meseros se cotizan aparte.</p>';
  if (r.personas > 50 && p.categoria !== 'Agasajos navideños') html += '<p class="nota">Más de 50 personas: puede ofrecer prueba de menú gratis.</p>';
  html += notas.map(n => `<p class="nota aviso">⚠ ${esc(n)} Se puede adaptar si usted lo decide.</p>`).join('');
  $('#resumen').innerHTML = html;
}

function actualizarAvisos() {
  const caja = $('#avisos');
  const r = leerForm();
  actualizarResumen(r);
  caja.className = 'avisos';
  caja.innerHTML = '';
  $('#btnGuardar').textContent = 'Guardar';
  if (!r.fecha || !r.hora || !r.duracionMin || r.estado === 'cancelada') return;
  const avisos = analizarMargenes(r, estado.reservas, estado.config.margenMin);
  if (!avisos.length) return;
  const cruce = avisos.some(a => a.tipo === 'solapa');
  const otras = estado.reservas.filter(x => x.id !== r.id);
  const libres = horariosDisponibles(r.fecha, r.duracionMin, otras, estado.config);
  const objetivo = aMinutos(r.hora);
  const cercanos = libres.sort((a, b) => Math.abs(aMinutos(a) - objetivo) - Math.abs(aMinutos(b) - objetivo)).slice(0, 4)
    .sort((a, b) => aMinutos(a) - aMinutos(b));
  caja.classList.toggle('solapa', cruce);
  caja.innerHTML = `<h4>${cruce ? '⚠ Horario cruzado' : '⚠ Poco margen entre reservas'}</h4>
    <ul>${avisos.map(a => `<li>${esc(describirAviso(a, estado.config.planes))}</li>`).join('')}</ul>
    <div class="sugerencias">${cercanos.length
      ? `<span>Horarios con margen de ${durTexto(estado.config.margenMin)}:</span>` + cercanos.map(h => `<button type="button" data-hora="${h}">${h}</button>`).join('')
      : '<span>No hay horarios con el margen recomendado este día.</span>'}</div>`;
  $('#btnGuardar').textContent = 'Guardar de todos modos';
}

function alCambiar(e) {
  if (e.target.name === 'duracionMin') estado.duracionTocada = true;
  if (e.target.name === 'planId') {
    renderAdicionales([]);
    const d = plan(form.planId.value).duracionMin;
    if (d && !estado.duracionTocada) { opcionesDuracion(d); form.duracionMin.value = d; }
  }
  actualizarAvisos();
}
form.addEventListener('input', alCambiar);
form.addEventListener('change', alCambiar);
$('#avisos').addEventListener('click', e => {
  const b = e.target.closest('[data-hora]');
  if (b) { form.hora.value = b.dataset.hora; actualizarAvisos(); }
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const datos = leerForm();
  const errores = validarReserva(datos, estado.config.planes);
  if (errores.length) { $('#errores').innerHTML = errores.map(esc).join('<br>'); return; }
  const previa = estado.editando;
  const r = normalizarReserva({ ...previa, ...datos, id: previa?.id, creadoEn: previa?.creadoEn, origen: previa?.origen });
  await almacen.guardarReserva(r);
  estado.reservas = await almacen.listarReservas();
  dlg.close();
  estado.fecha = deIso(r.fecha);
  render();
  toast(previa ? 'Reserva actualizada' : `Reserva de ${r.cliente} guardada`);
});

$('#btnEliminar').onclick = async () => {
  const r = estado.editando;
  if (!r || !confirm(`¿Eliminar la reserva de ${r.cliente}? Esta acción no se puede deshacer.\n\nSi solo se canceló, puede cambiar el estado a "Cancelada".`)) return;
  await almacen.eliminarReserva(r.id);
  estado.reservas = await almacen.listarReservas();
  dlg.close(); render(); toast('Reserva eliminada');
};
$('#btnNueva').onclick = () => abrirReserva();

/* ---------- configuración ---------- */
const dlgC = $('#dlgConfig');
const formC = $('#formConfig');
dlgC.addEventListener('click', e => { if (e.target === dlgC || e.target.closest('[data-cerrar]')) dlgC.close(); });

function filaPlan(p) {
  const div = document.createElement('div');
  div.className = 'fila-plan';
  div.dataset.id = p.id;
  let ops = '';
  for (let m = 30; m <= 360; m += 30) ops += `<option value="${m}" ${m === p.duracionMin ? 'selected' : ''}>${durTexto(m)}</option>`;
  div._adicionales = p.adicionales || [];
  div.innerHTML = `<input type="color" name="color" value="${p.color}" aria-label="Color">
    <input type="text" name="nombre" value="${esc(p.nombre)}" placeholder="Nombre del plan" aria-label="Nombre del plan">
    <button type="button" aria-label="Quitar plan" title="Quitar plan">×</button>
    <div class="fila-plan-2">
      <input type="text" name="categoria" value="${esc(p.categoria || '')}" placeholder="Categoría" aria-label="Categoría">
      <input type="number" name="precio" value="${p.precio ?? ''}" min="0" step="0.5" placeholder="$ p/p" aria-label="Precio por persona">
      <input type="number" name="minPersonas" value="${p.minPersonas ?? ''}" min="1" placeholder="Mín." aria-label="Mínimo de personas">
      <input type="number" name="maxPersonas" value="${p.maxPersonas ?? ''}" min="1" placeholder="Máx." aria-label="Máximo de personas">
      <select name="duracionMin" aria-label="Duración sugerida">${ops}</select>
    </div>`;
  div.querySelector('button').onclick = () => {
    const usadas = estado.reservas.filter(r => r.planId === p.id).length;
    if (usadas) { toast(`No se puede quitar: ${usadas} reserva(s) usan este plan`); return; }
    div.remove();
  };
  return div;
}

$('#btnConfig').onclick = () => {
  const c = estado.config;
  const lista = $('#listaPlanes'); lista.innerHTML = '';
  c.planes.forEach(p => lista.appendChild(filaPlan(p)));
  formC.apertura.value = c.apertura; formC.cierre.value = c.cierre; formC.margenMin.value = c.margenMin;
  formC.anticipoPct.value = c.anticipoPct; formC.diasPagoTotal.value = c.diasPagoTotal;
  dlgC.showModal();
};
const PALETA = ['#C9A227', '#3E7CB1', '#8E3B46', '#4F9D69', '#9B6BC2', '#D9774B', '#3FA7A3'];
$('#btnAgregarPlan').onclick = () => {
  const n = $('#listaPlanes').children.length;
  $('#listaPlanes').appendChild(filaPlan({ id: 'plan-' + nuevoId().slice(0, 8), nombre: '', color: PALETA[n % PALETA.length], duracionMin: 120 }));
};
formC.addEventListener('submit', async e => {
  e.preventDefault();
  const num = v => (v === '' || v == null ? null : Number(v));
  const planes = [...$('#listaPlanes').children].map(f => {
    const v = n => f.querySelector(`[name=${n}]`).value;
    const p = {
      id: f.dataset.id, nombre: v('nombre').trim() || 'Plan sin nombre', categoria: v('categoria').trim() || 'Otros',
      color: v('color'), precio: num(v('precio')), duracionMin: Number(v('duracionMin')),
    };
    if (num(v('minPersonas'))) p.minPersonas = num(v('minPersonas'));
    if (num(v('maxPersonas'))) p.maxPersonas = num(v('maxPersonas'));
    if (f._adicionales.length) p.adicionales = f._adicionales;
    return p;
  });
  if (!planes.length) { toast('Debe existir al menos un plan'); return; }
  estado.config = await almacen.guardarConfig({
    planes, apertura: formC.apertura.value || '12:00', cierre: formC.cierre.value || '23:00',
    margenMin: Math.max(0, num(formC.margenMin.value) ?? 60),
    anticipoPct: Math.min(100, Math.max(0, num(formC.anticipoPct.value) ?? 25)),
    diasPagoTotal: Math.max(0, num(formC.diasPagoTotal.value) ?? 7),
  });
  dlgC.close(); render(); toast('Configuración guardada');
});

$('#btnExportar').onclick = async () => {
  const datos = await almacen.exportar();
  const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `tbs-reservas-${iso(hoy())}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#inpImportar').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const datos = JSON.parse(await f.text());
    if (!confirm(`Se reemplazarán las reservas actuales por ${datos.reservas?.length ?? 0} del respaldo. ¿Continuar?`)) return;
    await almacen.importar(datos);
    estado.config = await almacen.leerConfig();
    estado.reservas = await almacen.listarReservas();
    dlgC.close(); render(); toast('Datos importados');
  } catch (err) { toast('No se pudo importar: ' + err.message); }
};

/* ---------- arranque ---------- */
(async () => {
  estado.config = await almacen.leerConfig();
  estado.reservas = await almacen.listarReservas();
  render();
  setInterval(() => { if (estado.vista !== 'mes' && !document.querySelector('dialog[open]')) render(); }, 60000);
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err)));
}
