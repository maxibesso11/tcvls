// frontend/js/vistas/perfil.js
// "Mi perfil" (todos los usuarios) y la ficha de un chofer (edición solo para
// administradores). Las funciones son globales a propósito: las usan los
// onclick="..." del HTML generado. El orden de carga está en index.html.

const ROLES_ADMIN = ['ADMIN', 'ADMIN_EMPRESA', 'ADMIN_MULTIEMPRESA'];
const esAdministrador = () => Boolean(SESION && ROLES_ADMIN.includes(SESION.rol));
const NOMBRE_ROL = {
  ADMIN: 'Administrador de plataforma',
  ADMIN_MULTIEMPRESA: 'Administrador multiempresa',
  ADMIN_EMPRESA: 'Administrador de empresa',
  USUARIO: 'Usuario'
};

// ============================================================
// Mi perfil: datos personales y cambio de contraseña
// ============================================================
function renderMiPerfil() {
  const u = SESION;
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Mi perfil</h1>
        <p>Tus datos de acceso y tu contraseña.</p>
      </div>
      <div class="acciones">
        <button class="btn btn-primario" onclick="mostrarCambioContrasena(false)">Cambiar contraseña</button>
      </div>
    </div>
    ${hojaHTML('Datos personales', 'Para modificarlos, pedíselo a un administrador de tu empresa', `
      <div class="hoja-cuerpo"><div class="ficha-datos">
        <div class="ficha-dato"><span class="rotulo">Usuario</span><b>${esc(u.nombre_usuario)}</b></div>
        <div class="ficha-dato"><span class="rotulo">Correo</span><b>${esc(u.correo || '—')}</b></div>
        <div class="ficha-dato"><span class="rotulo">Rol</span><b>${insignia(NOMBRE_ROL[u.rol] || u.rol, u.rol === 'USUARIO' ? 'sin-punto' : 'info')}</b></div>
        <div class="ficha-dato"><span class="rotulo">Empresa</span><b>${esc(u.nombre_empresa || '—')}</b></div>
      </div></div>`)}
    ${esAdministrador() ? '' : '<p class="tenue">Tu usuario no tiene acceso al panel de administración.</p>'}
  `;
}

// ============================================================
// Ficha de un chofer
// ============================================================
async function renderChoferDetalle(idStr) {
  const id = Number(idStr);
  contenido.innerHTML = '<div class="vacio">Cargando ficha del chofer…</div>';
  try {
    const [choferes, equipos, unidades] = await Promise.all([
      API.listarTodo('choferes'), API.listarTodo('equipos'), API.listarTodo('unidades')
    ]);
    const c = choferes.find(x => x.id_chofer === id);
    if (!c) throw new Error('Chofer no encontrado');
    const patente = i => (unidades.find(u => u.id_unidad === i) || {}).patente || '?';
    const equipo = equipos.find(e => e.id_chofer === id);
    const dCarnet = diasHasta(c.vencimiento_carnet);
    const dDescanso = c.ultima_jornada_descanso ? -diasHasta(c.ultima_jornada_descanso) : null;
    const variable = c.variable_tipo === 'PORCENTAJE' ? `${fmtNum(c.variable_valor)} %`
      : c.variable_tipo === 'POR KM' ? `${fmtDinero(c.variable_valor)}/km` : '—';

    contenido.innerHTML = `
      <div class="migas"><button onclick="location.hash='choferes'">Choferes</button> / ${esc(c.nombre)}</div>
      <div class="ficha-pila">
        <header class="ficha-cabecera">
          <div>
            <h1 class="hoja-titulo">${esc(c.nombre)}</h1>
            <div class="marcas">${dCarnet !== null && dCarnet < 0 ? insignia('Carnet vencido', 'peligro') : dCarnet !== null && dCarnet <= 30 ? insignia('Carnet por vencer', 'aviso') : ''}</div>
          </div>
          <div class="ficha-datos">
            <div class="ficha-dato"><span class="rotulo">CUIL</span><b class="mono">${esc(c.cuil)}</b></div>
            <div class="ficha-dato"><span class="rotulo">Edad</span><b>${esc(c.edad)}</b></div>
            <div class="ficha-dato"><span class="rotulo">Teléfono</span><b>${esc(c.telefono || '—')}</b></div>
            <div class="ficha-dato"><span class="rotulo">Domicilio</span><b>${esc(c.domicilio || '—')}</b></div>
          </div>
          <div class="acciones">
            <button class="btn btn-primario" onclick="abrirModal('choferes', ${id})">Editar datos del chofer</button>
          </div>
        </header>
        <div class="ficha-cuerpo">
          <div class="grilla-2">
            ${hojaHTML('Licencia y descanso', '', `<ul class="alertas">
              ${alertaHTML({ dias: dCarnet, titulo: 'Carnet de conducir', detalle: `Vence el ${fmtFecha(c.vencimiento_carnet)}` })}
              ${dDescanso === null ? '' : alertaHTML({ dias: null, sinDias: { valor: dDescanso, unidad: 'sin desc.' }, urgente: dDescanso >= 25, titulo: 'Última jornada de descanso', detalle: fmtFecha(c.ultima_jornada_descanso) })}
            </ul>`)}
            ${hojaHTML('Equipo actual', '', equipo
              ? `<div class="hoja-cuerpo">${patentesEquipo({ patente_principal: patente(equipo.id_unidad_principal), patente_secundaria: patente(equipo.id_unidad_secundaria) })}</div>`
              : '<div class="vacio">No está asignado a ningún equipo.</div>', '<button class="btn btn-chico" onclick="location.hash=\'equipos\'">Ver equipos</button>')}
          </div>
          ${hojaHTML('Remuneración', '', `<div class="hoja-cuerpo"><div class="ficha-datos">
            <div class="ficha-dato"><span class="rotulo">Sueldo fijo mensual</span><b>${c.sueldo_fijo_mensual ? fmtDinero(c.sueldo_fijo_mensual) : '—'}</b></div>
            <div class="ficha-dato"><span class="rotulo">Variable por viaje</span><b>${variable}</b></div>
          </div></div>`)}
        </div>
      </div>`;
  } catch (err) {
    contenido.innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}
