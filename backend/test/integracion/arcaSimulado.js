// backend/test/integracion/arcaSimulado.js
// ARCA simulado para los tests: un servidor HTTP local que responde como el
// WSAA (LoginCms) y el WSFEv1 con las validaciones que más importan:
//   - numeración correlativa por punto de venta y tipo (error 10016);
//   - período y vencimiento obligatorios en servicios;
//   - IVA discriminado en A y B, sin IVA en C; total = neto + IVA;
//   - condición de IVA del receptor válida para la clase;
//   - nota de crédito con comprobante asociado.
// Cada método puede programarse para fallar (`programar`): rechazar, cortar
// la conexión sin procesar, o procesar y cortar antes de responder.
'use strict';
const http = require('http');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });
const RECEPTORES = { A: [1, 6, 13, 16], B: [4, 5, 7, 8, 9, 10, 15], C: [1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16] };
const CLASE = { 1: 'A', 3: 'A', 6: 'B', 8: 'B', 11: 'C', 13: 'C' };
const NC = new Set([3, 8, 13]);

function sobre(cuerpo) {
  return '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;
}
const escapar = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const errs = lista => lista.length ? '<Errors>' + lista.map(([c, m]) => `<Err><Code>${c}</Code><Msg>${escapar(m)}</Msg></Err>`).join('') + '</Errors>' : '';
const respuesta = (metodo, interior) =>
  sobre(`<${metodo}Response xmlns="http://ar.gov.afip.dif.FEV1/"><${metodo}Result>${interior}</${metodo}Result></${metodo}Response>`);
const hoyArca = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');

