// public/js/api.js - Cliente HTTP para la API del ERP
const API = {
  _token: null,
  _empresaContexto: null,

  setToken(token) {
    this._token = token;
    if (token) localStorage.setItem('erp_token', token);
    else localStorage.removeItem('erp_token');
  },

  cargarToken() {
    this._token = localStorage.getItem('erp_token');
    return this._token;
  },

  // Empresa que un ADMIN_MULTIEMPRESA eligió operar. Se guarda por pestaña
  // (sessionStorage, no localStorage): así dos pestañas pueden operar dos
  // empresas distintas sin cruzarse, y una pestaña nueva siempre obliga a
  // elegir explícitamente en vez de heredar la última usada.
  setEmpresaContexto(idEmpresa) {
    this._empresaContexto = idEmpresa || null;
    if (idEmpresa) sessionStorage.setItem('erp_empresa_contexto', idEmpresa);
    else sessionStorage.removeItem('erp_empresa_contexto');
  },

  cargarEmpresaContexto() {
    this._empresaContexto = sessionStorage.getItem('erp_empresa_contexto') || null;
    return this._empresaContexto;
  },

  async _solicitud(url, opciones = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    if (this._empresaContexto) headers['X-Empresa-Id'] = this._empresaContexto;
    const res = await fetch(url, { ...opciones, headers });
    const datos = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // Sesión vencida o inválida: limpiar y avisar al resto de la app
      this.setToken(null);
      window.dispatchEvent(new CustomEvent('sesion-expirada'));
      throw new Error(datos.error || 'Sesión expirada. Inicia sesión nuevamente.');
    }
    if (res.status === 403 && datos.codigo === 'CAMBIO_CONTRASENA_REQUERIDO') {
      // Contraseña temporal: la app muestra la pantalla de cambio obligatorio
      window.dispatchEvent(new CustomEvent('cambio-contrasena-requerido'));
    }
    if (!res.ok) throw new Error(datos.error || 'Error en la solicitud');
    return datos;
  },

  // ---------- Autenticación ----------
  login(nombre_usuario, contrasena) {
    return this._solicitud('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ nombre_usuario, contrasena })
    });
  },
  yo() { return this._solicitud('/api/auth/yo'); },
  cambiarContrasena(actual, nueva) {
    return this._solicitud('/api/auth/contrasena', { method: 'PUT', body: JSON.stringify({ actual, nueva }) });
  },
  guardarTema(tema) {
    return this._solicitud('/api/auth/tema', { method: 'PUT', body: JSON.stringify({ tema }) });
  },

  // ---------- Administración (solo ADMIN) ----------
  listarEmpresas() { return this._solicitud('/api/admin/empresas'); },
  crearEmpresa(datos) { return this._solicitud('/api/admin/empresas', { method: 'POST', body: JSON.stringify(datos) }); },
  actualizarEmpresa(id, datos) { return this._solicitud(`/api/admin/empresas/${id}`, { method: 'PUT', body: JSON.stringify(datos) }); },
  certificadoEstado(idEmpresa) { return this._solicitud(`/api/certificados/${idEmpresa}`); },
  certificadoGenerar(idEmpresa) { return this._solicitud(`/api/certificados/${idEmpresa}/generar`, { method: 'POST' }); },
  certificadoSubir(idEmpresa, certificado_pem) { return this._solicitud(`/api/certificados/${idEmpresa}/certificado`, { method: 'POST', body: JSON.stringify({ certificado_pem }) }); },
  certificadoEliminar(idEmpresa) { return this._solicitud(`/api/certificados/${idEmpresa}`, { method: 'DELETE' }); },
  descargarCSR(idEmpresa, nombreArchivo) {
    return this.descargarArchivo(`/api/certificados/${idEmpresa}/csr`, nombreArchivo || 'solicitud.csr');
  },

  // ---------- Mi empresa (solo ADMIN_EMPRESA) ----------
  miEmpresaListarUsuarios() { return this._solicitud('/api/empresa/usuarios'); },
  miEmpresaCrearUsuario(datos) { return this._solicitud('/api/empresa/usuarios', { method: 'POST', body: JSON.stringify(datos) }); },
  miEmpresaActualizarUsuario(id, datos) { return this._solicitud(`/api/empresa/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(datos) }); },
  miEmpresaEliminarUsuario(id) { return this._solicitud(`/api/empresa/usuarios/${id}`, { method: 'DELETE' }); },
  miEmpresaCertificadoEstado() { return this._solicitud('/api/empresa/certificado'); },
  miEmpresaCertificadoGenerar() { return this._solicitud('/api/empresa/certificado/generar', { method: 'POST' }); },
  miEmpresaCertificadoSubir(certificado_pem) { return this._solicitud('/api/empresa/certificado', { method: 'POST', body: JSON.stringify({ certificado_pem }) }); },
  miEmpresaCertificadoEliminar() { return this._solicitud('/api/empresa/certificado', { method: 'DELETE' }); },
  miEmpresaDescargarCSR() { return this.descargarArchivo('/api/empresa/certificado/csr', 'solicitud.csr'); },
  miEmpresaDatosFiscales() { return this._solicitud('/api/empresa/datos-fiscales'); },
  miEmpresaGuardarDatosFiscales(datos) { return this._solicitud('/api/empresa/datos-fiscales', { method: 'PUT', body: JSON.stringify(datos) }); },

  // ---------- Mi multiempresa (solo ADMIN_MULTIEMPRESA) ----------
  // Todas viajan con la cabecera X-Empresa-Id (ver setEmpresaContexto), que
  // indica sobre cuál de sus empresas asignadas está operando.
  multiempresaListarUsuarios() { return this._solicitud('/api/multiempresa/usuarios'); },
  multiempresaCrearUsuario(datos) { return this._solicitud('/api/multiempresa/usuarios', { method: 'POST', body: JSON.stringify(datos) }); },
  multiempresaActualizarUsuario(id, datos) { return this._solicitud(`/api/multiempresa/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(datos) }); },
  multiempresaEliminarUsuario(id) { return this._solicitud(`/api/multiempresa/usuarios/${id}`, { method: 'DELETE' }); },
  multiempresaCertificadoEstado() { return this._solicitud('/api/multiempresa/certificado'); },
  multiempresaCertificadoGenerar() { return this._solicitud('/api/multiempresa/certificado/generar', { method: 'POST' }); },
  multiempresaCertificadoSubir(certificado_pem) { return this._solicitud('/api/multiempresa/certificado', { method: 'POST', body: JSON.stringify({ certificado_pem }) }); },
  multiempresaCertificadoEliminar() { return this._solicitud('/api/multiempresa/certificado', { method: 'DELETE' }); },
  multiempresaDescargarCSR() { return this.descargarArchivo('/api/multiempresa/certificado/csr', 'solicitud.csr'); },
  multiempresaDatosFiscales() { return this._solicitud('/api/multiempresa/datos-fiscales'); },
  multiempresaGuardarDatosFiscales(datos) { return this._solicitud('/api/multiempresa/datos-fiscales', { method: 'PUT', body: JSON.stringify(datos) }); },

  // ---------- Historial de equipos ----------
  historialEquipo(idEquipo) { return this._solicitud(`/api/equipos/${idEquipo}/historial`); },
  bajaEquipo(idEquipo, fecha) {
    return this._solicitud(`/api/equipos/${idEquipo}/baja`, { method: 'POST', body: JSON.stringify({ fecha }) });
  },
  reactivarEquipo(idEquipo) { return this._solicitud(`/api/equipos/${idEquipo}/reactivar`, { method: 'POST' }); },
  moverInicioPeriodo(idHistorial, desde) {
    return this._solicitud(`/api/equipos/historial/${idHistorial}`, { method: 'PUT', body: JSON.stringify({ desde }) });
  },

  // Descarga un archivo protegido (PDF, CSR) enviando el token por cabecera.
  // Nunca por la URL: ahí quedaría registrado en los logs del servidor y en el
  // historial del navegador. El nombre lo toma de Content-Disposition.
  async descargarArchivo(ruta, nombrePorDefecto) {
    const headers = {};
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    if (this._empresaContexto) headers['X-Empresa-Id'] = this._empresaContexto;
    const res = await fetch(ruta, { headers });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'No se pudo descargar el archivo');
    }
    const disposicion = res.headers.get('content-disposition') || '';
    const nombre = (disposicion.match(/filename="?([^";]+)"?/) || [])[1] || nombrePorDefecto;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  listarUsuarios() { return this._solicitud('/api/admin/usuarios'); },
  crearUsuario(datos) { return this._solicitud('/api/admin/usuarios', { method: 'POST', body: JSON.stringify(datos) }); },
  actualizarUsuario(id, datos) { return this._solicitud(`/api/admin/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(datos) }); },
  eliminarUsuario(id) { return this._solicitud(`/api/admin/usuarios/${id}`, { method: 'DELETE' }); },
  catalogoModulos() { return this._solicitud('/api/admin/modulos/catalogo'); },
  modulosDeEmpresa(id) { return this._solicitud(`/api/admin/empresas/${id}/modulos`); },
  guardarModulosEmpresa(id, modulos) { return this._solicitud(`/api/admin/empresas/${id}/modulos`, { method: 'PUT', body: JSON.stringify({ modulos }) }); },
  // Herramientas de sistema (ADMIN): registros del servidor y respaldos
  adminLogs(params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
    return this._solicitud(`/api/admin/sistema/logs?${q}`);
  },
  adminAuditoria(p = {}) {
    const q = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v) q.set(k, v); });
    return this._solicitud(`/api/admin/auditoria?${q}`);
  },
  miEmpresaAuditoria(p = {}) {
    const q = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v) q.set(k, v); });
    return this._solicitud(`/api/empresa/auditoria?${q}`);
  },
  multiempresaAuditoria(p = {}) {
    const q = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v) q.set(k, v); });
    return this._solicitud(`/api/multiempresa/auditoria?${q}`);
  },
  adminRespaldos() { return this._solicitud('/api/admin/sistema/respaldos'); },
  descargarRespaldo(nombre) { return this.descargarArchivo(`/api/admin/sistema/respaldos/${encodeURIComponent(nombre)}`, nombre); },
  usuarioEmpresasAsignadas(id) { return this._solicitud(`/api/admin/usuarios/${id}/empresas`); },
  asignarEmpresasUsuario(id, empresas) { return this._solicitud(`/api/admin/usuarios/${id}/empresas`, { method: 'PUT', body: JSON.stringify({ empresas }) }); },

  // Listado paginado para tablas. Devuelve { datos, paginacion }.
  listar(recurso, q = '', idEquipo = '', deposito = '', extras = {}, pagina = 1) {
    const params = new URLSearchParams();
    if (q)        params.set('q', q);
    if (idEquipo) params.set('id_equipo', idEquipo);
    if (deposito) params.set('deposito', deposito);
    // extras: { estado, tipo_carga, fecha_desde, fecha_hasta, orden, dir }
    Object.entries(extras).forEach(([k, v]) => { if (v) params.set(k, v); });
    params.set('pagina', pagina);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this._solicitud(`/api/${recurso}${query}`);
  },

  // Trae TODOS los registros de un recurso (para llenar selectores/dropdowns).
  // Recorre las páginas si hiciera falta y devuelve un array plano.
  async listarTodo(recurso) {
    const primera = await this._solicitud(`/api/${recurso}?por_pagina=200&pagina=1`);
    // Compatibilidad: si el endpoint no devuelve el formato paginado, asumir array
    if (Array.isArray(primera)) return primera;
    let datos = primera.datos || [];
    const totalPaginas = primera.paginacion ? primera.paginacion.total_paginas : 1;
    for (let p = 2; p <= totalPaginas; p++) {
      const r = await this._solicitud(`/api/${recurso}?por_pagina=200&pagina=${p}`);
      datos = datos.concat(r.datos || []);
    }
    return datos;
  },

  obtener(recurso, id) {
    return this._solicitud(`/api/${recurso}/${id}`);
  },

  crear(recurso, datos) {
    return this._solicitud(`/api/${recurso}`, {
      method: 'POST',
      body: JSON.stringify(datos)
    });
  },

  actualizar(recurso, id, datos) {
    return this._solicitud(`/api/${recurso}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(datos)
    });
  },

  eliminar(recurso, id) {
    return this._solicitud(`/api/${recurso}/${id}`, { method: 'DELETE' });
  },

  // Métricas del dashboard (aceptan filtros opcionales de fecha/equipo)
  _dashQuery(base, params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const q = qs.toString() ? `?${qs.toString()}` : '';
    return this._solicitud(`/api/dashboard/${base}${q}`);
  },
  kpis(params = {}) { return this._dashQuery('kpis', params); },
  alertas() { return this._solicitud('/api/dashboard/alertas'); },
  rendimientoEquipos() { return this._solicitud('/api/dashboard/rendimiento-equipos'); },
  rendimientoChoferes() { return this._solicitud('/api/dashboard/rendimiento-choferes'); },
  saldosCuentas() { return this._solicitud('/api/dashboard/saldos-cuentas'); },
  clientesTop() { return this._solicitud('/api/dashboard/clientes-top'); },
  consumosPorEquipo(params = {}) { return this._dashQuery('consumos-por-equipo', params); },
  ingresosPorViaje(params = {}) { return this._dashQuery('ingresos-por-viaje', params); },
  rentabilidadEquipos(params = {}) { return this._dashQuery('rentabilidad-equipos', params); },
  gastosAdministrativos(params = {}) { return this._dashQuery('gastos-administrativos', params); },

  // Cuentas corrientes
  resumenCuentasCorrientes(q = '', pagina = 1) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('pagina', pagina);
    return this._solicitud(`/api/cuentas-corrientes?${params.toString()}`);
  },
  detalleCuentaCorriente(id) {
    return this._solicitud(`/api/cuentas-corrientes/${id}`);
  },
  liquidablesSueldosFijos(periodo) {
    return this._solicitud(`/api/cuentas-corrientes/liquidar-sueldos-fijos?periodo=${periodo}`);
  },
  liquidarSueldosFijos(periodo, idChoferes) {
    const body = { periodo };
    if (idChoferes) body.id_choferes = idChoferes;
    return this._solicitud('/api/cuentas-corrientes/liquidar-sueldos-fijos', { method: 'POST', body: JSON.stringify(body) });
  },
  descargarPdfCuenta(id) {
    return this.descargarArchivo(`/api/cuentas-corrientes/${id}/pdf`, `resumen_cuenta_${id}.pdf`);
  },
  descargarPdfLiquidacionesPeriodo(periodo) {
    return this.descargarArchivo(`/api/cuentas-corrientes/liquidacion-sueldos/periodo/${periodo}/pdf`, `liquidacion_sueldos_${periodo}.pdf`);
  },
  descargarPdfLiquidacion(id) {
    return this.descargarArchivo(`/api/cuentas-corrientes/liquidacion-sueldos/${id}/pdf`, `recibo_sueldo_${id}.pdf`);
  },

  // Facturación electrónica
  configuracionFacturacion() { return this._solicitud('/api/facturacion/configuracion'); },
  listarFacturas(pagina = 1, filtros = {}) {
    const params = new URLSearchParams({ pagina, ...filtros });
    return this._solicitud(`/api/facturacion?${params.toString()}`);
  },
  obtenerFactura(id) { return this._solicitud(`/api/facturacion/${id}`); },
  viajesFacturables(idCuenta, idFactura) {
    return this._solicitud(`/api/facturacion/viajes-facturables?id_cuenta=${idCuenta}${idFactura ? `&id_factura=${idFactura}` : ''}`);
  },
  prepararFactura(idCuenta, viajes) {
    return this._solicitud('/api/facturacion/preparar', { method: 'POST', body: JSON.stringify({ id_cuenta: idCuenta, viajes }) });
  },
  guardarFactura(id, datos) {
    return id
      ? this._solicitud(`/api/facturacion/${id}`, { method: 'PUT', body: JSON.stringify(datos) })
      : this._solicitud('/api/facturacion', { method: 'POST', body: JSON.stringify(datos) });
  },
  eliminarFactura(id) { return this._solicitud(`/api/facturacion/${id}`, { method: 'DELETE' }); },
  emitirFactura(id) { return this._solicitud(`/api/facturacion/${id}/emitir`, { method: 'POST', body: '{}' }); },
  verificarFactura(id) { return this._solicitud(`/api/facturacion/${id}/verificar`, { method: 'POST', body: '{}' }); },
  notaCredito(id, observaciones) {
    return this._solicitud(`/api/facturacion/${id}/nota-credito`, { method: 'POST', body: JSON.stringify({ observaciones }) });
  },
  guardarPlantillasCliente(idCuenta, datos) {
    return this._solicitud(`/api/facturacion/plantillas/${idCuenta}`, { method: 'PUT', body: JSON.stringify(datos) });
  },
  descargarPdfFactura(id, nombre) {
    return this.descargarArchivo(`/api/facturacion/${id}/pdf`, nombre || `comprobante_${id}.pdf`);
  },

  // Operaciones de stock
  depositos() { return this._solicitud('/api/stock/depositos'); },
  moverDeposito(origen, destino) {
    return this._solicitud('/api/stock/mover-deposito', {
      method: 'POST',
      body: JSON.stringify({ origen, destino })
    });
  }
};
