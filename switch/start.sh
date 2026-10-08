#!/usr/bin/env bash
# ============================================================================
#  start.sh — Prende el Photo Booth en el Switch (icono "Photo Booth")
#  ---------------------------------------------------------------------
#  Abre el booth a pantalla completa y lo cuida: si el navegador se cae, lo
#  vuelve a abrir solo. Sigue corriendo hasta que:
#    - se usa el icono "Detener Photo Booth" (stop.sh), o
#    - alguien con teclado lo cierra a proposito (Alt+F4).
#
#  Mientras corre, la pantalla no se apaga ni se bloquea. Todo lo que pasa
#  queda en ~/.local/state/gdn-photobooth/booth.log
# ============================================================================

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"

mkdir -p "$STATE_DIR"
trim_log

# Solo una copia a la vez: apretar el icono otra vez no abre otro booth.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "Ya estaba prendido; no se abre otra copia."
    exit 0
fi
rm -f "$STOP_FLAG"

if ! BROWSER="$(find_browser)"; then
    log "ERROR: no encontre Chromium."
    notify "No encontré Chromium. Corre check.sh para ver qué falta."
    exit 1
fi
if is_snap "$BROWSER"; then
    log "AVISO: $BROWSER es el snap: funciona, pero sin aceleracion de video."
fi
PROFILE="$(profile_dir "$BROWSER")"
mkdir -p "$PROFILE"

FLAGS=(
    --kiosk
    --user-data-dir="$PROFILE"
    # Da permiso de camara sin preguntar (igual que el booth de la PC).
    --use-fake-ui-for-media-stream
    --autoplay-policy=no-user-gesture-required
    # Nada de ventanitas encima del booth.
    --noerrdialogs
    --disable-infobars
    --disable-session-crashed-bubble
    # Chromium solo respeta el ULTIMO --disable-features: va junto con el
    # que ya pone el Chromium de Switchroot (TFLite...) para no anularlo.
    --disable-features=Translate,TranslateUI,TFLiteLanguageDetectionEnabled,MediaRouter,OptimizationHints
    # Lo que Chromium hace "por su cuenta" y el booth no necesita: buscar
    # actualizaciones, sincronizar, extensiones, mandar reportes. Menos
    # memoria y procesador para la camara. (La subida de fotos no cambia.)
    --disable-background-networking
    --disable-component-update
    --disable-sync
    --disable-default-apps
    --disable-extensions
    --disable-breakpad
    --no-pings
    # Para que watchdog.py le pueda preguntar a la pagina si sigue viva.
    # Solo escucha dentro del mismo Switch.
    --remote-debugging-port="$DEBUG_PORT"
    --no-first-run
    --no-default-browser-check
    --check-for-update-interval=31536000
    # Sin esto, al entrar sin contraseña pide desbloquear el llavero.
    --password-store=basic
    # Que un dedo en la pantalla no haga zoom ni regrese de pagina.
    --disable-pinch
    --overscroll-history-navigation=0
)

keep_awake

# Vigilante de la PAGINA (si se cae el navegador entero, de eso se encarga
# el ciclo de abajo).
rm -f "$RESTART_FLAG"
WATCHDOG_PID=""
if command -v python3 >/dev/null 2>&1; then
    python3 "$HERE/watchdog.py" "$STATE_DIR" "$DEBUG_PORT" >>"$LOG_FILE" 2>&1 9>&- &
    WATCHDOG_PID=$!
fi
trap '[ -n "$WATCHDOG_PID" ] && kill "$WATCHDOG_PID" 2>/dev/null; allow_sleep; log "Booth apagado."' EXIT

log "Prendiendo el booth con $BROWSER: $BOOTH_URL"
while :; do
    [ -f "$STOP_FLAG" ] && break
    mark_clean_exit "$PROFILE"

    # 9>&- : el navegador no hereda el candado. Si lo heredara, un proceso
    # suyo que se quede colgado dejaria el booth "prendido" para siempre.
    "$BROWSER" "${FLAGS[@]}" "$BOOTH_URL" >>"$LOG_FILE" 2>&1 9>&-
    code=$?

    [ -f "$STOP_FLAG" ] && break
    if [ -f "$RESTART_FLAG" ]; then
        # Lo cerro el vigilante porque la pagina no respondia.
        rm -f "$RESTART_FLAG"
        log "El vigilante cerro el navegador (pagina sin respuesta). Se vuelve a abrir."
        sleep 2
        continue
    fi
    if [ "$code" -eq 0 ]; then
        # Codigo 0 = lo cerraron a proposito (Alt+F4). Si se cae, el codigo
        # es otro y se vuelve a abrir.
        log "Lo cerraron con el teclado. El booth se apaga."
        break
    fi
    log "El navegador se cerro solo (codigo $code). Se vuelve a abrir en 3 s."
    sleep 3
done