function crear() {
  const estado = {
    ultimo: {},          // `${pv}-${tipo}` → número
    comprobantes: {},    // `${pv}-${tipo}-${nro}` → datos
    pedidos: [],         // { metodo, cuerpo }
    logins: 0,
    programados: {},     // metodo → [acciones]
    actividades: []      // [{ id, orden, desc }] inscriptas del emisor
  };
  const clave = (pv, tipo, nro) => `${Number(pv)}-${Number(tipo)}` + (nro !== undefined ? `-${Number(nro)}` : '');

  function validar(cab, d) {
    const e = [];
    const tipo = Number(cab.CbteTipo);
    const letra = CLASE[tipo];
    const n = x => Number(x || 0);
    const esperado = (estado.ultimo[clave(cab.PtoVta, tipo)] || 0) + 1;
    if (Number(d.CbteDesde) !== esperado) e.push([10016, `El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Consultar metodo FECompUltimoAutorizado. Esperado ${esperado}`]);
    if (Number(d.Concepto) !== 1 && (!d.FchServDesde || !d.FchServHasta || !d.FchVtoPago)) e.push([10049, 'FchServDesde, FchServHasta y FchVtoPago son obligatorios para servicios']);
    if (Math.abs(n(d.ImpTotal) - (n(d.ImpNeto) + n(d.ImpIVA) + n(d.ImpTotConc) + n(d.ImpOpEx) + n(d.ImpTrib))) > 0.001) e.push([10048, 'ImpTotal no coincide con la suma de importes']);
    const alic = d.Iva ? [].concat(d.Iva.AlicIva) : [];
    if (letra === 'C' && (alic.length || n(d.ImpIVA) > 0)) e.push([10071, 'Para comprobantes tipo C no debe informarse IVA']);
    if (letra !== 'C' && !alic.length) e.push([10070, 'Si ImpNeto es mayor a 0 el objeto IVA es obligatorio']);
    if (alic.length && Math.abs(alic.reduce((s, a) => s + n(a.Importe), 0) - n(d.ImpIVA)) > 0.001) e.push([10051, 'La suma de AlicIva no coincide con ImpIVA']);
    const act = d.Actividades && d.Actividades.Actividad;
    if (act && !estado.actividades.some(a => String(a.id) === String(act.Id))) e.push([10223, `La actividad seleccionada ${act.Id} no se encuentra vinculada al emisor`]);
    if (!d.CondicionIVAReceptorId) e.push([10242, 'Falta CondicionIVAReceptorId']);
    else if (!RECEPTORES[letra].includes(Number(d.CondicionIVAReceptorId))) e.push([10243, `CondicionIVAReceptorId ${d.CondicionIVAReceptorId} no valida para clase ${letra}`]);
    if (letra === 'A' && Number(d.DocTipo) !== 80) e.push([10013, 'Para comprobantes A el receptor debe identificarse con CUIT']);
    if (NC.has(tipo)) {
      const a = d.CbtesAsoc && d.CbtesAsoc.CbteAsoc;
      if (!a) e.push([10197, 'Las notas de credito deben informar el comprobante asociado']);
      else if (!estado.comprobantes[clave(a.PtoVta, a.Tipo, a.Nro)]) e.push([10153, 'El comprobante asociado no existe']);
    }
    return e;
  }

  function manejar(metodo, cuerpo) {
    const c = cuerpo[metodo] || {};
    switch (metodo) {
      case 'FEDummy':
        return respuesta(metodo, '<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>');
      case 'FEParamGetActividades':
        return respuesta(metodo, '<ResultGet>' + estado.actividades.map(a =>
          `<ActividadesTipo><Id>${a.id}</Id><Orden>${a.orden}</Orden><Desc>${escapar(a.desc)}</Desc></ActividadesTipo>`).join('') + '</ResultGet>');
      case 'FECompUltimoAutorizado':
        return respuesta(metodo, `<PtoVta>${c.PtoVta}</PtoVta><CbteTipo>${c.CbteTipo}</CbteTipo><CbteNro>${estado.ultimo[clave(c.PtoVta, c.CbteTipo)] || 0}</CbteNro>`);
      case 'FECompConsultar': {
        const q = c.FeCompConsReq;
        const cbte = estado.comprobantes[clave(q.PtoVta, q.CbteTipo, q.CbteNro)];
        if (!cbte) return respuesta(metodo, errs([[602, 'Sin Resultados: - en la consulta por: PtoVta, CbteTipo, CbteNro']]));
        return respuesta(metodo, `<ResultGet><Concepto>2</Concepto><DocTipo>${cbte.DocTipo}</DocTipo><DocNro>${cbte.DocNro}</DocNro>` +
          `<CbteDesde>${cbte.CbteDesde}</CbteDesde><CbteFch>${cbte.CbteFch}</CbteFch><ImpTotal>${cbte.ImpTotal}</ImpTotal>` +
          `<Resultado>A</Resultado><CodAutorizacion>${cbte.cae}</CodAutorizacion><EmisionTipo>CAE</EmisionTipo><FchVto>${cbte.vto}</FchVto></ResultGet>`);
      }
      case 'FECAESolicitar': {
        const cab = c.FeCAEReq.FeCabReq;
        const d = c.FeCAEReq.FeDetReq.FECAEDetRequest;
        const accion = (estado.programados[metodo] || []).shift();
        const problemas = validar(cab, d);
        if (accion === 'rechazar') problemas.push([10000, 'Rechazo programado por el test']);
        if (problemas.length) {
          return { xml: respuesta(metodo, `<FeCabResp><Resultado>R</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>R</Resultado>` +
            `<CbteDesde>${d.CbteDesde}</CbteDesde><Observaciones>${problemas.map(([co, m]) => `<Obs><Code>${co}</Code><Msg>${escapar(m)}</Msg></Obs>`).join('')}</Observaciones>` +
            '</FECAEDetResponse></FeDetResp>'), accion };
        }
        if (accion === 'cortar-sin-procesar') return { cortar: true };
        const nro = Number(d.CbteDesde);
        const cae = String(70000000000000 + Object.keys(estado.comprobantes).length + 1);
        estado.ultimo[clave(cab.PtoVta, cab.CbteTipo)] = nro;
        estado.comprobantes[clave(cab.PtoVta, cab.CbteTipo, nro)] = { ...d, cae, vto: hoyArca() };
        if (accion === 'cortar-procesado') return { cortar: true };
        return respuesta(metodo, `<FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>A</Resultado>` +
          `<CbteDesde>${nro}</CbteDesde><CAE>${cae}</CAE><CAEFchVto>${hoyArca()}</CAEFchVto></FECAEDetResponse></FeDetResp>`);
      }
      default:
        return respuesta(metodo, errs([[600, `Metodo ${metodo} no simulado`]]));
    }
  }

  const servidor = http.createServer((req, res) => {
    let texto = '';
    req.on('data', d => { texto += d; });
    req.on('end', () => {
      const cuerpo = parser.parse(texto).Envelope.Body;
      if (req.url.startsWith('/wsaa')) {
        estado.logins += 1;
        const gen = new Date(), exp = new Date(Date.now() + 12 * 3600e3);
        const ta = `<?xml version="1.0" encoding="UTF-8"?><loginTicketResponse version="1.0"><header><source>CN=wsaahomo</source>` +
          `<destination>SERIALNUMBER=CUIT 20123456786</destination><uniqueId>1</uniqueId><generationTime>${gen.toISOString()}</generationTime>` +
          `<expirationTime>${exp.toISOString()}</expirationTime></header><credentials><token>TOKEN-SIMULADO</token><sign>SIGN-SIMULADO</sign></credentials></loginTicketResponse>`;
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(sobre(`<loginCmsResponse><loginCmsReturn>${escapar(ta)}</loginCmsReturn></loginCmsResponse>`));
      }
      const metodo = String(req.headers.soapaction || '').replace(/"/g, '').split('/').pop();
      estado.pedidos.push({ metodo, cuerpo: cuerpo[metodo] });
      const accion = metodo !== 'FECAESolicitar' ? (estado.programados[metodo] || []).shift() : null;
      if (accion === 'cortar') return req.socket.destroy();
      const r = manejar(metodo, cuerpo);
      if (r && r.cortar) return req.socket.destroy();
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(typeof r === 'string' ? r : r.xml);
    });
  });

  return {
    estado,
    programar(metodo, ...acciones) { (estado.programados[metodo] = estado.programados[metodo] || []).push(...acciones); },
    pedidosDe(metodo) { return estado.pedidos.filter(p => p.metodo === metodo); },
    escuchar: () => new Promise(r => servidor.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${servidor.address().port}`))),
    cerrar: () => new Promise(r => servidor.close(r))
  };
}

module.exports = { crear };
