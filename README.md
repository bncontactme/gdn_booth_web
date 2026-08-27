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
3. Presionar **Enter** o el botón **Presiona Enter Para Tomar Foto**.
4. Escanear el QR que aparece.

Eso es todo. No se instala nada.

### Atajos

| Tecla | Qué hace |
|---|---|
| **Enter** | Toma la foto (o el botón de abajo) |
| **5 Enter rápidos** | Cambia de escena (el "look" de la foto) |
| **F2** | Abre el editor de capas (o el botón **⚙ Escena**, arriba a la derecha) |
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

> **Opcional pero recomendado:** hay un **modo seguro** en el que tu clave
> de Cloudinary nunca aparece en la página. Se monta una vez y es gratis.
> Ver [`worker/README.md`](worker/README.md). Puedes empezar con el preset
> normal y cambiarte después sin tocar nada más.

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

**El `upload preset` es público** (si NO usas el modo seguro del
`worker/`). Cualquiera que vea el código de la página puede verlo y subir
imágenes a tu cuenta de Cloudinary. Así funcionan las subidas sin firma — no hay forma de esconderlo en una
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

## Armar tu propio marco (F2) — lo que antes se hacía en OBS

Presiona **F2** —o toca el botón **⚙ Escena** de arriba a la derecha— y se
abre el editor de capas. Funciona como OBS: todo lo que se ve es una **capa**
que se puede mover, estirar, girar, esconder y ordenar.

El botón se esconde solo mientras se toma la foto, para que no estorbe.

**Para poner un marco:**

1. **F2** (o **⚙ Escena**) → **Agregar imagen…** y elige tu PNG.
2. Si el PNG es vertical 9:16 entra solo como marco de pantalla completa.
   Si no, arrástralo y estíralo desde las esquinas.
3. Asegúrate de que el marco esté **arriba de la Cámara** en la lista
   (arriba = al frente). Con **▲ / ▼** se cambia el orden.
4. Cierra con **F2**. Ya queda guardado.

**La cámara también es una capa:** selecciónala y cámbiale el tamaño igual
que a una imagen. Así se hacen los montajes donde la foto va en un recuadro
y el resto es diseño.

| Acción | Cómo |
|---|---|
| Mover | Arrastrar |
| Cambiar tamaño | Arrastrar las esquinas o los lados |
| Conservar la proporción | **Shift** mientras arrastras una esquina |
| Mover finito | Flechas del teclado (**Shift** = más rápido) |
| Borrar una capa | **Supr** o la **✕** de su renglón |
| Esconder sin borrar | El **👁** de su renglón |
| Opacidad y giro | Los dos deslizadores del panel |
| Ajustar / Llenar / Centrar | Botones de **Encuadre** |

### Formato de la foto

En el panel, **Formato de la foto**:

| Formato | Sale | Para qué |
|---|---|---|
| **Story** | 1080×1920 (9:16) | Vertical, para historias. El de siempre. |
| **Completo** | 1920×1080 (16:9) | Horizontal: **llena la pantalla** del evento, sin barras a los lados. |
| **Perfil** | 1920×1920 (1:1) | Cuadrado, tipo foto de perfil. |

Cambiar de formato reacomoda la pantalla y la foto al instante. Las capas
conservan su posición en proporción, así que conviene darles una revisada
después de cambiar.

### Fondo

En **Fondo** se elige lo que va **atrás de todo**: se ve en la pantalla
(incluidas las barras de los lados) y **también sale en la foto** cuando la
cámara no cubre todo — por ejemplo en Perfil, o si achicaste la cámara.

Vienen **GDN**, **Blanco** y **Negro**. Para agregar más, edita
`backgrounds` en `booth-config.js`:

```js
backgrounds: [
  { id: "gdn",    name: "GDN",    image: "assets/logo.jpg" },
  { id: "blanco", name: "Blanco", color: "#ffffff" },
  { id: "rosa",   name: "Rosa",   color: "#ff2d95" },
],
```

### Guías para acomodar

Al abrir el editor aparecen dos ayudas encima del escenario (**nunca salen
en la foto**, son solo del editor):

- **Esquinas y borde blanco** — hasta ahí llega la foto. Lo que quede
  fuera de ese borde **no sale** en la imagen final.
- **Recuadro punteado** — el *margen seguro*. Lo importante (caras, logos,
  texto) conviene que quede adentro: pegado a la orilla se ve apretado y en
  algunas pantallas se recorta. Se cambia con `safeMargin` en
  `booth-config.js` (`0.06` = 6%; `0` lo apaga).
- **Rejilla de tercios** — las líneas que dividen la pantalla en 9. Poner
  las caras cerca de los cruces suele verse mejor que centrarlas.

### Alineación automática

Al seleccionar una capa aparecen **medidas verdes** con la distancia a cada
orilla de la foto, en píxeles de la imagen final (1080×1920). Cuando el
número de la izquierda y el de la derecha son iguales, está centrada — sin
tener que adivinar.

Al arrastrar, las capas se **pegan solas** y aparece una **línea verde**
mostrando con qué se están alineando. Se pega a:

- el centro de la pantalla (horizontal y vertical),
- las orillas y el margen seguro,
- **las orillas y el centro de las otras capas** — así se alinean varios
  logos entre sí sin andar midiendo.

Basta con acercarse; el resto lo hace solo. Si en algún momento estorba,
usa las **flechas del teclado**, que mueven sin imán.

**Importante:** usa PNG con fondo transparente para los marcos. Un JPG no
tiene transparencia y taparía la cámara por completo.

**Todo se guarda solo** en esa computadora (dentro del navegador). Para pasar
el montaje a otra máquina usa **Exportar** y luego **Importar** allá.

> La foto final sale **exactamente** igual a lo que se ve en pantalla, en
> 1080×1920 (9:16, tamaño de historia).

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
| `layers.js` | El editor de capas de **F2** (marcos, logos, cámara). |
| `app.js` | Toda la lógica del booth. |
| `index.html` / `styles.css` | La pantalla. |
| `sw.js` | Hace que el booth abra aunque se caiga el WiFi. |
| `worker/` | Modo seguro opcional: firma las subidas sin exponer tu clave. |
| `vendor/qrcode.min.js` | Generador de códigos QR (incluido, sin internet). |

---

## Diferencias con la versión de OBS

Esta versión no usa OBS: el montaje se arma dentro de la misma página con
el editor de **F2** (capas, marcos y tamaño de cámara) y los "looks" se
hacen con filtros del navegador. A cambio no hay nada que instalar ni
configurar en la computadora del evento.

La versión con OBS sigue viviendo en el repositorio `gdn_photo_booth`.
