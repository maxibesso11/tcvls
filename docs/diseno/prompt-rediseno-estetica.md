# Prompt — Rediseño visual de TCV LogiSuite (estética "tablero de despacho")

> Copiá todo este archivo como prompt. Está pensado para Claude Code (o cualquier agente) trabajando dentro del repo `tcv-logisuite-erp`. El CSS del final es la fuente de verdad: va **tal cual**, sin reinterpretarlo.

---

## Contexto

Estás trabajando en **TCV LogiSuite**, un ERP de transporte (viajes, flota, costos, cobranzas). Frontend en **HTML + CSS + JavaScript puro**, sin frameworks ni bundler: las vistas se arman como strings de HTML en `frontend/js/vistas/*.js` y `frontend/index.html` carga un solo CSS: `/stylo/main.css`.

La referencia visual exacta es el prototipo `docs/diseno/prototipo-rediseno.html` (abrilo en el navegador). El resultado tiene que verse **idéntico**: mismos colores, tipografías, tamaños, espaciados, bordes y comportamiento responsive.

## Objetivo

1. Reemplazar el contenido de `frontend/stylo/` por la estructura de abajo, con los archivos **copiados textualmente** del Anexo.
2. Migrar el markup que generan `index.html` y `js/vistas/*.js` a las clases nuevas (tabla de equivalencias más abajo), sin cambiar ninguna funcionalidad, endpoint ni lógica.
3. Borrar `frontend/css/styles.css` y cualquier estilo inline (`style="..."`) que pise colores, fuentes o espacios: todo sale de los tokens.

Trabajá en una rama `redisenio`. No toques el backend.

## Estructura de `frontend/stylo/`

```
frontend/stylo/
├── main.css                  ← único archivo que carga index.html (solo @import, en orden)
├── base/
│   ├── fuentes.css           ← Google Fonts: Barlow Condensed, Archivo, IBM Plex Mono
│   ├── tokens.css            ← TODAS las variables (color, espacio, radio, sombra, familias)
│   ├── temas.css             ← 13 temas de Apariencia: cada uno redefine 6 variables
│   └── reset.css             ← box-sizing, body, foco, reduced-motion
├── componentes/              ← un archivo por componente, sin dependencias entre sí
│   ├── utilidades.css  boton.css  patente.css  insignia.css  cifra.css  hoja.css
│   ├── tabla.css  tabs.css  campo.css  alerta.css  composicion.css  rail.css
│   └── ficha.css  modal.css  capas.css
├── layout/
│   ├── app.css               ← esqueleto: rail + barra superior + vista
│   └── responsive.css        ← TODOS los @media (1280 / 1100 / 900 / 640). Va último.
└── vistas/                   ← lo específico de cada pantalla
    ├── tablero.css  unidades.css  viajes.css  agenda.css  configuracion.css  admin.css
```

Reglas de organización:
- **Ningún archivo fuera de `base/tokens.css` y `base/temas.css` escribe un color hex, una fuente o un radio literal.** Siempre `var(--…)`. (Excepciones ya presentes en el Anexo: el blanco del texto sobre `danger-fill` y los grises del esquema de cubiertas.)
- Componentes: no conocen vistas. Vistas: pueden componer componentes, nunca redefinirlos.
- Media queries solo en `layout/responsive.css`.
- Al cambiar CSS, actualizar `?v=` del `<link>` de `main.css` en `index.html`.

## Principios de la estética (respetalos al escribir markup nuevo)

