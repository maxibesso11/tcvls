// public/js/api.js - Cliente HTTP para la API del ERP
const API = {
  _token: null,

  setToken(token) {
    this._token = token;
    if (token) localStorage.setItem('erp_token', token);
    else localStorage.removeItem('erp_token');
  },

  cargarToken() {
    this._token = localStorage.getItem('erp_token');
    return this._token;
  },

  async _solicitud(url, opciones = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    const res = await fetch(url, { ...opciones, headers });
    const datos = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // Sesión vencida o inválida: limpiar y avisar al resto de la app
      this.setToken(null);
      window.dispatchEvent(new CustomEvent('sesion-expirada'));
      throw new Error(datos.error || 'Sesión expirada. Inicia sesión nuevamente.');
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
  guardarTema(tema) {
    return this._solicitud('/api/auth/tema', { method: 'PUT', body: JSON.stringify({ tema }) });
  },

  // ---------- Administración (solo ADMIN) ----------
  listarEmpresas() { return this._solicitud('/api/admin/empresas'); },
  crearEmpresa(datos) { return this._solicitud('/api/admin/empresas', { method: 'POST', body: JSON.stringify(datos) }); },
  actualizarEmpresa(id, datos) { return this._solicitud(`/api/admin/empresas/${id}`, { method: 'PUT', body: JSON.stringify(datos) }); },
  listarUsuarios() { return this._solicitud('/api/admin/usuarios'); },
  crearUsuario(datos) { return this._solicitud('/api/admin/usuarios', { method: 'POST', body: JSON.stringify(datos) }); },
  actualizarUsuario(id, datos) { return this._solicitud(`/api/admin/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(datos) }); },
  eliminarUsuario(id) { return this._solicitud(`/api/admin/usuarios/${id}`, { method: 'DELETE' }); },
  catalogoModulos() { return this._solicitud('/api/admin/modulos/catalogo'); },
  modulosDeEmpresa(id) { return this._solicitud(`/api/admin/empresas/${id}/modulos`); },
  guardarModulosEmpresa(id, modulos) { return this._solicitud(`/api/admin/empresas/${id}/modulos`, { method: 'PUT', body: JSON.stringify({ modulos }) }); },

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
  urlPdfCuenta(id) {
    const t = this._token ? `?token=${encodeURIComponent(this._token)}` : '';
    return `/api/cuentas-corrientes/${id}/pdf${t}`;
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
