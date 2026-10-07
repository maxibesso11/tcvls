#!/usr/bin/env node
// backend/database/alta-cliente.js
// Alta de un cliente nuevo, siempre igual: crea la empresa con sus módulos y
// su administrador de empresa (ADMIN_EMPRESA), y deja impresa la lista de lo
// que falta hacer a mano (certificado ARCA, datos fiscales, primera entrega).
//
// Uso (desde la raíz, con el .env de la base):
//   node backend/database/alta-cliente.js                       guiado
//   node backend/database/alta-cliente.js --no-interactivo \
//        --nombre="Transportes Sur SRL" --cuit=30-12345678-9 \
//        --admin-usuario=sur.admin --admin-correo=admin@sur.com.ar
//   Opciones: --iniciales --domicilio --telefono --email --condicion-iva
//             --ingresos-brutos --inicio-actividades=AAAA-MM-DD --punto-venta
//             --modulos=viajes,equipos,... (por defecto todos)
//             --admin-contrasena=... (por defecto se genera una temporal)
//             --cuit-no-valida (acepta un CUIT con dígito verificador inválido)
//
// En Docker:  docker compose run --rm app node backend/database/alta-cliente.js
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { leerArgumentos, preguntar, generarContrasena, cuitValido, linea } = require('./ayudasCli');

const args = leerArgumentos();
const INTERACTIVO = !args['no-interactivo'] && process.stdin.isTTY;

function terminar(mensaje) {
  console.error(`\n✗ ${mensaje}`);
  process.exit(1);
}

async function dato(clave, etiqueta, opciones = {}) {
  if (args[clave] !== undefined && args[clave] !== true) return String(args[clave]);
  if (INTERACTIVO) return preguntar(etiqueta, opciones);
  return opciones.defecto || '';
}

async function main() {
  const pool = require('../src/config/db');
  const empresasServicio = require('../src/modulos/admin/empresas.servicio');
  const usuariosServicio = require('../src/modulos/admin/usuarios.servicio');
  const { verificar, informe } = require('../src/lib/verificacionEntorno');

  // La base tiene que estar instalada y al día antes de dar de alta a nadie.
  const previa = await verificar({ pool });
  if (previa.errores.length) {
    console.error(informe({ errores: previa.errores, avisos: [], correctos: [] }));
    await pool.end();
    terminar('El entorno no está listo para dar de alta clientes.');
  }

  console.log(`${linea()}\nAlta de cliente\n${linea()}`);
  const nombre = await dato('nombre', 'Razón social');
  if (!nombre) terminar('La razón social es obligatoria (--nombre=...).');
  const cuit = await dato('cuit', 'CUIT (con o sin guiones)');
  if (cuit && !cuitValido(cuit) && !args['cuit-no-valida']) {
    terminar(`El CUIT ${cuit} no es válido (dígito verificador). Revisalo, o usá --cuit-no-valida si es correcto.`);
  }
  const iniciales = await dato('iniciales', 'Iniciales del logo (hasta 4 letras)');
  const domicilio = await dato('domicilio', 'Domicilio');
  const telefono = await dato('telefono', 'Teléfono');
  const email = await dato('email', 'Email de la empresa');
  const condicion = await dato('condicion-iva', 'Condición frente al IVA (RESPONSABLE INSCRIPTO / MONOTRIBUTO / EXENTO)', { defecto: 'RESPONSABLE INSCRIPTO' });
  const puntoVenta = await dato('punto-venta', 'Punto de venta de ARCA', { defecto: '1' });
  const ingresosBrutos = await dato('ingresos-brutos', 'N° de Ingresos Brutos (opcional)');
  const inicioActividades = await dato('inicio-actividades', 'Inicio de actividades AAAA-MM-DD (opcional)');
  const modulos = args.modulos && args.modulos !== true ? String(args.modulos).split(',').map(s => s.trim()).filter(Boolean) : null;

  console.log(`\n${linea()}\nAdministrador de la empresa (lo gestiona el propio cliente)\n${linea()}`);
  const usuario = await dato('admin-usuario', 'Usuario');
  if (!usuario) terminar('Falta el usuario del administrador (--admin-usuario=...).');
  const correo = await dato('admin-correo', 'Correo del administrador (opcional)');
  let contrasena = args['admin-contrasena'] && args['admin-contrasena'] !== true ? String(args['admin-contrasena']) : '';
  if (!contrasena && INTERACTIVO) contrasena = await preguntar('Contraseña (vacío = generar una temporal)', { oculto: true });
  const generada = !contrasena;
  if (generada) contrasena = generarContrasena();

  let empresa;
  try {
    empresa = await empresasServicio.crear({
      nombre, iniciales, cuit: cuit || null, domicilio, telefono, email,
      condicion_iva: condicion, punto_venta: puntoVenta,
      ingresos_brutos: ingresosBrutos, inicio_actividades: inicioActividades || null
    }, modulos);
  } catch (err) {
    await pool.end();
    terminar(err.message);
  }

  try {
    await usuariosServicio.crear({ nombre_usuario: usuario, contrasena, correo: correo || null, rol: 'ADMIN_EMPRESA', id_empresa: empresa.id_empresa }, null);
  } catch (err) {
    // La empresa ya quedó creada: se avisa para completar el administrador desde el panel.
    console.error(`\n⚠ La empresa se creó (N° ${empresa.id_empresa}) pero no se pudo crear su administrador: ${err.message}`);
    console.error('  Creá el usuario desde Administración → Usuarios, o repetí con otro nombre de usuario.');
    await pool.end();
    process.exit(1);
  }

  console.log(`\n${linea()}\n✓ Cliente dado de alta\n${linea()}`);
  console.log(`  Empresa:        ${empresa.nombre} (N° ${empresa.id_empresa}, ${empresa.modulos.length} módulos activos)`);
  console.log(`  Administrador:  ${usuario}`);
  if (generada) {
    console.log(`  Contraseña:     ${contrasena}`);
    console.log('  ANOTALA y entregala por un canal seguro: no se vuelve a mostrar.');
  }
  console.log('  Al primer ingreso el sistema le pide elegir una contraseña propia.');
  console.log(`\nFalta, a mano (ver la lista de control en docs/operacion/ALTA_DE_CLIENTE.md):
  1. Completar los datos fiscales de la empresa (Administración → Empresas).
  2. Generar el certificado ARCA y cargar el .crt (Administración → Certificados ARCA).
  3. Cargar choferes, unidades y equipos; probar un viaje de punta a punta.
  4. Confirmar que el próximo respaldo diario incluye a la empresa nueva.`);
  await pool.end();
}

main().catch(err => terminar(err.message));
