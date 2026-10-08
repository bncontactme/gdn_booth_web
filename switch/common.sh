# ============================================================================
#  common.sh — Lo que comparten start.sh, stop.sh y check.sh
#  (no se corre solo: los otros scripts lo cargan)
# ============================================================================

# La pagina del booth. ?kiosk esconde el boton del editor y el cursor;
# &hand saca la mano que señala la esquina del boton cuando nadie lo usa;
# &layout= elige el marco de assets/layouts/ que va encima de la foto;
# &bg= el fondo de los lados (gdn-blanco: blanco con el logo chiquito).
# La firma de Cloudinary solo acepta este dominio, asi que no la cambies por
# una copia local: las fotos no subirian.
BOOTH_URL="${BOOTH_URL:-https://bncontactme.github.io/gdn_booth_web/?kiosk&hand&layout=cigarro-manzana&bg=gdn-blanco}"

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gdn-photobooth"
STOP_FLAG="$STATE_DIR/stop"
LOCK_FILE="$STATE_DIR/lock"
LOG_FILE="$STATE_DIR/booth.log"
SCREEN_BACKUP="$STATE_DIR/screen-settings"
XSET_BACKUP="$STATE_DIR/xset-settings"
INHIBIT_PID_FILE="$STATE_DIR/inhibit.pid"

# Solo en GNOME: lo que se apaga mientras el booth corre (y se deja como
# estaba al final): protector de pantalla, bloqueo y suspension.
# En KDE (el Switch) de eso se encarga kde-inhibit, sin tocar ajustes.
SCREEN_SETTINGS=(
    "org.gnome.desktop.session idle-delay 0"
    "org.gnome.desktop.screensaver idle-activation-enabled false"
    "org.gnome.desktop.screensaver lock-enabled false"
    "org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing"
)

log() {
    mkdir -p "$STATE_DIR"
    printf '%s  %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE"
}

notify() {
    command -v notify-send >/dev/null 2>&1 && notify-send "Photo Booth" "$1" 2>/dev/null
    return 0
}

# El log de Chromium crece mucho: si pasa de 5 MB se empieza de nuevo.
trim_log() {
    if [ -f "$LOG_FILE" ] && [ "$(wc -c <"$LOG_FILE")" -gt 5000000 ]; then
        tail -n 2000 "$LOG_FILE" >"$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
    fi
}

# El Chromium de Switchroot primero: es el que usa la grafica del Switch.
find_browser() {
    local b p
    for b in chromium-browser chromium google-chrome google-chrome-stable; do
        if p="$(command -v "$b" 2>/dev/null)"; then
            printf '%s\n' "$p"
            return 0
        fi
    done
    return 1
}

# En L4T los snaps no tienen aceleracion de video. El paquete
# chromium-browser de Ubuntu suele ser solo un script que abre el snap.
is_snap() {
    local real
    real="$(readlink -f "$1")"
    [ "$real" = "/usr/bin/snap" ] && return 0
    case "$real" in /snap/*) return 0 ;; esac
    if head -c 2 "$real" 2>/dev/null | grep -q '#!'; then
        grep -q '/snap/' "$real" && return 0
    fi
    return 1
}

# Perfil propio del booth (PIN, escena, fotos pendientes), aparte del
# navegador normal. El snap solo puede escribir dentro de ~/snap.
profile_dir() {
    if is_snap "$1"; then
        printf '%s\n' "$HOME/snap/chromium/common/gdn-photobooth"
    else
        printf '%s\n' "$STATE_DIR/chromium"
    fi
}

# Despues de un apagon Chromium ofrece "restaurar paginas" con un globo
# encima del booth. Se le dice que la vez pasada cerro bien.
mark_clean_exit() {
    local prefs="$1/Default/Preferences"
    [ -f "$prefs" ] || return 0
    sed -i \
        -e 's/"exited_cleanly":[a-z]*/"exited_cleanly":true/' \
        -e 's/"exit_type":"[A-Za-z]*"/"exit_type":"Normal"/' \
        "$prefs"
}

