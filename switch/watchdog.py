#!/usr/bin/env python3
# ============================================================================
#  watchdog.py — Revisa que la pagina del booth siga viva
#  ---------------------------------------------------------------------
#  start.sh ya vuelve a abrir el navegador si el navegador se cae. Pero si
#  lo que truena es la PAGINA (la pantalla de "Aw, Snap!" o se congela), el
#  navegador sigue abierto y nadie la arregla. Esto le pregunta a la pagina
#  cada 20 s si esta viva (por el puerto de depuracion de Chromium, que solo
#  escucha en el mismo Switch). Si no contesta dos veces seguidas, deja una
#  marca para start.sh y cierra el navegador: start.sh lo abre de nuevo.
#  Tambien revisa la camara: si se desconecta o se congela (deja de llegar
#  video) por cerca de un minuto, igual reinicia: al abrir de nuevo, el
#  navegador vuelve a agarrar la camara.
#
#  Lo arranca start.sh; no se corre a mano.
#      watchdog.py <carpeta de estado> <puerto>
# ============================================================================

import base64
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

STATE_DIR = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 9222
STOP_FLAG = os.path.join(STATE_DIR, "stop")
RESTART_FLAG = os.path.join(STATE_DIR, "restart")

GRACE = 60      # al arrancar: tiempo para que la pagina cargue
EVERY = 20      # cada cuanto se pregunta
STRIKES = 2     # cuantas fallas seguidas antes de reiniciar
CAM_STRIKES = 3 # camara muerta o congelada: ~1 minuto antes de reiniciar


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S") + "  [vigilante] " + msg, flush=True)


def booth_page():
    """El websocket de depuracion de la pestaña del booth, o None."""
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=5) as r:
        targets = json.load(r)
    for t in targets:
        if t.get("type") == "page" and "gdn_booth_web" in t.get("url", ""):
            return t.get("webSocketDebuggerUrl")
    return None


def ws_evaluate(ws_url, expression, timeout=8):
    """Corre una expresion en la pagina por websocket (sin librerias)."""
    hostport, path = ws_url[len("ws://"):].split("/", 1)
    host, port = hostport.rsplit(":", 1)
    s = socket.create_connection((host, int(port)), timeout=timeout)
    try:
        key = base64.b64encode(os.urandom(16)).decode()
        s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\n"
                   "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                   f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = s.recv(4096)
            if not chunk:
                return None
            buf += chunk
        head, buf = buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            return None

        # El cliente siempre manda sus mensajes enmascarados.
        msg = json.dumps({"id": 1, "method": "Runtime.evaluate",
                          "params": {"expression": expression, "returnByValue": True}}).encode()
        mask = os.urandom(4)
        frame = bytearray([0x81])
        n = len(msg)
        if n < 126:
            frame.append(0x80 | n)
        else:
            frame.append(0x80 | 126)
            frame += n.to_bytes(2, "big")
        frame += mask
        frame += bytes(b ^ mask[i % 4] for i, b in enumerate(msg))
        s.sendall(bytes(frame))

        deadline = time.time() + timeout
        while time.time() < deadline:
            while len(buf) >= 2:
                opcode = buf[0] & 0x0F          # 1 = texto
                length, off = buf[1] & 0x7F, 2
                if length == 126:
                    if len(buf) < 4:
                        break
                    length, off = int.from_bytes(buf[2:4], "big"), 4
                elif length == 127:
                    if len(buf) < 10:
                        break
                    length, off = int.from_bytes(buf[2:10], "big"), 10
                if len(buf) < off + length:
                    break
                payload, buf = buf[off:off + length], buf[off + length:]
                if opcode == 1:
                    data = json.loads(payload)
                    if data.get("id") == 1:
                        return data
            s.settimeout(max(0.2, deadline - time.time()))
            chunk = s.recv(65536)
            if not chunk:
                return None
            buf += chunk
        return None
    finally:
        s.close()


# Lo que se le pregunta a la pagina: si cargo, como esta la camara ("live",
# "ended" si se desconecto, "none" si aun no arranca: pantalla del PIN) y
# cuantos cuadros de video lleva mostrados (si no sube, se congelo).
PROBE = ("(() => { const v = document.getElementById('video');"
         " const t = v && v.srcObject && v.srcObject.getVideoTracks()[0];"
         " const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : -1;"
         " return [document.readyState, t ? t.readyState : 'none', q]; })()")


def page_alive():
    """(viva, por que, estado de la camara, cuadros mostrados)"""
    try:
        ws = booth_page()
        if not ws:
            return False, "no esta la pestaña del booth"
        res = ws_evaluate(ws, PROBE)
        value = (((res or {}).get("result") or {}).get("result") or {}).get("value")
        if isinstance(value, list) and value[0] in ("interactive", "complete"):
            return True, value[0], value[1], value[2]
        return False, "la pagina no contesto", None, None
    except Exception as e:   # sin puerto, sin navegador, tiempo agotado...
        return False, type(e).__name__, None, None


def browser_main_pids():
    """El proceso principal del navegador del booth (no sus ayudantes)."""
    out = subprocess.run(["pgrep", "-f", "--", "--user-data-dir=[^ ]*gdn-photobooth"],
                         capture_output=True, text=True).stdout.split()
    pids = []
    for pid in out:
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                if b"--type=" not in f.read():
                    pids.append(int(pid))
        except OSError:
            pass
    return pids


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def restart_browser(reason):
    log(f"Algo fallo ({reason}). Se reinicia el navegador.")
    open(RESTART_FLAG, "w").close()
    pids = browser_main_pids()
    for pid in pids:
        try:
            os.kill(pid, 15)   # SIGTERM: que cierre por las buenas
        except OSError:
            pass
    # Si en 10 s sigue ahi, a la fuerza. Se vigila ESE proceso: start.sh abre
    # uno nuevo en cuanto este se va, y a ese no hay que tocarlo.
    for _ in range(20):
        if not any(alive(p) for p in pids):
            return
        time.sleep(0.5)
    log("El navegador no se cerro solo; se cierra a la fuerza.")
    for pid in pids:
        try:
            os.kill(pid, 9)
        except OSError:
            pass


def main():
    log(f"vigilando la pagina y la camara (cada {EVERY}s, puerto {PORT})")
    time.sleep(GRACE)
    strikes = cam_strikes = 0
    last_frames = None
    while not os.path.exists(STOP_FLAG):
        ok, why, cam, frames = page_alive()
        bad = None
        if not ok:
            strikes += 1
            log(f"sin respuesta {strikes}/{STRIKES}: {why}")
            if strikes >= STRIKES:
                bad = why
        else:
            strikes = 0
            # La camara: desconectada, o "viva" pero sin cuadros nuevos. Si
            # aun no arranca (pantalla del PIN) no se juzga.
            problem = None
            if cam == "ended":
                problem = "la camara se desconecto"
            elif cam == "live" and frames is not None and frames == last_frames:
                problem = "la camara se congelo"
            last_frames = frames if cam == "live" else None
            if problem:
                cam_strikes += 1
                log(f"{problem} {cam_strikes}/{CAM_STRIKES}")
                if cam_strikes >= CAM_STRIKES:
                    bad = problem
            else:
                cam_strikes = 0
        if bad:
            restart_browser(bad)
            strikes = cam_strikes = 0
            last_frames = None
            time.sleep(GRACE)
            continue
        time.sleep(EVERY)


if __name__ == "__main__":
    main()
