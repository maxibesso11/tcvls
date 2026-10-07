// backend/src/modulos/admin/empresas.servicio.js
// Alta de una empresa con sus módulos. Lo usan el panel del ADMIN
// (admin.rutas.js) y el alta de cliente por línea de comandos
// (backend/database/alta-cliente.js), para que ambos apliquen las mismas reglas.
const pool = require('../../config/db');
const { CLAVES, validarDependencias, conObligatorios } = require('../../config/modulos');
const { ErrorNegocio } = require('../../lib/errores');

const CONDICIONES_IVA = ['RESPONSABLE INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'];

// datos: { nombre, iniciales, cuit, domicilio, telefono, email, condicion_iva,
//          ingresos_brutos, inicio_actividades, punto_venta }
// modulos: lista de claves a activar; sin ella, todos (lo habitual en una empresa nueva).
async function crear(datos, modulos = null) {
  const nombre = String((datos && datos.nombre) || '').trim();
  if (!nombre) throw new ErrorNegocio('El nombre de la empresa es obligatorio.');
  if (datos.condicion_iva && !CONDICIONES_IVA.includes(datos.condicion_iva)) {
    throw new ErrorNegocio(`La condición frente al IVA debe ser una de: ${CONDICIONES_IVA.join(', ')}.`);
  }

  const elegidos = modulos ? conObligatorios(modulos.filter(m => CLAVES.includes(m))) : CLAVES;
  const errores = validarDependencias(elegidos);
  if (errores.length) throw new ErrorNegocio('Configuración de módulos incoherente:\n' + errores.join('\n'));

  const fila = {
    nombre,
    iniciales: String(datos.iniciales || '').trim().slice(0, 4).toUpperCase() || null,
    cuit: datos.cuit || null,
    domicilio: datos.domicilio || null,
    telefono: datos.telefono || null,
    email: datos.email || null,
    activa: 1
  };
  // Datos fiscales (opcionales al crear; se completan después desde el panel)
  if (datos.condicion_iva) fila.condicion_iva = datos.condicion_iva;
  if (datos.ingresos_brutos) fila.ingresos_brutos = datos.ingresos_brutos;
  if (datos.inicio_actividades) fila.inicio_actividades = datos.inicio_actividades;
  if (datos.punto_venta) fila.punto_venta = parseInt(datos.punto_venta, 10) || 1;

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [result] = await conexion.query('INSERT INTO EMPRESAS SET ?', [fila]);
    const idEmpresa = result.insertId;
    await conexion.query('INSERT INTO MODULOS_EMPRESA (id_empresa, modulo, activo) VALUES ?', [elegidos.map(m => [idEmpresa, m, 1])]);
    await conexion.commit();
    return { id_empresa: idEmpresa, nombre, modulos: elegidos };
  } catch (err) {
    await conexion.rollback();
    if (err.code === 'ER_DUP_ENTRY') throw new ErrorNegocio('Ya existe una empresa con ese CUIT.', 409);
    throw err;
  } finally {
    conexion.release();
  }
}

module.exports = { crear, CONDICIONES_IVA };
