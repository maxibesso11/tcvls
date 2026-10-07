// backend/src/modulos/admin/usuarios.servicio.js
// Reglas de negocio de usuarios, compartidas entre el ADMIN de plataforma
// (alcance = null, ve y opera todas las empresas) y el ADMIN_EMPRESA
// (alcance = { idEmpresa }, ve y opera solo la suya). Así ambos paneles
// (admin.rutas.js y empresa/empresa.rutas.js) aplican las mismas reglas:
// validación de contraseña, cambio obligatorio al primer ingreso, cierre de
// sesiones al reasignar contraseña, rol o empresa.
const pool = require('../../config/db');
const { hashearContrasena, problemaContrasenaNueva } = require('../../lib/seguridad/credenciales');
const { ErrorNegocio } = require('../../lib/errores');

const ROLES_EMPRESA = ['ADMIN_EMPRESA', 'USUARIO'];

function esAlcanceEmpresa(alcance) {
  return !!(alcance && alcance.idEmpresa);
}

// Lista de usuarios visibles en el alcance dado.
async function listar(alcance) {
  const condiciones = [];
  const params = [];
  if (esAlcanceEmpresa(alcance)) {
    condiciones.push('u.id_empresa = ?');
    params.push(alcance.idEmpresa);
    condiciones.push("u.rol IN ('USUARIO', 'ADMIN_EMPRESA')");
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const [rows] = await pool.query(`
    SELECT u.id_usuario, u.nombre_usuario, u.correo, u.rol, u.id_empresa, u.activo,
           e.nombre AS nombre_empresa
    FROM USUARIOS u
    LEFT JOIN EMPRESAS e ON e.id_empresa = u.id_empresa
    ${where}
    ORDER BY u.nombre_usuario
  `, params);
  return rows;
}

// Busca un usuario dentro del alcance. Si existe pero es de otra empresa,
// devuelve null igual que si no existiera (nunca confirma que existe en otra
// empresa).
async function buscarEnAlcance(idUsuario, alcance) {
  const [[usuario]] = await pool.query(
    'SELECT * FROM USUARIOS WHERE id_usuario = ?', [idUsuario]
  );
  if (!usuario) return null;
  if (esAlcanceEmpresa(alcance) && usuario.id_empresa !== alcance.idEmpresa) return null;
  return usuario;
}

// Cuenta los ADMIN_EMPRESA activos de una empresa, excluyendo opcionalmente
// un id (para saber si ALGUIEN MÁS además del que se está por tocar sigue
// activo).
async function contarAdminsEmpresaActivos(idEmpresa, excluirId) {
  const params = [idEmpresa];
  let condicionExcluir = '';
  if (excluirId) { condicionExcluir = 'AND id_usuario <> ?'; params.push(excluirId); }
  const [[{ cantidad }]] = await pool.query(
    `SELECT COUNT(*) AS cantidad FROM USUARIOS
      WHERE id_empresa = ? AND rol = 'ADMIN_EMPRESA' AND activo = 1 ${condicionExcluir}`,
    params
  );
  return Number(cantidad);
}

// Si el usuario es el último ADMIN_EMPRESA activo de su empresa, impide
// desactivarlo, degradarlo o eliminarlo: cada empresa que ya tiene uno debe
// conservar siempre al menos uno activo.
async function validarNoUltimoAdminEmpresa(usuario) {
  if (usuario.rol !== 'ADMIN_EMPRESA' || !usuario.activo) return;
  const otros = await contarAdminsEmpresaActivos(usuario.id_empresa, usuario.id_usuario);
  if (otros === 0) {
    throw new ErrorNegocio('No se puede dejar a la empresa sin ningún administrador de empresa activo.', 409);
  }
}

// Crea un usuario. En alcance de empresa, la empresa la fija el servidor
// (se ignora cualquier id_empresa del cuerpo) y el rol solo puede ser
// ADMIN_EMPRESA o USUARIO: nunca ADMIN.
async function crear(datos, alcance) {
  const { nombre_usuario, contrasena, correo } = datos || {};
  if (!nombre_usuario || !contrasena) {
    throw new ErrorNegocio('Usuario y contraseña son obligatorios.');
  }
  const problema = problemaContrasenaNueva(contrasena, nombre_usuario);
  if (problema) throw new ErrorNegocio(problema);

  let rol, idEmpresa;
  if (esAlcanceEmpresa(alcance)) {
    if (['ADMIN', 'ADMIN_MULTIEMPRESA'].includes(datos.rol)) {
      throw new ErrorNegocio('No podés crear un usuario con ese rol.', 403);
    }
    rol = ROLES_EMPRESA.includes(datos.rol) ? datos.rol : 'USUARIO';
    idEmpresa = alcance.idEmpresa; // la empresa la fija el servidor, nunca el cuerpo
  } else {
    rol = ['ADMIN', 'ADMIN_EMPRESA', 'ADMIN_MULTIEMPRESA', 'USUARIO'].includes(datos.rol) ? datos.rol : 'USUARIO';
    idEmpresa = datos.id_empresa || null;
    // ADMIN y ADMIN_MULTIEMPRESA no pertenecen a una empresa: ADMIN_MULTIEMPRESA
    // recibe las suyas aparte, en USUARIOS_EMPRESAS (ver empresasAsignadas.servicio.js).
    if (!['ADMIN', 'ADMIN_MULTIEMPRESA'].includes(rol) && !idEmpresa) {
      throw new ErrorNegocio('Un usuario operativo debe pertenecer a una empresa.');
    }
  }

  const idEmpresaFinal = ['ADMIN', 'ADMIN_MULTIEMPRESA'].includes(rol) ? null : idEmpresa;
  try {
    const [result] = await pool.query('INSERT INTO USUARIOS SET ?', [{
      nombre_usuario,
      contrasena_hash: hashearContrasena(contrasena),
      correo: correo || null,
      id_empresa: idEmpresaFinal,
      rol,
      activo: 1,
      // La contraseña la eligió quien administra: el usuario la cambia al ingresar.
      debe_cambiar_contrasena: 1
    }]);
    return { id_usuario: result.insertId, nombre_usuario, rol, id_empresa: idEmpresaFinal };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ErrorNegocio('Ya existe un usuario con ese nombre.', 409);
    throw err;
  }
}

// Actualiza un usuario dentro del alcance. quienEjecuta es req.usuario (quien
// hace el pedido), para las reglas sobre uno mismo.
async function actualizar(idUsuario, datos, alcance, quienEjecuta) {
  const objetivo = await buscarEnAlcance(idUsuario, alcance);
  if (!objetivo) throw new ErrorNegocio('Usuario no encontrado.', 404);

  const esSiMismo = quienEjecuta && Number(quienEjecuta.id_usuario) === Number(objetivo.id_usuario);
  const esAdminOriginal = !esAlcanceEmpresa(alcance) && objetivo.nombre_usuario === 'admin' && objetivo.rol === 'ADMIN';

  const { nombre_usuario, contrasena, correo, rol, activo } = datos || {};
  let { id_empresa } = datos || {};
  const data = {};

  const asignarContrasena = () => {
    const problema = problemaContrasenaNueva(contrasena, nombre_usuario || objetivo.nombre_usuario);
    if (problema) throw new ErrorNegocio(problema);
    data.contrasena_hash = hashearContrasena(contrasena);
    // Contraseña asignada a OTRO: queda temporal y cierra sus sesiones abiertas.
    if (!esSiMismo) {
      data.debe_cambiar_contrasena = 1;
      data.version_sesion = (Number(objetivo.version_sesion) || 0) + 1;
    }
  };

  if (esAdminOriginal) {
    // Del admin original (seed) solo se puede tocar la contraseña y el correo.
    if (contrasena) asignarContrasena();
    if (correo !== undefined) data.correo = correo || null;
    if (Object.keys(data).length === 0) {
      throw new ErrorNegocio('Del usuario administrador principal solo se puede cambiar la contraseña.');
    }
    if (activo !== undefined && !activo) throw new ErrorNegocio('No se puede desactivar al administrador principal.', 403);
    if (rol !== undefined && rol !== 'ADMIN') throw new ErrorNegocio('No se puede cambiar el rol del administrador principal.', 403);
    if (nombre_usuario !== undefined && nombre_usuario !== 'admin') throw new ErrorNegocio('No se puede renombrar al administrador principal.', 403);
  } else {
    if (esSiMismo && activo !== undefined && !activo) {
      throw new ErrorNegocio('No podés desactivar tu propio usuario mientras estás conectado.', 403);
    }

    if (esAlcanceEmpresa(alcance)) {
      if (['ADMIN', 'ADMIN_MULTIEMPRESA'].includes(rol)) {
        throw new ErrorNegocio('No podés asignar ese rol.', 403);
      }
      id_empresa = alcance.idEmpresa; // la empresa la fija el servidor: se ignora la del cuerpo
    }

    if (nombre_usuario !== undefined) data.nombre_usuario = nombre_usuario;
    if (correo !== undefined) data.correo = correo || null;
    if (rol !== undefined) data.rol = rol;
    if (id_empresa !== undefined) data.id_empresa = id_empresa || null;
    if (activo !== undefined) data.activo = activo ? 1 : 0;
    if (contrasena) asignarContrasena();

    // Coherencia: ADMIN y ADMIN_MULTIEMPRESA no tienen empresa (ADMIN_MULTIEMPRESA
    // recibe las suyas aparte, en USUARIOS_EMPRESAS); un usuario operativo debe tenerla.
    if (['ADMIN', 'ADMIN_MULTIEMPRESA'].includes(data.rol)) data.id_empresa = null;
    if (data.rol && !['ADMIN', 'ADMIN_MULTIEMPRESA'].includes(data.rol) && data.id_empresa === null) {
      throw new ErrorNegocio('Un usuario operativo debe pertenecer a una empresa.');
    }

    // El rol o la empresa viajan en el token: si cambian, las sesiones
    // abiertas con el token anterior tienen que revalidar contra la base.
    const cambiaRol = data.rol !== undefined && data.rol !== objetivo.rol;
    const cambiaEmpresa = data.id_empresa !== undefined && data.id_empresa !== objetivo.id_empresa;
    if ((cambiaRol || cambiaEmpresa) && data.version_sesion === undefined) {
      data.version_sesion = (Number(objetivo.version_sesion) || 0) + 1;
    }

    // Una empresa que ya tiene un ADMIN_EMPRESA no puede quedarse sin ninguno.
    const vaADesactivarse = activo !== undefined && !activo;
    const vaADegradarse = cambiaRol;
    if (vaADesactivarse || vaADegradarse) {
      await validarNoUltimoAdminEmpresa(objetivo);
    }

    // Dejó de ser ADMIN_MULTIEMPRESA: ya no le corresponde ninguna empresa asignada.
    if (cambiaRol && objetivo.rol === 'ADMIN_MULTIEMPRESA' && data.rol !== 'ADMIN_MULTIEMPRESA') {
      await pool.query('DELETE FROM USUARIOS_EMPRESAS WHERE id_usuario = ?', [idUsuario]);
    }
  }

  try {
    const [result] = await pool.query('UPDATE USUARIOS SET ? WHERE id_usuario = ?', [data, idUsuario]);
    if (result.affectedRows === 0) throw new ErrorNegocio('Usuario no encontrado.', 404);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ErrorNegocio('Ya existe un usuario con ese nombre.', 409);
    throw err;
  }
  delete data.contrasena_hash;
  delete data.version_sesion;
  return { id_usuario: Number(idUsuario), ...data };
}

// Elimina un usuario dentro del alcance.
async function eliminar(idUsuario, alcance, quienEjecuta) {
  const objetivo = await buscarEnAlcance(idUsuario, alcance);
  if (!objetivo) throw new ErrorNegocio('Usuario no encontrado.', 404);

  if (objetivo.nombre_usuario === 'admin' && objetivo.rol === 'ADMIN') {
    throw new ErrorNegocio('No se puede eliminar al administrador principal del sistema.', 403);
  }
  if (quienEjecuta && Number(quienEjecuta.id_usuario) === Number(objetivo.id_usuario)) {
    throw new ErrorNegocio('No podés eliminar tu propio usuario mientras estás conectado.', 403);
  }
  await validarNoUltimoAdminEmpresa(objetivo);

  await pool.query('DELETE FROM USUARIOS WHERE id_usuario = ?', [idUsuario]);
  return { mensaje: 'Usuario eliminado correctamente.' };
}

module.exports = { listar, buscarEnAlcance, crear, actualizar, eliminar };