1. **Tablero de despacho, no plantilla de admin.** Nada de tarjetas redondeadas con sombra para cada KPI. Las hojas se separan con bordes de 1px (`--line`), nunca con sombra. Sombra (`--shadow-pop`) solo en modal, menú y toast.
2. **Papel + tinta.** Fondo de página `--paper` (#f3f4f1), todo dato sobre `--surface` (blanco). Texto `--ink` / `--ink-2` / `--ink-3`.
3. **El tema solo pinta el rail y el acento.** Estados (ok/aviso/peligro/info) y gráficos son fijos.
4. **Cifras grandes en Barlow Condensed**, interfaz en Archivo, códigos (CUIT, comprobantes, remitos) en IBM Plex Mono. Números siempre tabulares y alineados a la derecha en tablas.
5. **La patente Mercosur es la identidad de cada unidad.** Donde aparezca una unidad, aparece su `.patente`, nunca un ID.
6. **Radios chicos:** 2px (insignias, patente, barras), 4px (botones, campos, hojas), 8px (solo modal/menú).
7. **Color nunca solo:** toda insignia lleva palabra. Ingresos en azul (`--chart-income`), costos en naranja (`--chart-cost`); nunca verde contra rojo.
8. **Voz:** castellano rioplatense con voseo ("Cargá", "Elegí"), botones = verbo + objeto ("Facturar viaje"), estados en MAYÚSCULAS dentro de insignias, sin emoji (íconos SVG de línea 24×24, trazo 2, `stroke="currentColor"`).
9. **Formatos es-AR:** `$ 8.420.000` en tablas, `$ 18,4 M` en cifras grandes, `2,41 km/L`, fechas `06/10/2026`, negativos con signo menos real (−).

## Esqueleto de `index.html`

```html
<link rel="stylesheet" href="/stylo/main.css?v=AAAAMMDD">
...
<div class="app">
  <nav class="rail" id="rail" aria-label="Navegación principal">
    <div class="rail-marca"><img src="/img/logo/isotipo.svg" alt=""><div><b>3 de Abril SAS</b><span>TCV LogiSuite</span></div></div>
    <div class="rail-grupo">Operación</div>
    <a href="#tablero" aria-current="page"><svg …/>Tablero</a>
    <a href="#viajes"><svg …/>Viajes<span class="cuenta">6</span></a>
    …  (grupos: Operación · Flota · Costos · Finanzas · Empresa; para ADMIN: Plataforma)
    <div class="rail-pie">…</div>
  </nav>
  <div class="principal">
    <header class="barra-sup">
      <button class="btn btn-fantasma btn-menu" id="btn-menu">☰ como SVG</button>
      <div class="buscar"><svg …/><input class="entrada" placeholder="Buscar patente, chofer, remito o cuenta"></div>
      <div class="espacio"></div>
      <div class="segmentado"><button aria-pressed="true">Mes</button><button aria-pressed="false">Trimestre</button><button aria-pressed="false">Año</button></div>
      <button class="btn btn-fantasma campana"><svg …/><span class="punto">24</span></button>
      <div class="usuario"><b>Betiana Ríos</b><span>ADMIN_EMPRESA</span></div>
    </header>
    <main class="vista" id="contenido"></main>
  </div>
</div>
<div class="fondo-modal" id="modal-fondo" hidden><div class="modal">…</div></div>
<div class="toast" id="toast" hidden></div>
```
En móvil (≤900px) el rail es un cajón: alternar la clase `menu-abierto` en `.app`.

## Patrones de markup (exactos)

**Cabecera de vista**
```html
<div class="vista-cab">
  <div><div class="migas"><button>Unidades</button> / AE 412 KD</div><h1>Tablero</h1><p>Septiembre 2026 · comparado con agosto.</p></div>
  <div class="acciones"><button class="btn">Exportar</button><button class="btn btn-primario">+ Nuevo viaje</button></div>
</div>
```
**Botones:** `.btn` (secundario) · `.btn-primario` (uno por vista) · `.btn-tinta` (avanzar un flujo) · `.btn-fantasma` · `.btn-peligro` · `.btn-chico` (dentro de tablas).

**Patente:** `<span class="patente"><b>AE 412 KD</b></span>` + modificador `patente-chica` (filas) o `patente-grande` (cabecera de ficha). Un equipo = dos patentes juntas con `gap:4px`.

**Insignia:** `<span class="insignia info">EN CURSO</span>` → EN CURSO `info` · EN DESTINO `aviso` · FINALIZADO `ok` · FACTURADO `marca` · vencido `peligro` · categorías `sin-punto`.

**Cifra y Pulso (reemplazan `.kpi-grid/.kpi`)**
```html
<div class="pulso tablero">   <!-- "tablero" solo en el dashboard: 1ª cifra más ancha -->
  <div class="cifra cifra-xl"><span class="rotulo">Resultado neto · septiembre 2026</span>
    <span class="cifra-valor">$ 12,7 M</span>
    <span class="cifra-delta sube">▲ 12,3% <span class="tenue">vs agosto</span></span>
    <svg class="cifra-traza" viewBox="-3 0 126 28" preserveAspectRatio="none"><path d="M0 20 L24 16 …"/><circle cx="120" cy="6" r="2.5"/></svg>
  </div>
  <div class="cifra"><span class="rotulo">Rendimiento</span><span class="cifra-valor">2,37<small>km/L</small></span><span class="cifra-delta baja">▼ 0,07 <span class="tenue">vs agosto</span></span></div>
</div>
```
`sube`/`baja` = bueno/malo, no dirección (más costos → `baja`).

**Hoja (reemplaza `.panel`)**
```html
<section class="hoja">
  <header class="hoja-cabecera"><div><h2 class="hoja-titulo">Rentabilidad por equipo</h2><div class="hoja-sub">Período · cómo se calcula</div></div><button class="btn btn-chico">Ampliar</button></header>
  <div class="hoja-cuerpo">…</div>      <!-- o una tabla directa, a sangre -->
  <footer class="hoja-pie">y 12 más — <a href="#">ver todos</a></footer>
</section>
```

**Tabla:** `<div class="tabla-marco"><table class="tabla">` · `th.num/td.num` para números · `td.fuerte` · `tr.clic` (la fila entera abre la ficha; sin menú "…") · totales en `<tfoot>`. Barra inline: `<div class="barra"><i style="width:39%"></i></div>`, `.barra.costo` naranja; doble: `<div class="barra-doble"><div class="barra izq costo"><i style="width:40%"></i></div><div class="barra"><i style="width:70%"></i></div></div>`.

**Tabs:** `<div class="tabs" role="tablist"><button class="tab" role="tab" aria-selected="true">Resumen</button><button class="tab" aria-selected="false">Cubiertas <span class="cuenta peligro">2</span></button></div>`. Selector de período: `.segmentado > button[aria-pressed]`.

**Campo:** `<div class="formulario"><div class="campo"><label for="x">Patente</label><input id="x"><span class="ayuda">…</span></div><div class="campo ancho">…</div></div>` · error: `.campo.error`.

**Alerta (reemplaza `.alerta-item`)**
```html
<ul class="alertas">
  <li class="alerta vencida"><div class="alerta-dias">−6<small>días</small></div>
    <div class="alerta-texto"><strong>RTO · <span class="patente patente-chica"><b>AE 412 KD</b></span></strong><span>Vencimiento documental · 06/10/2026</span></div>
    <button class="btn btn-chico">Renovar</button></li>
</ul>
```
`.vencida` si días < 0 · `.pronto` si ≤ 7 · sin clase si más.

**Composición del equipo:** `.composicion > .comp-pieza(.actual) [svg.comp-silueta + patente] · .comp-enganche · .comp-pieza · .comp-chofer`. Siluetas SVG: tractor `viewBox="0 0 92 46"` (caja `rect.caja`, `path.cabina`, `circle.rueda` + `circle.llanta`), acoplado `viewBox="0 0 120 46"` con 3 ruedas.

**Ficha (detalle de unidad, chofer, cuenta, empresa)**
```html
<div class="ficha-pila">
  <header class="ficha-cabecera"><span class="patente patente-grande"><b>AE 412 KD</b></span>
    <div style="flex:1;min-width:220px"><div class="display-m">Scania R450 · 2019</div><div class="marcas">…insignias…</div></div>
    <div class="ficha-datos"><div class="ficha-dato"><span class="rotulo">Chofer</span><b>Ramón Ledesma</b></div>…</div>
    <div class="acciones">…</div></header>
  <nav class="ficha-tabs"><div class="tabs" style="border:0">…</div></nav>
  <div class="ficha-cuerpo">…contenido de la pestaña…</div>
</div>
```

**Modal:** `.modal > .modal-cabecera(h2 + cerrar) · .modal-cuerpo · .modal-pie(Cancelar .btn-fantasma + .btn-primario)`. Reemplazar todos los `confirm()` por un modal con `.btn-peligro`.

**Grillas de vista:** `.grilla-2` (1.15fr / 1fr), `.grilla-2-iguales`, `.grilla-3`, `.pila`. Vistas específicas: `.unidades > button.unidad-ficha`, `.flota-fila`, `.tramos` + `.tramos-ref`, `.ejes > .ejes-chasis > .eje > .lado > button.cubierta.estado-{nueva|buena|recapada|cambiar}`, `.semana > .agenda-item`, `.temas > button.tema`, `table.tabla.matriz`.

## Gráficos

Reemplazar Chart.js por **SVG dibujado a mano** con clase `.grafico` (texto `fill: var(--ink-2)`, valores `.valor` en Barlow, grilla `.eje`, línea base `.base`). Tipos usados:
- **Cascada** de resultado: Ingresos (azul) → cada costo (naranja, flotando) → Resultado (verde si ≥0, `--danger-fill` si <0). Conectores punteados `--ink-3`, % sobre ingresos debajo del rótulo.
- **Barra doble** en tabla de rentabilidad (costos ← | → ingresos).
- **Puntos vs promedio** para km/L: línea vertical punteada en el promedio, segmento + punto por equipo (azul arriba del promedio, naranja abajo).
- **Columnas agrupadas** ingresos/costos por mes.
- **Traza** (sparkline) dentro de `.cifra`.
- Nunca tortas ni donas. Gráficos anchos dentro de `.tabla-marco` con `min-width`.

## Temas de Apariencia

En `js/nucleo/sesion.js`, `TEMAS` pasa a ser (mismo orden, `tcv` primero y por defecto en `aplicarTema`):
```js
const TEMAS = [
  { id: 'tcv', nombre: 'TCV', rail: '#16386b', rail2: '#1c4789', acento: '#38b6ff' },
  { id: 'verde', nombre: 'Verde pizarra', rail: '#1d2f29', rail2: '#2b453c', acento: '#e8a13c' },
  { id: 'azul', nombre: 'Azul noche', rail: '#1a2940', rail2: '#243959', acento: '#4f9dde' },
  { id: 'violeta', nombre: 'Violeta', rail: '#2f2046', rail2: '#3f2b5e', acento: '#a779e0' },
  { id: 'borgona', nombre: 'Borgoña', rail: '#3c1d22', rail2: '#542930', acento: '#d98f6b' },
  { id: 'grafito', nombre: 'Grafito', rail: '#292a2d', rail2: '#3a3b40', acento: '#d6a85c' },
  { id: 'oceano', nombre: 'Océano', rail: '#163b3f', rail2: '#1f5459', acento: '#3bb3a8' },
  { id: 'indigo', nombre: 'Índigo', rail: '#25264f', rail2: '#303267', acento: '#7c83f8' },
  { id: 'esmeralda', nombre: 'Esmeralda', rail: '#133d2e', rail2: '#1b5843', acento: '#2ecc8f' },
  { id: 'cobre', nombre: 'Cobre', rail: '#3d271b', rail2: '#563726', acento: '#e08a4b' },
  { id: 'rosa', nombre: 'Rosa', rail: '#421d33', rail2: '#5b2846', acento: '#e06b9e' },
  { id: 'slate', nombre: 'Pizarra azul', rail: '#21282f', rail2: '#303a44', acento: '#6aa0c8' },
  { id: 'bosque', nombre: 'Bosque', rail: '#1f3324', rail2: '#2c4934', acento: '#9bc24a' }
];
```
`aplicarTema` setea `document.documentElement.dataset.tema = id`. La vista Apariencia muestra cada tema como `button.tema` con `.tema-muestra` (fondo `rail`, dos barritas `accent` y `rail2`). Borrar los `[data-tema]` viejos de `variables.css`.

## Equivalencias de clases (migración)

| Antes | Ahora |
|---|---|
| `.panel`, `.panel-cabecera`, `.panel-cuerpo` | `.hoja`, `.hoja-cabecera` (+ `.hoja-titulo`/`.hoja-sub`), `.hoja-cuerpo` |
| `.kpi-grid`, `.kpi`, `.kpi-etiqueta`, `.kpi-valor`, `.kpi-detalle` | `.pulso`, `.cifra`, `.rotulo`, `.cifra-valor`, `.cifra-delta` |
| `.vista-cabecera`, `.vista-titulo`, `.vista-sub` | `.vista-cab`, `h1`, `p` |
| `.btn-secundario` / `.btn-mini` | `.btn` / `.btn-chico` |
| `.insignia verde/ambar/rojo/gris` | `.insignia ok/aviso/peligro` / `.insignia` |
| `.alerta-item` | `li.alerta` con `.alerta-dias` |
| `.tabla-contenedor table` | `.tabla-marco table.tabla` |
| `.celda-num` | `.num` |
| `.estado-vacio` | `.vacio` |
| `.sidebar`, `.nav-group-label`, `.nav-link.activo` | `.rail`, `.rail-grupo`, `a[aria-current="page"]` |
| `.topbar` | `.barra-sup` |
| `.contenido` | `.vista` |
| `.buscador` | `.entrada` |
| `.campo-ayuda` | `.ayuda` |
| `.tab-btn` (botones primario/secundario) | `.tab[aria-selected]` |
| `.dropdown-acciones` con "…" en filas | `tr.clic` + acciones en la ficha |

## Criterios de aceptación

- `frontend/stylo/` tiene exactamente la estructura de arriba y cada archivo coincide byte a byte con el Anexo.
- No queda `frontend/css/styles.css`, ni Chart.js, ni colores literales en los `.js` de vistas.
- Abriendo el sistema y el prototipo lado a lado (1440px y 400px), los componentes se ven iguales.
- Sin scroll horizontal del body en 400px; tablas y gráficos scrollean dentro de `.tabla-marco`.
- Foco visible en todos los controles (anillo `--focus` de 2px).
- Los 13 temas cambian solo el rail y el acento.
- `npm run verificar` y `npm test` pasan.

---

## Anexo — CSS completo (copiar tal cual)

### `frontend/stylo/main.css`

```css
/* main.css
   Punto de entrada. index.html carga solo este archivo. El orden importa. */

@import url('./base/fuentes.css');
@import url('./base/tokens.css');
@import url('./base/temas.css');
@import url('./base/reset.css');
@import url('./componentes/utilidades.css');
@import url('./componentes/boton.css');
@import url('./componentes/patente.css');
@import url('./componentes/insignia.css');
@import url('./componentes/cifra.css');
@import url('./componentes/hoja.css');
@import url('./componentes/tabla.css');
@import url('./componentes/tabs.css');
@import url('./componentes/campo.css');
@import url('./componentes/alerta.css');
@import url('./componentes/composicion.css');
@import url('./componentes/rail.css');
@import url('./componentes/ficha.css');
@import url('./componentes/modal.css');
@import url('./componentes/capas.css');
@import url('./layout/app.css');
@import url('./vistas/tablero.css');
@import url('./vistas/unidades.css');
@import url('./vistas/viajes.css');
@import url('./vistas/agenda.css');
@import url('./vistas/configuracion.css');
@import url('./vistas/admin.css');
@import url('./layout/responsive.css');
```

### `frontend/stylo/base/fuentes.css`

```css
/* base/fuentes.css
   Barlow Condensed (cifras, títulos, patente) · Archivo (interfaz) · IBM Plex Mono (códigos). */

@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
```

### `frontend/stylo/base/tokens.css`

```css
/* base/tokens.css
   Única fuente de valores. Ningún otro archivo escribe un color, tamaño o radio literal. */

:root {
  /* Color (tema por defecto: tcv) */
  --paper: #f3f4f1;           /* Fondo de página (detrás de hojas y tablas). Tono papel, levemente cálido: nunca blanco pur */
  --surface: #ffffff;         /* Hojas, tablas, modales, campos. La superficie donde se lee el dato. */
  --surface-sunk: #e8eae5;    /* Cabecera de tabla, pozos de filtros, fila seleccionada, track de barras inline. */
  --line: #d6d9d2;            /* Hairline 1px: separadores de fila, bordes de hoja. Decorativa, no lleva significado. */
  --line-strong: #7f877f;     /* Borde de campos, checkboxes y controles (≥3:1 sobre surface y paper). */
  --ink: #0f1b2d;             /* Texto principal y cifras sobre surface, paper y surface-sunk. */
  --ink-2: #465163;           /* Texto secundario: subtítulos, metadatos, etiquetas de columna. Sobre surface, paper y surf */
  --ink-3: #5b6676;           /* Texto terciario: ayudas de campo, unidades (km/L, $), placeholders. ≥4.5:1 sobre surface y */
  --brand-navy: #16386b;      /* Azul TCV del isotipo. Rail del tema TCV, serie 'ingresos' en gráficos, estado FACTURADO. */
  --brand-cyan: #38b6ff;      /* Cian TCV del isotipo. Acento del tema TCV; solo como relleno o marca, nunca como texto sob */
  --rail: #16386b;            /* Fondo del rail de navegación lateral y de la barra superior móvil. Lo cambia el tema del u */
  --rail-raised: #1c4789;     /* Ítem activo/hover del rail y grupo desplegado. */
  --rail-ink: #f4f6f8;        /* Texto e íconos del rail sobre rail y rail-raised. */
  --rail-ink-muted: #adbacf;  /* Etiquetas de grupo del rail (OPERACIÓN, FLOTA…) sobre rail. */
  --accent: #38b6ff;          /* Acento del tema: marca del ítem activo en el rail, relleno del botón primario, foco. Como  */
  --on-accent: #0f1b2d;       /* Texto e íconos sobre un relleno accent. */
  --accent-text: #006cab;     /* El acento cuando tiene que ser texto o ícono sobre surface/paper: links, tab activa, cifra */
  --focus: #0f1b2d;           /* Anillo de foco 2px + offset 2px en todos los controles. Ink sólido: ≥3:1 sobre cualquier s */
  --ok: #1c6a37;              /* Texto/ícono de estado correcto: rentabilidad positiva, 'al día', FINALIZADO. Sobre surface */
  --ok-tint: #e1efe4;         /* Fondo de insignia y celda de estado ok. */
  --warn: #7a4e00;            /* Texto/ícono de aviso: vence pronto, EN DESTINO, cobro por vencer. Sobre surface, paper y w */
  --warn-tint: #fbecc6;       /* Fondo de insignia de aviso. */
  --warn-fill: #f2a900;       /* Ámbar de señal vial: marca de urgencia en la columna de días, barra de aviso. Con texto in */
  --danger: #b0251b;          /* Texto/ícono de peligro: vencido, rentabilidad negativa, eliminar. Sobre surface, paper y d */
  --danger-tint: #fbe2de;     /* Fondo de insignia/celda vencida. */
  --danger-fill: #c8321f;     /* Relleno del botón destructivo y marca de vencido, con texto blanco. */
  --info: #0a5c93;            /* Texto/ícono informativo y estado EN CURSO. Sobre surface, paper e info-tint. */
  --info-tint: #dcedf9;       /* Fondo de insignia informativa / EN CURSO. */
  --plate-band: #1d4f9c;      /* Franja azul superior de la patente Mercosur. */
  --plate-ink: #111418;       /* Caracteres y borde de la patente. */
  --plate-bg: #ffffff;        /* Fondo de la patente. */
  --chart-income: #16386b;    /* Serie de ingresos en todos los gráficos. */
  --chart-cost: #d2691e;      /* Serie de costos/gastos. Naranja vs azul: se distinguen sin depender del rojo-verde. */
  --chart-alt: #38b6ff;       /* Segunda serie neutra (período anterior, objetivo). */
  --chart-muted: #a3abb5;     /* Resto/otros, gridlines fuertes. */

  /* Espacio, radios, sombra */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --radius-s: 2px;
  --radius-m: 4px;
  --radius-l: 8px;
  --shadow-pop: 0 8px 24px rgba(15,27,45,0.18), 0 1px 2px rgba(15,27,45,0.12);

  /* Tipografía */
  --font-display: "Barlow Condensed", "Arial Narrow", sans-serif;
  --font-text: "Archivo", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
}
```

### `frontend/stylo/base/temas.css`

```css
/* base/temas.css
   Temas de Apariencia. Cada tema redefine SOLO estas 6 variables. Se aplica con <html data-tema="id">. */

[data-tema="tcv"] { --rail: #16386b; --rail-raised: #1c4789; --accent: #38b6ff; --accent-text: #006cab; --on-accent: #0f1b2d; --rail-ink-muted: #adbacf; } /* TCV */
[data-tema="verde"] { --rail: #1d2f29; --rail-raised: #2b453c; --accent: #e8a13c; --accent-text: #915c11; --on-accent: #0f1b2d; --rail-ink-muted: #a0b0ab; } /* Verde pizarra */
[data-tema="azul"] { --rail: #1a2940; --rail-raised: #243959; --accent: #4f9dde; --accent-text: #206baa; --on-accent: #0f1b2d; --rail-ink-muted: #98a4b6; } /* Azul noche */
[data-tema="violeta"] { --rail: #2f2046; --rail-raised: #3f2b5e; --accent: #a779e0; --accent-text: #8443d4; --on-accent: #0f1b2d; --rail-ink-muted: #a69bb5; } /* Violeta */
[data-tema="borgona"] { --rail: #3c1d22; --rail-raised: #542930; --accent: #d98f6b; --accent-text: #a2512a; --on-accent: #0f1b2d; --rail-ink-muted: #b39b9e; } /* Borgoña */
[data-tema="grafito"] { --rail: #292a2d; --rail-raised: #3a3b40; --accent: #d6a85c; --accent-text: #866122; --on-accent: #0f1b2d; --rail-ink-muted: #a7a7aa; } /* Grafito */
[data-tema="oceano"] { --rail: #163b3f; --rail-raised: #1f5459; --accent: #3bb3a8; --accent-text: #26726b; --on-accent: #0f1b2d; --rail-ink-muted: #abc4c6; } /* Océano */
[data-tema="indigo"] { --rail: #25264f; --rail-raised: #303267; --accent: #7c83f8; --accent-text: #4751f5; --on-accent: #0f1b2d; --rail-ink-muted: #a0a0b8; } /* Índigo */
[data-tema="esmeralda"] { --rail: #133d2e; --rail-raised: #1b5843; --accent: #2ecc8f; --accent-text: #1a7552; --on-accent: #0f1b2d; --rail-ink-muted: #aac7bd; } /* Esmeralda */
[data-tema="cobre"] { --rail: #3d271b; --rail-raised: #563726; --accent: #e08a4b; --accent-text: #9f531b; --on-accent: #0f1b2d; --rail-ink-muted: #b9a8a0; } /* Cobre */
[data-tema="rosa"] { --rail: #421d33; --rail-raised: #5b2846; --accent: #e06b9e; --accent-text: #bf286a; --on-accent: #0f1b2d; --rail-ink-muted: #b89dae; } /* Rosa */
[data-tema="slate"] { --rail: #21282f; --rail-raised: #303a44; --accent: #6aa0c8; --accent-text: #366c93; --on-accent: #0f1b2d; --rail-ink-muted: #9ea4ab; } /* Pizarra azul */
[data-tema="bosque"] { --rail: #1f3324; --rail-raised: #2c4934; --accent: #9bc24a; --accent-text: #576f25; --on-accent: #0f1b2d; --rail-ink-muted: #a5b5aa; } /* Bosque */
```

### `frontend/stylo/base/reset.css`

```css
/* base/reset.css
   Base del documento. */

*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 14px/20px var(--font-text); -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
```

### `frontend/stylo/componentes/utilidades.css`

```css
/* componentes/utilidades.css
   Clases sueltas de texto y estado vacío. */

.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.mono { font-family: var(--font-mono); font-size: 13px; }
.rotulo { font: 600 11px/14px var(--font-text); letter-spacing: .9px; text-transform: uppercase; color: var(--ink-2); }
.tenue { color: var(--ink-3); }

/* ---------- Vacío ---------- */
.vacio { padding: var(--space-6) var(--space-4); text-align: center; color: var(--ink-3); }
```

### `frontend/stylo/componentes/boton.css`

```css
/* componentes/boton.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Botón ---------- */
.btn { display: inline-flex; align-items: center; gap: var(--space-2); height: 34px; padding: 0 var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-m); background: var(--surface); color: var(--ink); font: 600 13.5px/1 var(--font-text); cursor: pointer; white-space: nowrap; }
.btn:hover { background: var(--surface-sunk); }
.btn svg { width: 16px; height: 16px; flex: none; }
.btn-primario { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn-primario:hover { background: var(--accent); filter: brightness(.94); }
.btn-tinta { background: var(--ink); border-color: var(--ink); color: var(--surface); }
.btn-tinta:hover { background: var(--ink); filter: brightness(1.25); }
.btn-fantasma { border-color: transparent; background: transparent; }
.btn-peligro { background: var(--danger-fill); border-color: var(--danger-fill); color: #fff; }
.btn-peligro:hover { background: var(--danger-fill); filter: brightness(.92); }
.btn-chico { height: 28px; padding: 0 var(--space-2); font-size: 12.5px; }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
```

### `frontend/stylo/componentes/patente.css`

```css
/* componentes/patente.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Patente (Mercosur) ---------- */
.patente { display: inline-flex; flex-direction: column; align-items: stretch; min-width: 88px; border: 1.5px solid var(--plate-ink); border-radius: var(--radius-s); background: var(--plate-bg); overflow: hidden; vertical-align: middle; line-height: 1; }
.patente::before { content: ""; display: block; height: 5px; background: var(--plate-band); }
.patente b { display: block; padding: 3px 7px 4px; font: 600 17px/18px var(--font-display); letter-spacing: 1.6px; color: var(--plate-ink); text-align: center; white-space: nowrap; }
.patente-chica { min-width: 66px; }
.patente-chica::before { height: 3px; }
.patente-chica b { padding: 2px 5px 3px; font-size: 13.5px; line-height: 14px; letter-spacing: 1.1px; }
.patente-grande { min-width: 150px; border-width: 2px; }
.patente-grande::before { height: 9px; }
.patente-grande b { padding: 5px 12px 7px; font-size: 32px; line-height: 32px; letter-spacing: 3px; }
a .patente, .patente[href] { cursor: pointer; }
```

### `frontend/stylo/componentes/insignia.css`

```css
/* componentes/insignia.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Insignia (estado) ---------- */
.insignia { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 7px; border-radius: var(--radius-s); background: var(--surface-sunk); color: var(--ink); font: 600 11px/1 var(--font-text); letter-spacing: .5px; text-transform: uppercase; white-space: nowrap; }
.insignia::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.insignia.sin-punto::before { display: none; }
.insignia.ok { background: var(--ok-tint); color: var(--ok); }
.insignia.aviso { background: var(--warn-tint); color: var(--warn); }
.insignia.peligro { background: var(--danger-tint); color: var(--danger); }
.insignia.info { background: var(--info-tint); color: var(--info); }
.insignia.marca { background: var(--brand-navy); color: #fff; }
```

### `frontend/stylo/componentes/cifra.css`

```css
/* componentes/cifra.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Cifra (KPI) ---------- */
.cifra { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.cifra-valor { font: 600 36px/36px var(--font-display); color: var(--ink); white-space: nowrap; }
.cifra-valor small { font: 500 18px/1 var(--font-display); color: var(--ink-3); margin-left: 3px; }
.cifra-xl .cifra-valor { font-size: 56px; line-height: 52px; letter-spacing: -.5px; }
.cifra-delta { display: inline-flex; align-items: center; gap: 4px; font: 600 12.5px/16px var(--font-text); }
.cifra-delta.sube { color: var(--ok); } .cifra-delta.baja { color: var(--danger); }
.cifra-delta .tenue { font-weight: 400; }
.cifra-traza { display: block; width: 100%; height: 28px; }
.cifra-traza path { fill: none; stroke: var(--ink-2); stroke-width: 1.5; }
.cifra-traza circle { fill: var(--ink); }

/* Franja de pulso: cifras en fila separadas por reglas verticales */
.pulso { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-m); }
.pulso > .cifra { padding: var(--space-4) var(--space-5); border-left: 1px solid var(--line); }
.pulso > .cifra:first-child { border-left: 0; }
```

### `frontend/stylo/componentes/hoja.css`

```css
/* componentes/hoja.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Hoja (panel) ---------- */
.hoja { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-m); min-width: 0; }
.hoja-cabecera { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--line); }
.hoja-titulo { margin: 0; font: 600 20px/22px var(--font-display); letter-spacing: .3px; }
.hoja-sub { font-size: 12.5px; color: var(--ink-3); }
.hoja-cuerpo { padding: var(--space-4); }
.hoja-pie { padding: var(--space-2) var(--space-4); border-top: 1px solid var(--line); font-size: 12.5px; color: var(--ink-2); }
.hoja-pie a, .link { color: var(--accent-text); font-weight: 600; text-decoration: none; }
.hoja-pie a:hover, .link:hover { text-decoration: underline; }
```

### `frontend/stylo/componentes/tabla.css`

```css
/* componentes/tabla.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Tabla densa ---------- */
.tabla-marco { overflow-x: auto; }
.tabla { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.tabla th { position: sticky; top: 0; z-index: 1; padding: 8px var(--space-3); background: var(--surface-sunk); border-bottom: 1px solid var(--line); text-align: left; font: 600 11px/14px var(--font-text); letter-spacing: .9px; text-transform: uppercase; color: var(--ink-2); white-space: nowrap; }
.tabla th.num { text-align: right; }
.tabla td { padding: 9px var(--space-3); border-bottom: 1px solid var(--line); vertical-align: middle; }
.tabla tbody tr:hover td { background: #f7f8f5; }
.tabla tbody tr.clic { cursor: pointer; }
.tabla tr.sel td { background: var(--surface-sunk); }
.tabla td.fuerte { font-weight: 600; }
.tabla tfoot td { font-weight: 700; border-top: 2px solid var(--ink); border-bottom: 0; }

/* Barra inline (dentro de celdas) */
.barra { position: relative; height: 8px; min-width: 80px; background: var(--surface-sunk); border-radius: var(--radius-s); overflow: hidden; }
.barra > i { position: absolute; inset: 0 auto 0 0; background: var(--chart-income); border-radius: var(--radius-s); }
.barra.costo > i { background: var(--chart-cost); }
.barra-doble { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; align-items: center; }
.barra-doble .izq { direction: rtl; }
.barra-doble .izq > i { inset: 0 0 0 auto; background: var(--chart-cost); }
```

### `frontend/stylo/componentes/tabs.css`

```css
/* componentes/tabs.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Tabs ---------- */
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
.tab { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 10px var(--space-3) 11px; border: 0; background: none; color: var(--ink-2); font: 600 13.5px/1 var(--font-text); cursor: pointer; white-space: nowrap; }
.tab:hover { color: var(--ink); }
.tab[aria-selected="true"] { color: var(--ink); }
.tab[aria-selected="true"]::after { content: ""; position: absolute; left: var(--space-3); right: var(--space-3); bottom: -1px; height: 3px; background: var(--accent-text); }
.tab .cuenta { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--surface-sunk); color: var(--ink-2); font-size: 11px; line-height: 18px; text-align: center; }
.tab .cuenta.peligro { background: var(--danger-fill); color: #fff; }

/* Segmentado (períodos, filtros rápidos) */
.segmentado { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--radius-m); overflow: hidden; }
.segmentado button { height: 30px; padding: 0 var(--space-3); border: 0; border-left: 1px solid var(--line); background: var(--surface); color: var(--ink-2); font: 600 12.5px/1 var(--font-text); cursor: pointer; }
.segmentado button:first-child { border-left: 0; }
.segmentado button[aria-pressed="true"] { background: var(--ink); color: var(--surface); }
```

### `frontend/stylo/componentes/campo.css`

```css
/* componentes/campo.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Campo ---------- */
.campo { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.campo label { font: 600 12.5px/16px var(--font-text); color: var(--ink-2); }
.campo input, .campo select, .campo textarea, .entrada { height: 36px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: var(--radius-m); background: var(--surface); color: var(--ink); font: 400 14px/20px var(--font-text); width: 100%; }
.campo textarea { height: auto; min-height: 72px; padding: 8px 10px; }
.campo input::placeholder, .entrada::placeholder { color: var(--ink-3); }
.campo .ayuda { font-size: 12.5px; color: var(--ink-3); }
.campo.error input, .campo.error select { border-color: var(--danger); box-shadow: inset 0 0 0 1px var(--danger); }
.campo.error .ayuda { color: var(--danger); }
.formulario { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3) var(--space-4); }
.formulario .ancho { grid-column: 1 / -1; }
.formulario fieldset { grid-column: 1 / -1; margin: var(--space-2) 0 0; padding: var(--space-3) 0 0; border: 0; border-top: 1px solid var(--line); display: contents; }
.grupo-titulo { grid-column: 1 / -1; margin-top: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--line); }
```

### `frontend/stylo/componentes/alerta.css`

```css
/* componentes/alerta.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Alerta (fila con cuenta regresiva) ---------- */
.alertas { list-style: none; margin: 0; padding: 0; }
.alerta { display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: var(--space-3); padding: 8px var(--space-4); border-bottom: 1px solid var(--line); }
.alerta:last-child { border-bottom: 0; }
.alerta-dias { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 40px; border-radius: var(--radius-s); background: var(--surface-sunk); color: var(--ink); font: 600 20px/1 var(--font-display); }
.alerta-dias small { font: 600 9.5px/1 var(--font-text); letter-spacing: .6px; text-transform: uppercase; margin-top: 2px; }
.alerta.vencida .alerta-dias { background: var(--danger-fill); color: #fff; }
.alerta.pronto .alerta-dias { background: var(--warn-fill); color: var(--ink); }
.alerta-texto { min-width: 0; }
.alerta-texto strong { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alerta-texto span { font-size: 12.5px; color: var(--ink-3); }
```

### `frontend/stylo/componentes/composicion.css`

```css
/* componentes/composicion.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Composición del equipo (tractor + acoplado + chofer) ---------- */
.composicion { display: flex; align-items: flex-end; gap: 0; }
.comp-pieza { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.comp-silueta { display: block; height: 46px; }
.comp-silueta .caja { fill: var(--surface-sunk); stroke: var(--ink); stroke-width: 1.5; }
.comp-silueta .cabina { fill: var(--brand-navy); }
.comp-silueta .rueda { fill: var(--ink); }
.comp-silueta .llanta { fill: var(--surface); }
.comp-pieza.actual .comp-silueta .caja { fill: var(--info-tint); }
.comp-enganche { width: 14px; height: 3px; margin-bottom: 38px; background: var(--ink); }
.comp-chofer { margin-left: var(--space-5); padding-left: var(--space-4); border-left: 1px solid var(--line); align-self: stretch; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
```

### `frontend/stylo/componentes/rail.css`

```css
/* componentes/rail.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Rail (navegación lateral) ---------- */
.rail { display: flex; flex-direction: column; width: 232px; min-height: 100%; background: var(--rail); color: var(--rail-ink); }
.rail-marca { display: flex; align-items: center; gap: 10px; padding: 16px 16px 14px; }
.rail-marca img { width: 32px; height: 32px; }
.rail-marca b { display: block; font: 600 17px/18px var(--font-display); letter-spacing: .4px; }
.rail-marca span { font-size: 11.5px; color: var(--rail-ink-muted); }
.rail-grupo { padding: 14px 16px 6px; font: 600 10.5px/14px var(--font-text); letter-spacing: 1.1px; text-transform: uppercase; color: var(--rail-ink-muted); }
.rail a { position: relative; display: flex; align-items: center; gap: 10px; margin: 1px 8px; padding: 7px 10px; border-radius: var(--radius-m); color: var(--rail-ink); font: 500 13.5px/18px var(--font-text); text-decoration: none; }
.rail a svg { width: 17px; height: 17px; flex: none; opacity: .85; }
.rail a:hover { background: var(--rail-raised); }
.rail a[aria-current="page"] { background: var(--rail-raised); font-weight: 600; }
.rail a[aria-current="page"]::before { content: ""; position: absolute; left: -8px; top: 6px; bottom: 6px; width: 3px; border-radius: 0 2px 2px 0; background: var(--accent); }
.rail a .cuenta { margin-left: auto; min-width: 20px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--accent); color: var(--on-accent); font: 700 11px/18px var(--font-text); text-align: center; }
.rail :focus-visible { outline-color: var(--accent); }
```

### `frontend/stylo/componentes/ficha.css`

```css
/* componentes/ficha.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Ficha (cabecera de detalle) ---------- */
.ficha-cabecera { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4) var(--space-5); padding: var(--space-5); background: var(--surface); border: 1px solid var(--line); border-bottom: 0; border-radius: var(--radius-m) var(--radius-m) 0 0; }
.ficha-datos { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-6); }
.ficha-dato { display: flex; flex-direction: column; gap: 2px; }
.ficha-dato b { font-weight: 600; }
.ficha-tabs { background: var(--surface); border: 1px solid var(--line); border-top: 0; border-radius: 0 0 var(--radius-m) var(--radius-m); padding: 0 var(--space-3); }
```

### `frontend/stylo/componentes/modal.css`

```css
/* componentes/modal.css
   Ver guía del componente en el sistema de diseño. */

/* ---------- Modal ---------- */
.modal { width: min(640px, 100%); background: var(--surface); border-radius: var(--radius-l); box-shadow: var(--shadow-pop); overflow: hidden; }
.modal-cabecera { display: flex; align-items: center; justify-content: space-between; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--line); }
.modal-cabecera h2 { margin: 0; font: 600 22px/24px var(--font-display); }
.modal-cuerpo { padding: var(--space-5); max-height: 70vh; overflow: auto; }
.modal-pie { display: flex; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3) var(--space-5); background: var(--paper); border-top: 1px solid var(--line); }
```

### `frontend/stylo/componentes/capas.css`

```css
/* componentes/capas.css
   Toast, fondo de modal y menú flotante. Únicos elementos con shadow-pop. */

/* Toast y modal */
.toast { position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 60; padding: 10px 16px; background: var(--ink); color: var(--surface); border-radius: var(--radius-m); font-weight: 600; box-shadow: var(--shadow-pop); }
.fondo-modal { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; background: rgba(15,27,45,.5); }
.menu-flot { position: absolute; z-index: 30; min-width: 220px; padding: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-l); box-shadow: var(--shadow-pop); }
.menu-flot button { display: flex; width: 100%; gap: 10px; align-items: center; padding: 8px 10px; border: 0; background: none; border-radius: var(--radius-m); font: 500 13.5px var(--font-text); color: var(--ink); cursor: pointer; text-align: left; }
.menu-flot button:hover { background: var(--surface-sunk); }
.rel { position: relative; }
```

### `frontend/stylo/layout/app.css`

```css
/* layout/app.css
   Rail fijo de 232px + barra superior sticky + vista de trabajo (máx. 1440px) sobre papel. */

/* Layout: rail oscuro fijo a la izquierda + barra superior + vista de trabajo sobre papel. */
html, body { height: 100%; }
body { background: var(--paper); color: var(--ink); }
.app { display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100%; }
.app > .rail { position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.rail-pie { margin-top: auto; padding: 12px 16px 16px; border-top: 1px solid var(--rail-raised); display: flex; flex-direction: column; gap: 8px; }
.rail-pie label { font: 600 10.5px/14px var(--font-text); letter-spacing: 1.1px; text-transform: uppercase; color: var(--rail-ink-muted); }
.rail-pie select { height: 30px; background: var(--rail-raised); color: var(--rail-ink); border: 1px solid var(--rail-ink-muted); border-radius: var(--radius-m); padding: 0 6px; font: 500 13px var(--font-text); }
.rail-marca button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px; }
.rail-marca svg { width: 32px; height: 32px; flex: none; }

.principal { min-width: 0; display: flex; flex-direction: column; }
.barra-sup { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 20; display: flex; align-items: center; gap: 12px; padding: 10px 24px; background: var(--surface); border-bottom: 1px solid var(--line); }
.barra-sup .buscar { position: relative; flex: 1; max-width: 420px; }
.barra-sup .buscar svg { position: absolute; left: 10px; top: 9px; width: 16px; height: 16px; color: var(--ink-3); }
.barra-sup .buscar input { padding-left: 34px; height: 34px; background: var(--paper); }
.barra-sup .espacio { flex: 1; }
.btn-menu { display: none; }
.campana { position: relative; }
.campana .punto { position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: var(--danger-fill); color: #fff; font: 700 10.5px/18px var(--font-text); text-align: center; }
.usuario { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.2; }
.usuario b { font-size: 13px; } .usuario span { font-size: 11.5px; color: var(--ink-3); }

.vista { padding: 24px; display: flex; flex-direction: column; gap: 24px; max-width: 1440px; width: 100%; }
.vista-cab { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 24px; }
.vista-cab h1 { margin: 0; font: 600 30px/32px var(--font-display); letter-spacing: .2px; text-wrap: balance; }
.vista-cab p { margin: 4px 0 0; color: var(--ink-2); max-width: 70ch; }
.acciones { display: flex; flex-wrap: wrap; gap: 8px; }
.migas { font-size: 12.5px; color: var(--ink-3); margin-bottom: 6px; }
.migas button { all: unset; cursor: pointer; color: var(--accent-text); font-weight: 600; }
.migas button:hover { text-decoration: underline; }

.grilla-2 { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.grilla-2-iguales { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; align-items: start; }
.grilla-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; align-items: start; }
.pila { display: flex; flex-direction: column; gap: 24px; min-width: 0; }

.aviso-proto { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; background: var(--info-tint); color: var(--info); border-radius: var(--radius-m); font-size: 13px; }
.aviso-proto b { color: var(--ink); }
```

### `frontend/stylo/vistas/tablero.css`

```css
/* vistas/tablero.css
   Pulso del tablero, estado de flota, gráficos SVG, antigüedad de saldos. */

.pulso.tablero { grid-template-columns: minmax(250px, 1.7fr) repeat(5, minmax(0, 1fr)); }
.pulso.tablero .cifra-xl .cifra-valor { font-size: 50px; line-height: 48px; }

/* Estado de flota: una fila por equipo */
.flota-fila { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 9px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }
.flota-fila:hover { background: #f7f8f5; }
.flota-fila:last-child { border-bottom: 0; }
.flota-fila .pat { display: flex; gap: 4px; }
.flota-fila .det { min-width: 0; }
.flota-fila .det b { display: block; font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.flota-fila .det span { font-size: 12.5px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.progreso { height: 4px; background: var(--surface-sunk); border-radius: 2px; margin-top: 5px; overflow: hidden; }
.progreso i { display: block; height: 100%; background: var(--info); }

/* Gráficos SVG */
.grafico { display: block; width: 100%; height: auto; }
.grafico text { font: 500 11px var(--font-text); fill: var(--ink-2); }
.grafico .valor { font: 600 13px var(--font-display); fill: var(--ink); letter-spacing: .2px; }
.grafico .eje { stroke: var(--line); }
.grafico .base { stroke: var(--ink); stroke-width: 1; }
.leyenda { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12.5px; color: var(--ink-2); }
.leyenda i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }

/* Antigüedad de saldos */
.tramos { display: flex; height: 34px; border-radius: var(--radius-s); overflow: hidden; gap: 2px; }
.tramos > div { display: flex; align-items: center; padding: 0 8px; font: 600 12px var(--font-text); white-space: nowrap; overflow: hidden; min-width: 0; }
.tramos-ref { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.tramos-ref div { display: flex; flex-direction: column; gap: 2px; }
.tramos-ref b { font: 600 20px/22px var(--font-display); }
```

### `frontend/stylo/vistas/unidades.css`

```css
/* vistas/unidades.css
   Grilla de unidades, ficha unificada y esquema de ejes de cubiertas. */

/* Lista de unidades: patente grande como protagonista */
.unidades { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.unidad-ficha { display: flex; flex-direction: column; gap: 12px; padding: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-m); cursor: pointer; text-align: left; font: inherit; color: inherit; }
.unidad-ficha:hover { border-color: var(--line-strong); }
.unidad-ficha .fila { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.unidad-ficha .modelo { font: 600 18px/20px var(--font-display); }
.unidad-ficha .datos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
.unidad-ficha .datos b { display: block; font: 600 17px/20px var(--font-display); }
.unidad-ficha .datos span { font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: .6px; font-weight: 600; }
.marcas { display: flex; flex-wrap: wrap; gap: 6px; min-height: 22px; }
.filtros { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.filtros .entrada { width: 240px; max-width: 100%; }

/* Ficha */
.ficha-pila { display: flex; flex-direction: column; }
.ficha-cuerpo { padding-top: 24px; display: flex; flex-direction: column; gap: 24px; }

/* Cubiertas: esquema de ejes */
.ejes { display: flex; flex-direction: column; align-items: center; gap: 0; padding: 20px 8px; }
.ejes-chasis { position: relative; display: flex; flex-direction: column; gap: 26px; padding: 18px 0; }
.ejes-chasis::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 30px; transform: translateX(-50%); background: var(--surface-sunk); border: 1px solid var(--line-strong); border-radius: 3px; }
.eje { position: relative; display: grid; grid-template-columns: auto 80px auto; align-items: center; }
.eje::before { content: ""; position: absolute; left: 10px; right: 10px; top: 50%; height: 4px; transform: translateY(-50%); background: var(--ink); }
.eje .lado { position: relative; display: flex; gap: 4px; }
.eje .rotulo-eje { position: relative; text-align: center; font: 600 10.5px var(--font-text); letter-spacing: .8px; color: var(--ink-2); background: var(--surface-sunk); padding: 2px 0; z-index: 1; }
.cubierta { width: 30px; height: 62px; border-radius: 6px; border: 2px solid var(--ink); background: var(--ink); cursor: pointer; padding: 0; position: relative; display: flex; align-items: flex-end; justify-content: center; }
.cubierta::after { content: ""; position: absolute; inset: 6px 7px; border-radius: 2px; background: repeating-linear-gradient(0deg, transparent 0 5px, rgba(255,255,255,.18) 5px 7px); }
.cubierta.estado-nueva { background: var(--ok); border-color: var(--ok); }
.cubierta.estado-buena { background: #2f4a6e; border-color: #2f4a6e; }
.cubierta.estado-recapada { background: #6b7685; border-color: #6b7685; }
.cubierta.estado-cambiar { background: var(--danger-fill); border-color: var(--danger-fill); }
.cubierta.vacia { background: var(--surface); border-style: dashed; border-color: var(--line-strong); }
.cubierta.vacia::after { display: none; }
.cubierta[aria-pressed="true"] { outline: 3px solid var(--warn-fill); outline-offset: 2px; }
.cubierta-detalle { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.cubierta-detalle div span { display: block; }
.vida { display: grid; grid-template-columns: minmax(0, 1fr) 56px; gap: 8px; align-items: center; }
```

### `frontend/stylo/vistas/viajes.css`

```css
/* vistas/viajes.css
   Flujo de estados del viaje. */

/* Flujo de estado de viaje */
.flujo { display: flex; gap: 0; }
.flujo span { flex: 1; height: 6px; background: var(--surface-sunk); margin-right: 2px; }
.flujo span.on { background: var(--ink); }
```

### `frontend/stylo/vistas/agenda.css`

```css
/* vistas/agenda.css
   Agenda de flota agrupada por semana. */

/* Agenda */
.semana { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 16px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.semana:last-child { border-bottom: 0; }
.semana h3 { margin: 0; font: 600 17px/20px var(--font-display); }
.semana .items { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.agenda-item { display: grid; grid-template-columns: 64px 92px minmax(0, 1fr) auto; gap: 10px; align-items: center; font-size: 13.5px; }
.agenda-item .fecha { font: 600 14px var(--font-display); color: var(--ink-2); }
```

### `frontend/stylo/vistas/configuracion.css`

```css
/* vistas/configuracion.css
   Selector de temas de Apariencia. */

/* Temas */
.temas { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.tema { display: flex; flex-direction: column; gap: 8px; padding: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-m); cursor: pointer; font: inherit; color: inherit; text-align: left; }
.tema[aria-pressed="true"] { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
.tema-muestra { height: 54px; border-radius: var(--radius-s); display: flex; align-items: flex-end; padding: 6px; gap: 4px; }
.tema-muestra i { width: 26px; height: 8px; border-radius: 2px; }
.tema b { font-size: 13px; }
```

### `frontend/stylo/vistas/admin.css`

```css
/* vistas/admin.css
   Matriz empresa × módulo. */

/* Matriz de módulos */
.matriz td.m { text-align: center; }
.matriz .pto { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--ink-3); }
.matriz .pto.on { background: var(--ink); border-color: var(--ink); }
.matriz th.rot { writing-mode: vertical-rl; transform: rotate(180deg); height: 120px; vertical-align: bottom; text-align: left; padding: 8px 6px; }
```

### `frontend/stylo/layout/responsive.css`

```css
/* layout/responsive.css
   Todos los cortes en un solo lugar: 1280 / 1100 / 900 / 640 px. Va último. */

@media (max-width: 1280px) { .pulso.tablero { grid-template-columns: repeat(3, minmax(0, 1fr)); } .pulso.tablero > .cifra:nth-child(4) { border-left: 0; } .pulso.tablero > .cifra:nth-child(n+4) { border-top: 1px solid var(--line); } }

@media (max-width: 1100px) {
  .grilla-2, .grilla-3, .grilla-2-iguales { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 900px) {
  .app { grid-template-columns: minmax(0, 1fr); }
  .app > .rail { position: fixed; left: 0; top: 0; z-index: 40; height: 100%; transform: translateX(-100%); transition: transform .2s; }
  .app.menu-abierto > .rail { transform: none; box-shadow: var(--shadow-pop); }
  .btn-menu { display: inline-flex; }
  .barra-sup { padding: 8px 16px; flex-wrap: wrap; }
  .barra-sup .segmentado, .usuario { display: none; }
  .vista { padding: 16px; }
  .semana { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .agenda-item { grid-template-columns: 52px auto minmax(0, 1fr); }
  .agenda-item > :last-child { grid-column: 1 / -1; justify-self: start; }
  .tramos-ref { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 900px) {
  .barra-sup .espacio { display: none; }
  .barra-sup .buscar { min-width: 0; max-width: none; }
  .flota-fila { grid-template-columns: minmax(0, 1fr) auto; }
  .flota-fila .pat { grid-column: 1 / -1; }
  .alerta-texto strong { white-space: normal; }
  .pulso.tablero { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pulso.tablero > .cifra { border-left: 0; border-top: 1px solid var(--line); }
  .pulso.tablero > .cifra:nth-child(even) { border-left: 1px solid var(--line); }
  .pulso.tablero > .cifra:nth-child(-n+2) { border-top: 0; }
  .pulso.tablero .cifra-xl .cifra-valor { font-size: 34px; line-height: 36px; }
  .pulso > .cifra { padding: 14px 16px; }
}

@media (max-width: 640px) {
  .formulario { grid-template-columns: 1fr; }
  .pulso > .cifra { border-left: 0; border-top: 1px solid var(--line); }
  .pulso > .cifra:first-child { border-top: 0; }
  .cifra-xl .cifra-valor { font-size: 44px; line-height: 44px; }
}
```
