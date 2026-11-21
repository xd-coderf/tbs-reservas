# TBS Reservas (PWA)

Agenda de reservas de TBS Smoked & Grill. Funciona sin conexión y se puede instalar en el celular o el PC.

## Uso

- **+ Nueva reserva**: plan, personas, nombre del cliente, fecha, horario y duración estimada (teléfono y notas son opcionales).
- Al elegir un plan, la duración se completa sola con la duración sugerida del plan.
- Si entre una reserva y otra quedan **menos de 1 h**, la app lo avisa al guardar y propone horarios cercanos que sí respetan el margen. En el calendario esos huecos aparecen como franjas punteadas ámbar, y los cruces de horario en rojo.
- Vistas **Día / Semana / Mes**. Cada plan tiene su color (se cambia en ⚙ *Planes y horario*).
- Toque un horario vacío en la vista Día o Semana para crear una reserva a esa hora.
- ⚙ también permite **exportar/importar** un respaldo en JSON.

> Los datos se guardan en el navegador del dispositivo. Haga respaldos periódicos hasta que exista el servidor (ver abajo).

## Ejecutar en local

```bash
py -m http.server 8080
```
y abrir `http://localhost:8080`. Para instalarla en el celular hace falta publicarla con HTTPS (por ejemplo GitHub Pages o Netlify).

## Estructura

| Archivo | Qué hace |
|---|---|
| `core/reservas.js` | Reglas de negocio puras: validación, márgenes entre reservas, horarios libres. Sin DOM; corre igual en el navegador y en Node. |
| `core/almacen.js` | Almacenamiento intercambiable: `AlmacenLocal` (hoy) y `AlmacenRemoto` (cuando exista la API). |
| `app.js`, `index.html`, `styles.css` | Interfaz (calendario y formularios). |
| `sw.js`, `manifest.webmanifest`, `icons/` | Lo que la hace PWA (instalable y sin conexión). |
| `api/openapi.yaml` | Contrato de la futura API del servidor. |
| `api/herramientas-claude.json` | Herramientas que usará el asistente de WhatsApp. |

## Plan: asistente de WhatsApp que organiza los horarios solo

```
Cliente ──WhatsApp──► WhatsApp Cloud API (Meta) ──webhook──► Servidor TBS
                                                              │
                                    ┌─────────────────────────┤
                                    ▼                         ▼
                         Claude (claude-opus-5-5)      core/reservas.js + base de datos
                         con las herramientas de       (las mismas reglas que la PWA)
                         api/herramientas-claude.json
                                    │
                                    └──► respuesta al cliente por WhatsApp
PWA ◄── AlmacenRemoto ──► /reservas, /config (api/openapi.yaml)
```

Lo que ya queda listo:
1. **Reglas en un solo lugar** (`core/reservas.js`): `horariosDisponibles()` es lo que el bot usará para proponer horarios con 1 h de margen; `analizarMargenes()` y `describirAviso()` dan los mismos avisos que ve el encargado.
2. **Modelo de datos con `origen` y `estado`**: el bot creará reservas con `origen: "whatsapp"` y `estado: "pendiente"`, para que usted las confirme desde la PWA.
3. **Almacenamiento intercambiable**: cambiar `new AlmacenLocal()` por `new AlmacenRemoto(url, token)` en `app.js` conecta la PWA al servidor sin tocar la interfaz.
4. **Contrato de API y herramientas del asistente** ya definidos.

Lo que falta para esa etapa:
- Un servidor (Node) con base de datos que implemente `api/openapi.yaml` reutilizando `core/`.
- Cuenta de WhatsApp Business Platform (Meta) con el número de TBS, y una clave de la API de Claude.
- Definir los planes reales, el horario y el tono de las respuestas del asistente.
- Migrar las reservas existentes con *Exportar datos* → importar en el servidor.
