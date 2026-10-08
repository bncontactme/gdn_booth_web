# Photo Booth en el Switch

El Switch (con el Linux de Switchroot) corre el mismo booth de siempre, a
pantalla completa, desde la página de GitHub:

```
https://bncontactme.github.io/gdn_booth_web/?kiosk
```

No lleva OBS ni Node: solo Chromium. El `?kiosk` esconde el botón del
editor y el cursor.

---

## Instalar (una vez, en casa)

1. En el Switch abre una **Terminal** y baja el booth:

   ```bash
   wget -qO- https://github.com/bncontactme/gdn_booth_web/archive/refs/heads/main.tar.gz | tar xz
   ```

2. Instálalo:

   ```bash
   bash gdn_booth_web-main/switch/install.sh
   ```

   Deja dos íconos, en el escritorio y en el menú: **Photo Booth** y
   **Detener Photo Booth**. Al final revisa la cámara, el navegador, el
   internet y si la radio sigue prendida.

3. Abre **Photo Booth** una vez con teclado: pide el **PIN** (el de
   `booth-config.js`). Ese Switch ya no lo vuelve a pedir.

4. Si armaste el marco en otra compu (**F2 → Exportar**), aquí haz
   **F2 → Importar**.

> ¿Quieres que se prenda solo al encender el Switch?
> `bash gdn_booth_web-main/switch/install.sh --autostart`

### Modo ligero (recomendado para eventos)

El Switch trae prendidas muchas cosas que el booth no usa (la radio,
impresoras, Bluetooth, actualizaciones automáticas…). Esto las apaga y las
quita del arranque, para que la cámara tenga toda la memoria:

```bash
bash ~/.local/share/gdn-photobooth/lean-mode.sh
```

Para dejar todo exactamente como estaba: `lean-mode.sh --undo`.

> Incluye las actualizaciones automáticas de seguridad. Después del
> evento corre `--undo`, o actualiza a mano de vez en cuando.

La **radio** se apaga y prende con sus propios íconos (**RADIO STOP** /
**RADIO START**).

### Pantalla bloqueada

Mientras el booth corre, la pantalla **no** se bloquea. Pero antes de
prenderlo el Switch es una compu normal: si se queda 5 minutos sin usar,
se bloquea y pide la contraseña.

Para que la contraseña se pida **solo una vez, al prender**, y nunca más
(ni por estar sin usar, ni al despertar):

```bash
kwriteconfig5 --file kscreenlockerrc --group Daemon --key Autolock false
kwriteconfig5 --file kscreenlockerrc --group Daemon --key LockOnResume false
qdbus org.freedesktop.ScreenSaver /ScreenSaver configure
```

Para volver a como estaba: los mismos comandos con `true`.

---

## En el evento

| Qué | Cómo |
|---|---|
| **Prender** | Ícono **Photo Booth**. En el dock la pantalla táctil está apagada: tócalo **antes** de meterlo al dock, o usa un mouse (o instala con `--autostart`). |
| **Tomar foto** | El botón gigante (es un Enter). Una vez = foto. |
| **Cambiar el look** | 5 veces rápido el botón. |
| **Apagar** | Ícono **Detener Photo Booth**, o con teclado **Alt+F4**. |

Mientras está prendido:

- **Si el navegador se cae, se vuelve a abrir solo.**
- La pantalla no se apaga, no se bloquea y el Switch no se duerme.
- Apretar el ícono otra vez no abre un segundo booth.
- Dejar el botón apretado no cuenta como varias fotos.

---

## Si algo falla

- **Revisión rápida** (solo mira, no cambia nada):

  ```bash
  bash ~/.local/share/gdn-photobooth/check.sh
  ```

- **F1** dentro del booth: estado de la cámara, el internet y las fotos sin
  subir.
- **Bitácora:** `~/.local/state/gdn-photobooth/booth.log`

| Problema | Qué hacer |
|---|---|
| `check.sh` dice que Chromium es el **snap** | Funciona, pero sin la gráfica del Switch y el video va lento. Instala el `chromium-browser` de Switchroot. |
| No se ve la cámara | Conéctala al dock (los puertos de los lados) y vuelve a correr `check.sh`. |
| La radio (AzuraCast) está corriendo | Le quita memoria al booth. Ícono **RADIO STOP**, o `lean-mode.sh`. |
| Las fotos no suben | Revisa el WiFi. Las fotos se guardan y suben solas cuando vuelve; no apagues el booth hasta que F1 diga `Fotos sin subir: 0`. |

---

## Archivos

| Archivo | Qué hace |
|---|---|
| `install.sh` | Instala los íconos (`--autostart`, `--remove`). |
| `start.sh` | Ícono **Photo Booth**: abre Chromium en kiosco y lo reabre si se cae. |
| `stop.sh` | Ícono **Detener Photo Booth**. |
| `check.sh` | Revisa cámara, navegador, internet, radio y modo ligero. |
| `lean-mode.sh` | Apaga lo que el booth no usa (`--undo` lo regresa). |
| `common.sh` | Ajustes que comparten los demás (la dirección del booth, carpetas). |
