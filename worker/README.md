# Modo seguro — worker que firma las subidas

## Para qué es esto

Sin esto, el booth usa un **upload preset sin firma**. Funciona perfecto,
pero ese preset va escrito dentro de la página: cualquiera que abra el
código fuente lo puede copiar y subir cosas a tu cuenta de Cloudinary.

Con este worker, tu **API Secret vive en Cloudflare** y nunca llega al
navegador. La página solo pide una firma que vale unos minutos y sirve
para una sola foto.

Es gratis (plan free de Cloudflare) y se hace una vez.

---

## Instalación

### 1. Crea una cuenta en Cloudflare

<https://dash.cloudflare.com/sign-up> — gratis, no pide tarjeta.

### 2. Llena los datos públicos

Abre `wrangler.toml` y pon tu Cloud name y tu API Key
(los dos están en Cloudinary → **Settings → API Keys**):

```toml
CLOUDINARY_CLOUD_NAME = "tu_cloud_name"
CLOUDINARY_API_KEY    = "tu_api_key"
ALLOWED_ORIGIN        = "https://bncontactme.github.io"
```

> `ALLOWED_ORIGIN` es el candado: solo tu booth puede pedir firmas.

### 3. Guarda el secreto (este NO va en ningún archivo)

```bash
cd worker && npx wrangler secret put CLOUDINARY_API_SECRET
```

Te lo pregunta y lo guarda cifrado en Cloudflare. **Nunca lo escribas en
`wrangler.toml`** — ese archivo sí se sube a GitHub.

### 4. Publica

```bash
cd worker && npx wrangler deploy
```

Al final te da un link así:

```
https://gdn-booth-sign.TU-USUARIO.workers.dev
```

### 5. Conéctalo al booth

En `booth-config.js`:

```js
signUrl: "https://gdn-booth-sign.TU-USUARIO.workers.dev",
```

Sube el cambio:

```bash
git commit -am "Modo seguro" && git push
```

Listo. Presiona **F1** en el booth: debe decir
`Cloudinary: modo firmado (seguro)`.

---

## Después de esto

- Ya **no necesitas** el upload preset sin firma. Bórralo en Cloudinary.
- En Cloudinary → **Settings → Security**, puedes apagar
  **"Allow unsigned uploading"** por completo.
- El API Secret nunca sale de Cloudflare.

---

## PIN extra (opcional)

Si `booth-config.js` tiene `pin` lleno, la página pide ese PIN antes de
prender la cámara. Para que el worker también lo exija (y no solo la
página), pon el mismo valor en `BOOTH_PIN` dentro de `wrangler.toml` y
vuelve a correr `npx wrangler deploy`. Así, aunque alguien se salte la
pantalla de la página desde las herramientas del navegador, el worker
igual rechaza la firma sin el PIN correcto.

## Qué protege y qué no

| | Preset sin firma | Con este worker |
|---|---|---|
| Clave visible en la página | Sí | **No** |
| Cualquiera puede subir a tu cuenta | Sí | No |
| Limitado a tu booth | No | Sí (`ALLOWED_ORIGIN`) |
| Solo acepta IDs `capture_…` | No | Sí |
| Hay que instalar algo | No | Una vez |

El worker solo firma IDs con la forma `capture_1234567890123`, así que
nadie puede pedir una firma para sobrescribir otro archivo de tu cuenta.
