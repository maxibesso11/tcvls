# Instalación limpia y alta de un cliente

Dos procedimientos, siempre en este orden y siempre igual:

1. **Instalación limpia** (una sola vez por servidor o por base): crea las
   tablas, **sin datos de prueba**, y el administrador de plataforma.
2. **Alta de cliente** (una vez por cada empresa): crea la empresa con sus
   módulos y su administrador de empresa.

Todos los comandos se corren desde la raíz del proyecto. En el servidor (Docker)
se anteponen `sudo docker compose run --rm app` a cada `node …`.

> La base de producción ya instalada **no se reinstala nunca**: se actualiza con
> `migrar.js` (ver [SERVIDOR.md](SERVIDOR.md)). `instalar.js` se niega a tocar
> una base que ya tiene tablas.

---

## 1. Instalación limpia

### Antes de empezar
- MySQL 8 con la base **vacía** y su usuario ya creados. Con Docker los crea
  `docker compose up -d` a partir del `.env`; en un servidor sin Docker, `deploy/setup-db.sh`.
- El `.env` completo (copiar de `.env.example`). Los dos secretos se generan con
  `openssl rand -hex 48` y **deben ser distintos**:
  `AUTH_SECRET` y `CERT_SECRET`. **`CERT_SECRET` no se cambia nunca más** y se
  guarda también fuera del servidor: sin él no se pueden descifrar los
  certificados ARCA guardados.

### Pasos
```bash
# 1. Verificar el entorno (la base vacía va a figurar como error: es lo esperado)
npm run verificar-entorno

# 2. Instalar: tablas + administrador de plataforma (pregunta usuario y contraseña;
#    sin contraseña, genera una temporal y la muestra UNA vez)
node backend/database/instalar.js

# 3. Verificar de nuevo: tiene que decir "Listo para arrancar"
npm run verificar-entorno

# 4. Arrancar
npm start        # o: docker compose up -d
```

Para scripts o instalaciones sin teclado:
`node backend/database/instalar.js --no-interactivo --admin-usuario=plataforma --admin-correo=...`

**Datos de prueba** (solo desarrollo, demos internas): se agregan con
`--con-datos-de-prueba`. Traen usuarios `admin/admin123` y `demo/demo123`
(contraseñas públicas). Nunca en un cliente.

### Qué verifica el sistema solo cada vez que arranca
Si algo de esto falla, el servidor **no arranca** y explica cómo corregirlo:
secretos válidos y distintos · conexión con la base · base instalada · en
producción, migraciones al día. Y avisa (sin frenar) de: CORS abierto, ARCA
mal configurado, correo de la landing sin configurar, ningún administrador,
usuarios de ejemplo con contraseña pública, respaldo diario que no corre.

---

## 2. Alta de un cliente

### Datos que hay que juntar antes
- Razón social, CUIT, domicilio, teléfono y correo de la empresa.
- Condición frente al IVA, punto de venta de ARCA, Ingresos Brutos e inicio de actividades.
- Quién será el administrador de la empresa: nombre de usuario y correo.
- Qué módulos contrata (por defecto, todos).

### Comando
```bash
node backend/database/alta-cliente.js                # guiado
# o, sin teclado:
node backend/database/alta-cliente.js --no-interactivo \
   --nombre="Transportes Sur SRL" --cuit=30-50001091-2 --iniciales=TS \
   --admin-usuario=sur.admin --admin-correo=admin@sur.com.ar
```
Valida el CUIT (dígito verificador), crea la empresa con sus módulos y el
`ADMIN_EMPRESA`, y muestra la contraseña temporal **una sola vez**. El
administrador debe elegir una propia al primer ingreso.

### Lista de control (ejecutarla completa, en orden)

**Antes del alta**
- [ ] `npm run verificar-entorno` sin errores.
- [ ] Hay un respaldo del día (`sudo cat /var/backups/tcv-bd/ULTIMO_OK`).

**Alta**
- [ ] `alta-cliente.js` terminó con "Cliente dado de alta".
- [ ] La contraseña temporal quedó anotada y se entrega por un canal seguro
      (nunca junto con el usuario por el mismo mensaje).

**Configuración de la empresa** (como administrador de plataforma, en *Administración*)
- [ ] *Empresas*: datos fiscales completos (condición IVA, Ingresos Brutos, inicio de actividades, punto de venta).
- [ ] *Empresas → Módulos*: solo los contratados.
- [ ] *Certificados ARCA*: generar clave y CSR → subirlo a ARCA → cargar el `.crt` → estado **Activo**.
      Detalle en [HABILITAR_FACTURACION_ARCA.md](../facturacion/HABILITAR_FACTURACION_ARCA.md).

**Prueba con el usuario del cliente**
- [ ] Ingresa con el administrador de empresa, cambia la contraseña y ve su panel (Usuarios, Certificado ARCA, Datos de la empresa, Actividad).
- [ ] **No** ve otras empresas ni el panel de plataforma.
- [ ] Crea un usuario operativo de prueba y ese usuario ingresa.
- [ ] Carga una unidad, un chofer y un equipo; registra un viaje de punta a punta.
- [ ] *Actividad* muestra lo que se acaba de hacer.

**Cierre**
- [ ] Desactivar o borrar los usuarios de prueba que se hayan creado.
- [ ] El día siguiente: el respaldo diario corrió (`ULTIMO_OK` nuevo) y el panel *Respaldos* lo muestra.
- [ ] Anotar fecha de alta, versión instalada y quién lo hizo.

---

## 3. Copias de seguridad y restauración

Ya están automatizadas (detalle y comandos en [SERVIDOR.md](SERVIDOR.md#respaldos)):

| Qué | Cuándo |
|-----|--------|
| Respaldo comprimido, cifrado y subido a Drive | Todos los días 03:30 y antes de cada despliegue |
| Restauración de prueba en una base temporal, con comparación de filas por tabla | Todos los domingos 04:00 |

**Restauración probada.** Antes de entregar un servidor a producción y luego una
vez por trimestre:
- [ ] `sudo tcv-verificar-respaldo` termina con "Restauración verificada".
- [ ] Se bajó un `.age` de Drive, se descifró con la clave privada guardada fuera
      del servidor y se restauró en una base temporal (paso B de `MIGRACION_DOCKER.md`).
- [ ] Se anotó la fecha de la última prueba.

El estado de los respaldos también se ve en *Administración → Respaldos*.
