// backend/src/modulos/admin/empresasAsignadas.servicio.js
// Empresas que un ADMIN_MULTIEMPRESA puede administrar y operar
// (USUARIOS_EMPRESAS). Solo lo llama el ADMIN de plataforma: es quien
// decide qué empresas ve cada usuario con ese rol.
const pool = require('../../config/db');
const { ErrorNegocio } = require('../../lib/errores');

// Empresas asignadas a un usuario, para pintar el selector del frontend.
async function listar(idUsuario) {
  const [rows] = await pool.query(`
    SELECT e.id_empresa, e.nombre, e.iniciales
    FROM USUARIOS_EMPRESAS ue
    JOIN EMPRESAS e ON e.id_empresa = ue.id_empresa
    WHERE ue.id_usuario = ?
    ORDER BY e.nombre
  `, [idUsuario]);
  return rows;
}

// Si el usuario tiene esa empresa asignada. Usado por el middleware que
// valida la cabecera X-Empresa-Id en cada pedido.
async function estaAsignada(idUsuario, idEmpresa) {
  const [[fila]] = await pool.query(
    'SELECT 1 FROM USUARIOS_EMPRESAS WHERE id_usuario = ? AND id_empresa = ? LIMIT 1',
    [idUsuario, idEmpresa]
  );
  return !!fila;
}

// Reemplaza el conjunto completo de empresas asignadas. Al cambiar qué
// empresas puede operar, las sesiones abiertas de ese usuario tienen que
// revalidar contra la base (mismo criterio que cambiar rol o contraseña).
async function asignar(idUsuario, idsEmpresas) {
  const [[usuario]] = await pool.query('SELECT rol FROM USUARIOS WHERE id_usuario = ?', [idUsuario]);
  if (!usuario) throw new ErrorNegocio('Usuario no encontrado.', 404);
  if (usuario.rol !== 'ADMIN_MULTIEMPRESA') {
    throw new ErrorNegocio('Solo se pueden asignar empresas a un usuario con rol ADMIN_MULTIEMPRESA.');
  }

  const ids = [...new Set((Array.isArray(idsEmpresas) ? idsEmpresas : [])
    .map(Number).filter(id => Number.isInteger(id) && id > 0))];

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    await conexion.query('DELETE FROM USUARIOS_EMPRESAS WHERE id_usuario = ?', [idUsuario]);
    if (ids.length > 0) {
      const valores = ids.map(idEmpresa => [idUsuario, idEmpresa]);
      await conexion.query('INSERT INTO USUARIOS_EMPRESAS (id_usuario, id_empresa) VALUES ?', [valores]);
    }
    await conexion.query('UPDATE USUARIOS SET version_sesion = version_sesion + 1 WHERE id_usuario = ?', [idUsuario]);
    await conexion.commit();
  } catch (err) {
    await conexion.rollback();
    if (err.code === 'ER_NO_REFERENCED_ROW' || err.code === 'ER_NO_REFERENCED_ROW_2') {
      throw new ErrorNegocio('Una de las empresas seleccionadas ya no existe.');
    }
    throw err;
  } finally {
    conexion.release();
  }
  return { id_usuario: Number(idUsuario), empresas: ids };
}

module.exports = { listar, estaAsignada, asignar };
