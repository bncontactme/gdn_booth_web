# Photo Booth — Guadalajara De Noche

Photo booth que corre **entero en el navegador**. No hay que instalar nada:
se abre un link y ya funciona.

```
cámara  ->  cuenta regresiva  ->  foto  ->  Cloudinary  ->  código QR
```

---

## PARTE 1 — Para quien lo va a usar

**Todo lo que hay que hacer:**

1. Abrir el link del booth.
2. Cuando el navegador pregunte por la cámara, darle **Permitir**.
3. Presionar **Enter** (o tocar la pantalla) para tomar la foto.
4. Escanear el QR que aparece.

Eso es todo. No se instala nada.

### Atajos

| Tecla | Qué hace |
|---|---|
| **Enter** | Toma la foto |
| **5 Enter rápidos** | Cambia de escena (el "look" de la foto) |
| **F1** | Muestra el estado del booth y cómo arreglar lo que falle |
| **F11** | Pantalla completa (recomendado para el evento) |

### Si algo se ve mal

Presiona **F1**. El booth dice exactamente qué está fallando y cómo se
arregla, en español.

### Si se cae el internet

No se pierde nada. La foto se guarda dentro del navegador y se sube sola
en cuanto vuelve la conexión. Mientras tanto se muestra la foto en la
pantalla para que la persona le tome foto con su teléfono.

**Importante:** no cierres la pestaña hasta que F1 diga
`Fotos sin subir: 0`.

---

## PARTE 2 — Para quien lo instala (una sola vez)

### Paso 1 — Cloudinary

1. Entra a <https://cloudinary.com> y crea una cuenta (el plan gratis basta).
2. Copia tu **Cloud name** (aparece arriba a la izquierda en la consola).
3. Ve a **Settings → Upload → Upload presets → Add upload preset**:
   - **Signing Mode:** `Unsigned`  ← indispensable
   - **Folder:** `gdn_booth`
4. Guarda y copia el **nombre del preset**.

### Paso 2 — Configurar

Abre `booth-config.js` y llena los dos valores:

```js
cloudName:    "tu_cloud_name",
uploadPreset: "tu_preset",
```

Eso es lo único que hay que editar.

### Paso 3 — Publicar en GitHub Pages

1. Crea un repositorio **público** nuevo en GitHub.
2. Sube estos archivos:

```bash
git init && git add -A && git commit -m "Photo booth" && git branch -M main
```

3. En GitHub: **Settings → Pages → Source: Deploy from a branch →
   `main` / `(root)`** → Save.
4. Espera ~1 minuto. El link queda así:
   `https://TU-USUARIO.github.io/TU-REPO/`

Ese link es el que compartes.

---

## Cosas que hay que saber

**El `upload preset` es público.** Cualquiera que vea el código de la
página puede verlo y subir imágenes a tu cuenta de Cloudinary. Así
funcionan las subidas sin firma — no hay forma de esconderlo en una
página estática. Para que no sea un problema, en el preset de Cloudinary:

- limita el **tamaño máximo** de archivo,
- permite solo formato **jpg**,
- déjalo apuntando a la carpeta `gdn_booth`,
- y **bórralo o cámbialo cuando termine el evento**.

**Nunca pongas el `API Secret` de Cloudinary aquí.** Esta página es
pública; un secreto puesto acá queda expuesto para siempre. El booth no lo
necesita.

**Se necesita HTTPS.** Los navegadores solo dan acceso a la cámara en
páginas `https://`. GitHub Pages ya da HTTPS, así que funciona. Lo que no
funciona es abrir el `index.html` con doble clic desde el escritorio.

---

## Cambiar los "looks"

Las escenas están en `scenes.js`. Cada una es un filtro CSS:

```js
{
  id: "rizo",
  name: "Rizo",
  filter: "contrast(1.18) saturate(1.35) sepia(0.18)",
  vignette: 0.5,   // 0 a 1 — oscurece las orillas
  grain: 0.1,      // 0 a 1 — grano tipo película
}
```

Se cambian con 5 Enter rápidos durante el evento.

---

## Archivos

| Archivo | Qué es |
|---|---|
| `booth-config.js` | **Lo único que se edita.** Cloudinary y ajustes. |
| `scenes.js` | Los "looks" de las fotos. |
| `app.js` | Toda la lógica del booth. |
| `index.html` / `styles.css` | La pantalla. |
| `sw.js` | Hace que el booth abra aunque se caiga el WiFi. |
| `vendor/qrcode.min.js` | Generador de códigos QR (incluido, sin internet). |

---

## Diferencias con la versión de OBS

Esta versión no usa OBS. Los "looks" se hacen con filtros del navegador en
vez de escenas de OBS. A cambio no hay nada que instalar ni configurar en
la computadora del evento.

La versión con OBS sigue viviendo en el repositorio `gdn_photo_booth`.