is_gnome() {
    case "${XDG_CURRENT_DESKTOP:-}" in *GNOME*|*Unity*|*ubuntu*) return 0 ;; esac
    return 1
}

# Un proceso que, mientras vive, le pide al escritorio que no se apague la
# pantalla, no se bloquee y no se suspenda. Va APARTE del navegador: si el
# navegador corriera dentro de kde-inhibit, al caerse parecería que lo
# cerraron a proposito y no se volveria a abrir.
start_inhibitor() {
    local cmd=()
    case "${XDG_CURRENT_DESKTOP:-}" in
        *KDE*) command -v kde-inhibit >/dev/null 2>&1 && cmd=(kde-inhibit --power --screenSaver) ;;
    esac
    if [ ${#cmd[@]} -eq 0 ] && command -v systemd-inhibit >/dev/null 2>&1; then
        cmd=(systemd-inhibit --what=idle:sleep --who="Photo Booth" --why="El photo booth esta corriendo")
    fi
    [ ${#cmd[@]} -eq 0 ] && return 0
    stop_inhibitor
    "${cmd[@]}" sleep infinity >/dev/null 2>&1 9>&- &
    printf '%s\n' "$!" >"$INHIBIT_PID_FILE"
}

stop_inhibitor() {
    [ -f "$INHIBIT_PID_FILE" ] || return 0
    local pid
    pid="$(cat "$INHIBIT_PID_FILE")"
    # Primero el "sleep" de adentro (asi el inhibidor termina solito y
    # suelta el permiso), luego el inhibidor por si acaso.
    pkill -P "$pid" 2>/dev/null
    kill "$pid" 2>/dev/null
    rm -f "$INHIBIT_PID_FILE"
    return 0
}

keep_awake() {
    start_inhibitor

    if command -v xset >/dev/null 2>&1; then
        # Como estaba (una sola vez), para dejarlo igual al apagar.
        if [ ! -f "$XSET_BACKUP" ]; then
            xset q 2>/dev/null | awk '/timeout:/ { t = $2 } /DPMS is/ { d = $3 } END { print t, d }' >"$XSET_BACKUP"
        fi
        xset s off s noblank -dpms 2>/dev/null
    fi

    is_gnome && command -v gsettings >/dev/null 2>&1 || return 0

    # Se guarda como estaba UNA vez: si el booth se cayo sin limpiar, el
    # respaldo bueno es el de antes, no el de "todo apagado".
    local spec schema key value current
    if [ ! -f "$SCREEN_BACKUP" ]; then
        : >"$SCREEN_BACKUP"
        for spec in "${SCREEN_SETTINGS[@]}"; do
            read -r schema key value <<<"$spec"
            current="$(gsettings get "$schema" "$key" 2>/dev/null)" || continue
            printf '%s\t%s\t%s\n' "$schema" "$key" "$current" >>"$SCREEN_BACKUP"
        done
    fi
    for spec in "${SCREEN_SETTINGS[@]}"; do
        read -r schema key value <<<"$spec"
        gsettings set "$schema" "$key" "$value" 2>/dev/null
    done
    return 0
}

allow_sleep() {
    stop_inhibitor
    if [ -f "$XSET_BACKUP" ] && command -v xset >/dev/null 2>&1; then
        local timeout dpms
        read -r timeout dpms <"$XSET_BACKUP"
        [ -n "$timeout" ] && xset s "$timeout" 2>/dev/null
        [ "$dpms" = "Enabled" ] && xset +dpms 2>/dev/null
    fi
    rm -f "$XSET_BACKUP"
    if [ -f "$SCREEN_BACKUP" ] && command -v gsettings >/dev/null 2>&1; then
        local schema key value
        while IFS=$'\t' read -r schema key value; do
            gsettings set "$schema" "$key" "$value" 2>/dev/null
        done <"$SCREEN_BACKUP"
    fi
    rm -f "$SCREEN_BACKUP"
    return 0
}
