// ============================================================================
//  app.js — Photo Booth 100% en el navegador
//  ---------------------------------------------------------------------
//  No hay servidor. Todo pasa en la pagina:
//    camara -> cuenta regresiva -> captura -> JPEG -> Cloudinary -> QR
//
//  Si no hay internet la foto NO se pierde: se guarda en el navegador
//  (IndexedDB) y se sube sola en cuanto vuelve la conexion. Mientras tanto
//  se muestra la foto en pantalla para que le tomen foto con el telefono.
// ============================================================================

const CFG = Object.assign({
    cloudName: "",
    uploadPreset: "",
    signUrl: "",
    pin: "",
    folder: "gdn_booth",
    countdownSeconds: 3,
    qrSeconds: 18,
    jpegQuality: 0.85,
    maxLongEdge: 1920,
    mirror: true,
    safeMargin: 0.06,
    backgrounds: null,
    background: "gdn",
    format: "story",
    showPhotoFrame: true,
    buttonText: "Presiona el botón para tomar tu foto",
    qrMessage: "¡Escanea para descargar tu foto!",
    kiosk: false,
    handCorner: "bottom-right",
    handAfterSeconds: 20,
    handImage: "assets/hand.png",
    layout: "",
}, window.BOOTH_CONFIG || {});

// ?kiosk en la direccion prende el modo kiosco sin tocar booth-config.js
// (asi lo abre el Switch; la misma pagina en una compu sigue normal).
const KIOSK = CFG.kiosk || new URLSearchParams(location.search).has("kiosk");

const SCENES = (window.BOOTH_SCENES && window.BOOTH_SCENES.length)
    ? window.BOOTH_SCENES
    : [{ id: "default", name: "Normal", filter: "none", vignette: 0, grain: 0 }];

const RETRY_INTERVAL = 15000;
const ENTER_COMBO_WINDOW = 2000;
const ENTER_COMBO_COUNT = 5;
const SCENE_DISPLAY_MS = 1800;
const UPLOAD_TIMEOUT_MS = 20000;
const FALLBACK_DISPLAY_MS = 20000;
// Cuanto se espera a que la foto termine de subir antes de enseñar el QR de
// todos modos. Con buen internet sube antes; con malo, el QR no se atora.
const QUICK_UPLOAD_MS = 6000;
const CURSOR_IDLE_MS = 3000;

const $ = (id) => document.getElementById(id);
const video = $("video");
const canvas = $("canvas");
const frameEl = $("frame");
const vignetteEl = $("vignette");
const grainEl = $("grain");
const captureBtn = $("capture");
const buttonContainer = $("button-container");
const countdownOverlay = $("countdown-overlay");
const countdownNumber = $("countdown-number");
const flashEl = $("flash");
const uploadingOverlay = $("uploading-overlay");
const uploadBar = $("upload-bar");
const qrOverlay = $("qr-overlay");
const qrImage = $("qr-image");
const qrMessageEl = $("qr-message");
const qrHintEl = $("qr-hint");
const resultPhoto = $("result-photo");
const resultTitle = $("result-title");
const resultBar = $("result-bar");
const sceneOverlay = $("scene-overlay");
const sceneNameEl = $("scene-name");
const healthPanel = $("health-panel");
const healthBody = $("health-body");
const healthBadge = $("health-badge");
const healthBadgeText = $("health-badge-text");
const healthCloseBtn = $("health-close");
const lockOverlay = $("lock-overlay");
const lockInput = $("lock-input");
const lockError = $("lock-error");
const lockSubmitBtn = $("lock-submit");
const editorOpenBtn = $("editor-open");

let currentStream = null;
let sessionPin = "";
let sceneIndex = 0;
let busy = false;              // countdown / capture / upload in progress
let counting = false;          // solo la cuenta regresiva (parte de busy)
let cameraError = null;
let enterCount = 0;
let enterTimer = null;
let countdownTimer = null;
let overlayTimer = null;
let healthAutoShown = false;

const show = (el) => el.classList.add("show");
const hide = (el) => el.classList.remove("show");
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── Cola de subida persistente (IndexedDB) ──────────────────────────────────
// Aguanta que se cierre el navegador: las fotos siguen ahi al volver.

const DB_NAME = "gdn_booth";
const STORE = "pending";
let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: "publicId" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function dbRun(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
        tx.onerror = () => reject(tx.error);
    });
}

const queueAdd = (item) => dbRun("readwrite", (s) => s.put(item));
const queueRemove = (publicId) => dbRun("readwrite", (s) => s.delete(publicId));
const queueAll = () => dbRun("readonly", (s) => s.getAll());

async function queueCount() {
    try { return (await queueAll()).length; } catch { return 0; }
}

// ── Camara ──────────────────────────────────────────────────────────────────

async function initCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
        currentStream = null;
    }

    if (!window.isSecureContext) {
        cameraError = "insecure";
        checkHealth();
        return;
    }

    try {
        currentStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user",
                width:  { ideal: 1920 },
                height: { ideal: 1080 },
            },
            audio: false,
        });
        video.srcObject = currentStream;
        cameraError = null;

        const s = currentStream.getVideoTracks()[0].getSettings();
        console.log(`[Camara] ${s.width}x${s.height} — ${currentStream.getVideoTracks()[0].label}`);
    } catch (err) {
        console.error("[Camara] Error:", err.name, err.message);
        cameraError = err.name === "NotAllowedError" ? "denied"
                    : err.name === "NotFoundError"   ? "notfound"
                    : "unknown";
    }
    checkHealth();
}

// ── Escenas ─────────────────────────────────────────────────────────────────

// Textura de grano generada una sola vez y reutilizada.
const grainTile = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = 90 + Math.random() * 76;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
})();

const grainUrl = grainTile.toDataURL();

function applyScene() {
    const scene = SCENES[sceneIndex];

    // La capa de camara la maneja layers.js (posicion, tamano y espejo);
    // aqui solo se le pasa el "look" de la escena.
    BoothLayers.setCamera({
        filter: scene.filter || "none",
        mirror: CFG.mirror !== false,
    });

    vignetteEl.style.opacity = String(scene.vignette || 0);
    grainEl.style.opacity = String(scene.grain || 0);
    grainEl.style.backgroundImage = `url(${grainUrl})`;
    grainEl.style.backgroundRepeat = "repeat";
}

/**
 * Arma la foto final: pinta todas las capas (camara + imagenes) en el mismo
 * orden y con la misma geometria que la vista previa, y encima el look de la
 * escena. La foto queda igual que lo que la gente vio en pantalla.
 */
function drawFrame() {
    const cam = BoothLayers.cameraLayer();
    const camReady = video.videoWidth > 0 && video.videoHeight > 0;

    // Si la camara esta visible pero todavia no da imagen, no hay foto que
    // tomar. Si la escondieron a proposito, se puede capturar solo el montaje.
    if (cam.visible && !camReady) return null;

    // El lado LARGO manda, sea alto (Story) o ancho (Completo).
    const ar = BoothLayers.aspect();
    const long = Math.max(320, Math.round(CFG.maxLongEdge));
    const outW = ar >= 1 ? long : Math.round(long * ar);
    const outH = ar >= 1 ? Math.round(long / ar) : long;

    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");

    // Sin esto las imagenes que se achican salen con el borde dentado: el
    // canvas suaviza en calidad "low" por defecto.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Las medidas del editor se muestran en pixeles de ESTA foto.
    BoothLayers.setPhotoSize(outW, outH);

    const scene = SCENES[sceneIndex];

    BoothLayers.drawTo(ctx, outW, outH, {
        filter: scene.filter || "none",
        mirror: CFG.mirror !== false,
    });

    // Vineta
    if (scene.vignette) {
        const g = ctx.createRadialGradient(
            outW / 2, outH / 2, Math.min(outW, outH) * 0.28,
            outW / 2, outH / 2, Math.max(outW, outH) * 0.72
        );
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${0.55 * scene.vignette})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, outW, outH);
    }

    // Grano
    if (scene.grain) {
        ctx.save();
        ctx.globalAlpha = scene.grain;
        ctx.globalCompositeOperation = "overlay";
        ctx.fillStyle = ctx.createPattern(grainTile, "repeat");
        ctx.fillRect(0, 0, outW, outH);
        ctx.restore();
    }

    return canvas;
}

function canvasToJpeg(cv) {
    return new Promise((resolve) => cv.toBlob(resolve, "image/jpeg", CFG.jpegQuality));
}

// ── Subida a Cloudinary (preset sin firma) ──────────────────────────────────

// Hay dos formas de subir, y el booth elige sola:
//
//   MODO FIRMADO (si booth-config.js tiene signUrl)
//     Un worker guarda la clave secreta y devuelve una firma de un solo uso.
//     Nada sensible vive en esta pagina.
//
//   MODO PRESET (si solo hay cloudName + uploadPreset)
//     Mas facil de montar, pero el preset queda a la vista de cualquiera.
const usingSignedMode = () => Boolean(CFG.signUrl);

function isConfigured() {
    return usingSignedMode() || Boolean(CFG.cloudName && CFG.uploadPreset);
}

/**
 * Donde va a quedar una foto en Cloudinary. Se sabe ANTES de subirla
 * (carpeta + nombre), asi que el QR puede salir aunque la subida tarde:
 * el link empieza a funcionar en cuanto la foto termina de subir.
 */
function cloudinaryUrlFor(publicId, cloudName = CFG.cloudName) {
    const folderPart = CFG.folder ? `${CFG.folder}/` : "";
    return `https://res.cloudinary.com/${cloudName}/image/upload/${folderPart}${publicId}.jpg`;
}

async function fetchSignature(publicId, signal) {
    const res = await fetch(CFG.signUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId, pin: sessionPin }),
        signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `firma HTTP ${res.status}`);
    if (!data.signature || !data.apiKey || !data.cloudName) {
        throw new Error("el worker respondio incompleto");
    }
    return data;
}

async function uploadToCloudinary(blob, publicId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    try {
        const fd = new FormData();
        fd.append("file", blob);

        let cloudName = CFG.cloudName;

        if (usingSignedMode()) {
            const sig = await fetchSignature(publicId, controller.signal);
            cloudName = sig.cloudName;
            fd.append("api_key", sig.apiKey);
            fd.append("timestamp", String(sig.timestamp));
            fd.append("signature", sig.signature);
            fd.append("public_id", sig.publicId);
            if (sig.folder) fd.append("folder", sig.folder);
        } else {
            fd.append("upload_preset", CFG.uploadPreset);
            fd.append("public_id", publicId);
            if (CFG.folder) fd.append("folder", CFG.folder);
        }

        const res = await fetch(
            `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
            { method: "POST", body: fd, signal: controller.signal }
        );
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const msg = (data.error && data.error.message) || `HTTP ${res.status}`;

            // El preset tiene overwrite=false. Si un reintento manda una foto
            // que Cloudinary ya recibio, la rechaza — pero la foto SI esta
            // arriba, asi que cuenta como exito. Sin esto la cola reintentaria
            // esa foto para siempre.
            if (/already exists/i.test(msg)) {
                return cloudinaryUrlFor(publicId, cloudName);
            }
            throw new Error(msg);
        }
        return data.secure_url;
    } finally {
        clearTimeout(timer);
    }
}

// ── Reintentos en segundo plano ─────────────────────────────────────────────

let retrying = false;
const uploading = new Set();   // publicIds que ya van subiendo ahorita

/** Sube una foto de la cola y la saca de ahi. No la sube dos veces a la vez. */
async function uploadItem(item) {
    if (uploading.has(item.publicId)) return null;
    uploading.add(item.publicId);
    try {
        const url = await uploadToCloudinary(item.blob, item.publicId);
        await queueRemove(item.publicId).catch(() => {});
        return url;
    } finally {
        uploading.delete(item.publicId);
    }
}

async function processQueue() {
    if (retrying || !isConfigured() || !navigator.onLine) return;
    retrying = true;
    try {
        const items = await queueAll();
        for (const item of items) {
            if (uploading.has(item.publicId)) continue;
            try {
                await uploadItem(item);
                console.log(`[Cola] Subida: ${item.publicId}`);
            } catch (err) {
                console.log(`[Cola] Sigue fallando (${item.publicId}): ${err.message}`);
                break; // probablemente no hay red — no insistas con el resto
            }
        }
    } catch (err) {
        console.error("[Cola] Error:", err);
    } finally {
        retrying = false;
        checkHealth();
    }
}

// ── Flujo principal ─────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Arranca (o reinicia) una barra de progreso Win95 que dura `ms`. */
function runBar(el, name, ms) {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = `${name} ${ms}ms linear forwards`;
}

// El boton se queda en su lugar (es parte de la ventana) y solo se apaga
// mientras se toma la foto.
function setBusy(v) {
    busy = v;
    captureBtn.disabled = v;
    updateEditorButton();
    scheduleHand();
}

/** El boton de "Escena" solo estorba durante la foto: se esconde solo. */
function updateEditorButton() {
    const hidden = busy
        || BoothLayers.isEditing()
        || lockOverlay.classList.contains("show");
    editorOpenBtn.classList.toggle("hidden", hidden);
}

function resetBooth() {
    clearTimeout(overlayTimer);
    hide(qrOverlay);
    hide(uploadingOverlay);
    captureBtn.textContent = CFG.buttonText;
    setBusy(false);
}

function startCountdown() {
    if (busy) return;
    setBusy(true);
    counting = true;
    captureBtn.textContent = "¡Sonríe! 📸";

    let count = Math.max(1, CFG.countdownSeconds | 0);
    countdownOverlay.style.display = "flex";

    (function tick() {
        if (!busy) return;
        if (count > 0) {
            countdownNumber.style.animation = "none";
            countdownNumber.textContent = String(count);
            void countdownNumber.offsetWidth;
            countdownNumber.style.animation = "countPop 0.9s ease-out forwards";
            count--;
            countdownTimer = setTimeout(tick, 1000);
        } else {
            counting = false;
            countdownOverlay.style.display = "none";
            flashEl.style.animation = "none";
            void flashEl.offsetWidth;
            flashEl.style.animation = "flashAnim 0.4s ease-out forwards";
            takePhoto();
        }
    })();
}

function cancelCountdown() {
    clearTimeout(countdownTimer);
    counting = false;
    countdownOverlay.style.display = "none";
}

async function takePhoto() {
    const cv = drawFrame();
    if (!cv) {
        console.error("[Captura] La camara no esta lista.");
        resetBooth();
        initCamera();
        return;
    }

    const blob = await canvasToJpeg(cv);
    const publicId = `capture_${Date.now()}`;

    if (!isConfigured()) {
        // Sin Cloudinary no hay a donde subir: al menos que se lleven la foto
        // tomandole una foto a la pantalla.
        showResult(blob, { message: "Falta configurar Cloudinary. Tómale una foto a la pantalla para llevarte tu foto." });
        return;
    }

    // Primero a la cola (se queda en el navegador) y DESPUES a subir: si se
    // va el internet o la luz a medio camino, la foto sigue ahi y se sube sola.
    const item = { publicId, blob, createdAt: Date.now() };
    let saved = true;
    try {
        await queueAdd(item);
    } catch (err) {
        saved = false;
        console.error("[Cola] No se pudo guardar:", err);
    }

    // Con la foto a salvo en la cola, el QR puede apuntar a donde va a quedar
    // y no hace falta esperar a que termine de subir.
    const canPredict = saved && Boolean(CFG.cloudName);
    const waitMs = canPredict ? QUICK_UPLOAD_MS : UPLOAD_TIMEOUT_MS;

    show(uploadingOverlay);
    runBar(uploadBar, "fillUp", waitMs);

    const upload = uploadItem(item).catch((err) => {
        console.error("[Subida] Fallo:", err.message);
        return null;
    });
    const url = canPredict
        ? await Promise.race([upload, sleep(waitMs).then(() => null)])
        : await upload;

    hide(uploadingOverlay);

    if (url) {
        showResult(blob, { url, ready: true });
    } else if (canPredict) {
        showResult(blob, { url: cloudinaryUrlFor(publicId), ready: false });
    } else if (saved) {
        showResult(blob, { message: "No hay internet ahora mismo. Tu foto se guardó y se subirá sola. Mientras tanto, tómale una foto a la pantalla." });
    } else {
        showResult(blob, { message: "No se pudo subir la foto. Tómale una foto a la pantalla para no perderla." });
    }
    checkHealth();
}

let resultUrl = null;

/**
 * Pantalla final: la foto que se acaba de tomar y, a un lado, su QR. Si no
 * hay QR que dar, en su lugar va un aviso para que le tomen foto a la
 * pantalla. La barra de abajo marca cuanto falta para volver al inicio.
 */
async function showResult(blob, { url = "", ready = false, message = "" } = {}) {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    resultPhoto.src = resultUrl;

    let hasQr = false;
    if (url) {
        try {
            qrImage.src = await QRCode.toDataURL(url, {
                width: 480, margin: 2,
                color: { dark: "#000000", light: "#ffffff" },
            });
            hasQr = true;
        } catch (err) {
            console.error("[QR] Error generando el codigo:", err);
        }
    }

    qrImage.hidden = !hasQr;
    if (hasQr) {
        resultTitle.textContent = "Descargar.exe";
        qrMessageEl.textContent = CFG.qrMessage;
        qrHintEl.textContent = ready
            ? "📸 Te recomendamos tomarle una foto a tu código QR por si acaso."
            : "Tu foto se está terminando de subir. Si al abrir el link todavía no aparece, inténtalo de nuevo en unos minutos.";
    } else {
        resultTitle.textContent = "Aviso";
        qrMessageEl.textContent = message || "No se pudo generar el código QR. Tómale una foto a la pantalla.";
        qrHintEl.textContent = "";
    }

    const ms = hasQr ? CFG.qrSeconds * 1000 : FALLBACK_DISPLAY_MS;
    show(qrOverlay);
    runBar(resultBar, "drain", ms);

    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(resetBooth, ms);
}

// ── Cambio de escena (5 Enter rapidos) ──────────────────────────────────────

function switchScene() {
    cancelCountdown();
    setBusy(true);

    sceneIndex = (sceneIndex + 1) % SCENES.length;
    applyScene();

    sceneNameEl.textContent = SCENES[sceneIndex].name;
    show(sceneOverlay);

    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
        hide(sceneOverlay);
        resetBooth();
    }, SCENE_DISPLAY_MS);
}

// ── Diagnostico ─────────────────────────────────────────────────────────────

async function buildProblems() {
    const problems = [];

    if (!window.isSecureContext) {
        problems.push({
            level: "error",
            title: "La página no es segura (HTTPS)",
            detail: "El navegador solo deja usar la cámara en páginas https:// o en localhost.",
            fix: "Abre el booth con la dirección https:// de GitHub Pages, no por http:// ni abriendo el archivo directamente.",
        });
    }

    if (!isConfigured()) {
        problems.push({
            level: "error",
            title: "Cloudinary no está configurado",
            detail: "booth-config.js no tiene ni signUrl ni cloudName + uploadPreset.",
            fix: "Abre booth-config.js y llena UNA de las dos opciones: signUrl (modo seguro, ver worker/README.md) o cloudName + uploadPreset. Sin esto las fotos no se suben y no hay código QR.",
        });
    }

    if (cameraError === "denied") {
        problems.push({
            level: "error",
            title: "La cámara está bloqueada",
            detail: "El navegador no dio permiso para usar la cámara.",
            fix: "Haz clic en el candado 🔒 junto a la dirección, permite la Cámara y recarga la página.",
        });
    } else if (cameraError === "notfound") {
        problems.push({
            level: "error",
            title: "No se encontró ninguna cámara",
            detail: "El navegador no ve ninguna cámara conectada.",
            fix: "Conecta una cámara o webcam y recarga la página.",
        });
    } else if (cameraError === "unknown") {
        problems.push({
            level: "error",
            title: "No se pudo abrir la cámara",
            detail: "Puede que otro programa la esté usando.",
            fix: "Cierra Zoom, Teams, OBS o cualquier otro programa que use la cámara y recarga la página.",
        });
    }

    if (!navigator.onLine) {
        problems.push({
            level: "warning",
            title: "Sin conexión a internet",
            detail: "Las fotos se están guardando en este navegador.",
            fix: "En cuanto vuelva el internet se suben solas. No cierres esta pestaña.",
        });
    }

    const pending = await queueCount();
    if (pending > 0 && navigator.onLine) {
        problems.push({
            level: "warning",
            title: `${pending} foto${pending > 1 ? "s" : ""} sin subir`,
            detail: "Están guardadas en este navegador y se reintentan cada 15 segundos.",
            fix: "No cierres esta pestaña hasta que el número llegue a cero.",
        });
    }

    return { problems, pending };
}

async function checkHealth() {
    const { problems, pending } = await buildProblems();
    const errors = problems.filter(p => p.level === "error");

    if (problems.length === 0) {
        healthBadge.classList.remove("show");
    } else {
        healthBadge.classList.add("show");
        healthBadge.classList.toggle("warning", errors.length === 0);
        healthBadgeText.textContent = errors.length
            ? `${errors.length} problema${errors.length > 1 ? "s" : ""} — pulsa F1`
            : `${problems.length} aviso${problems.length > 1 ? "s" : ""} — pulsa F1`;
    }

    let html = problems.length === 0
        ? '<div class="health-ok"><b>Todo funcionando correctamente.</b></div>'
        : problems.map(p => `<div class="health-item ${p.level}">`
            + `<div class="h-title">${escapeHtml(p.title)}</div>`
            + `<div class="h-detail">${escapeHtml(p.detail)}</div>`
            + `<div class="h-fix"><b>Solución:</b> ${escapeHtml(p.fix)}</div></div>`).join("");

    html += '<div class="health-facts">'
        + `<div><b>Cámara:</b> ${cameraError ? "con problema" : "funcionando"}</div>`
        + `<div><b>Cloudinary:</b> ${!isConfigured() ? "NO configurado"
            : usingSignedMode() ? "modo firmado (seguro)"
            : escapeHtml(CFG.cloudName) + " (preset visible)"}</div>`
        + `<div><b>Internet:</b> ${navigator.onLine ? "conectado" : "SIN conexión"}</div>`
        + `<div><b>Fotos sin subir:</b> ${pending}</div>`
        + `<div><b>Escena actual:</b> ${escapeHtml(SCENES[sceneIndex].name)}</div>`
        + "</div>";

    healthBody.innerHTML = html;

    if (errors.length && !healthAutoShown) {
        healthAutoShown = true;
        show(healthPanel);
    }
}

// ── Entrada del usuario ─────────────────────────────────────────────────────

captureBtn.addEventListener("click", () => {
    if (healthPanel.classList.contains("show")) return;
    if (lockOverlay.classList.contains("show")) return;
    if (BoothLayers.isEditing()) return;
    startCountdown();
});

healthCloseBtn.addEventListener("click", () => hide(healthPanel));
healthBadge.addEventListener("click", () => { checkHealth(); show(healthPanel); });

document.addEventListener("keydown", (e) => {
    // Dejar el boton apretado repite la tecla solo. Eso no cuenta como otra
    // pulsacion: si contara, cinco repeticiones cambiaban la escena y
    // cancelaban la foto.
    if (e.repeat && ["Enter", "F1", "F2"].includes(e.key)) {
        e.preventDefault();
        return;
    }
    if (e.key === "F1") {
        e.preventDefault();
        if (healthPanel.classList.contains("show")) hide(healthPanel);
        else { checkHealth(); show(healthPanel); }
        return;
    }
    if (e.key === "F2") {
        e.preventDefault();
        if (!lockOverlay.classList.contains("show")) toggleEditor();
        return;
    }
    if (e.key === "Escape") {
        hide(healthPanel);
        if (BoothLayers.isEditing()) toggleEditor(false);
        return;
    }
    if (healthPanel.classList.contains("show")) return;
    if (lockOverlay.classList.contains("show")) return;
    if (BoothLayers.isEditing()) return;

    if (e.key !== "Enter") return;
    e.preventDefault();

    // Mientras se guarda la foto o esta el QR en pantalla, el boton no hace
    // nada: si alguien lo sigue apretando no le quita el QR a quien lo esta
    // escaneando. Durante la cuenta regresiva si cuenta (para el combo).
    if (busy && !counting) return;

    // 5 Enter rapidos = cambiar de escena
    enterCount++;
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => { enterCount = 0; }, ENTER_COMBO_WINDOW);

    if (enterCount >= ENTER_COMBO_COUNT) {
        enterCount = 0;
        clearTimeout(enterTimer);
        switchScene();
        return;
    }

    startCountdown();
});

// A proposito NO se dispara la foto al tocar el escenario: durante el evento
// la gente se acerca a acomodarse y lo tocaba sin querer. La foto se toma
// solo con el boton o con Enter.

window.addEventListener("online", () => { checkHealth(); processQueue(); });
window.addEventListener("offline", checkHealth);

// ── Candado (PIN) ───────────────────────────────────────────────────────────

function unlockBooth(pin) {
    sessionPin = pin;
    // Se recuerda en ESTE aparato, aunque se cierre el navegador: el booth
    // vuelve a arrancar solo sin pedir teclado. Si cambias el PIN en
    // booth-config.js, el viejo deja de servir y lo vuelve a pedir.
    try { localStorage.setItem("gdn_booth_pin", pin); } catch { /* modo privado */ }
    hide(lockOverlay);
    lockError.textContent = "";
    updateEditorButton();
    initCamera();
    checkHealth();
}

function attemptUnlock() {
    const value = lockInput.value.trim();
    // Sin distinguir mayusculas: el teclado en pantalla solo escribe en
    // mayusculas. Al worker se le manda el PIN tal como esta en la config.
    if (value && value.toUpperCase() === String(CFG.pin).toUpperCase()) {
        unlockBooth(CFG.pin);
    } else {
        lockError.textContent = "PIN incorrecto.";
        lockInput.value = "";
        lockInput.focus();
    }
}

lockSubmitBtn.addEventListener("click", attemptUnlock);
lockInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); attemptUnlock(); }
});

// Teclado en pantalla del candado. Va dentro de la pagina porque el teclado
// del sistema (en el Switch, Onboard) queda escondido detras del navegador
// a pantalla completa. Con teclado fisico se puede escribir igual.
const PIN_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM⌫"];

(function buildPinPad() {
    const pad = $("pin-pad");
    for (const row of PIN_ROWS) {
        const rowEl = document.createElement("div");
        rowEl.className = "pin-row";
        for (const key of row) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "win95-btn pin-key" + (key === "⌫" ? " pin-back" : "");
            b.textContent = key;
            b.setAttribute("aria-label", key === "⌫" ? "Borrar" : key);
            rowEl.appendChild(b);
        }
        pad.appendChild(rowEl);
    }
    // pointerdown + preventDefault: la tecla responde al instante y el
    // cuadro del PIN no pierde el foco (asi Enter fisico sigue funcionando).
    pad.addEventListener("pointerdown", (e) => {
        const b = e.target.closest(".pin-key");
        if (!b) return;
        e.preventDefault();
        lockError.textContent = "";
        if (b.classList.contains("pin-back")) {
            lockInput.value = lockInput.value.slice(0, -1);
        } else {
            lockInput.value += b.textContent;
        }
    });
})();

// ── Editor de escena (F2) ───────────────────────────────────────────────────

function toggleEditor(force) {
    const open = force === undefined ? !BoothLayers.isEditing() : force;
    if (open) {
        cancelCountdown();
        resetBooth();
        hide(healthPanel);   // si no, el editor queda debajo del panel de F1
    }
    BoothLayers.setEditing(open);
    buttonContainer.style.visibility = open ? "hidden" : "visible";
    updateEditorButton();
}

editorOpenBtn.addEventListener("click", () => toggleEditor(true));

$("ed-close").addEventListener("click", () => toggleEditor(false));
$("ed-add").addEventListener("click", () => $("ed-file").click());

$("ed-file").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
        await BoothLayers.addImage(f, f.name.replace(/\.[^.]+$/, ""));
    }
    e.target.value = "";   // permite volver a cargar el mismo archivo
});

$("ed-fit").addEventListener("click", () => BoothLayers.fitSelected("fit"));
$("ed-fill").addEventListener("click", () => BoothLayers.fitSelected("fill"));
$("ed-center").addEventListener("click", () => BoothLayers.fitSelected("center"));

$("ed-export").addEventListener("click", () => BoothLayers.exportLayout());
$("ed-import").addEventListener("click", () => $("ed-import-file").click());
$("ed-import-file").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) await BoothLayers.importLayout(f);
    e.target.value = "";
});

$("ed-reset").addEventListener("click", () => {
    if (confirm("¿Borrar todas las imágenes y dejar solo la cámara?")) {
        BoothLayers.reset();
    }
});

// ── Modo kiosco ─────────────────────────────────────────────────────────────
// Sin boton de editor a la vista y el cursor se esconde solo cuando no se
// mueve el mouse. Con el editor abierto el cursor no se esconde.

function setupKiosk() {
    document.body.classList.add("kiosk");
    let idleTimer = null;
    const wake = () => {
        document.body.classList.remove("cursor-hidden");
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (!BoothLayers.isEditing()) document.body.classList.add("cursor-hidden");
        }, CURSOR_IDLE_MS);
    };
    document.addEventListener("pointermove", wake);
    document.addEventListener("pointerdown", wake);
    wake();
}

// ── Manita (?hand) ──────────────────────────────────────────────────────────
// Si nadie usa el booth un rato, aparece una mano señalando una esquina (la
// del boton). Solo con ?hand en la direccion: el Switch la pide, la pagina
// publica no. ?hand=top-left elige otra esquina sin tocar la config.

const handParam = new URLSearchParams(location.search).get("hand");
const HAND_ON = handParam !== null;
const handEl = $("idle-hand");
let handTimer = null;

// La imagen apunta a la derecha; asi se voltea hacia cada esquina.
const HAND_TURNS = {
    "bottom-right": { turn: "rotate(40deg)",             poke: [1, 1] },
    "top-right":    { turn: "rotate(-40deg)",            poke: [1, -1] },
    "bottom-left":  { turn: "scaleX(-1) rotate(40deg)",  poke: [-1, 1] },
    "top-left":     { turn: "scaleX(-1) rotate(-40deg)", poke: [-1, -1] },
};

function setupHand() {
    const corner = HAND_TURNS[handParam] ? handParam
                 : HAND_TURNS[CFG.handCorner] ? CFG.handCorner
                 : "bottom-right";
    const { turn, poke } = HAND_TURNS[corner];
    handEl.dataset.corner = corner;
    handEl.style.setProperty("--hand-turn", turn);
    handEl.style.setProperty("--poke-x", poke[0]);
    handEl.style.setProperty("--poke-y", poke[1]);
    handEl.querySelector("img").src = CFG.handImage || "assets/hand.png";
    document.addEventListener("keydown", scheduleHand);
    document.addEventListener("pointerdown", scheduleHand);
    scheduleHand();
}

/** Esconde la mano y la vuelve a programar: sale si el booth sigue quieto. */
function scheduleHand() {
    if (!HAND_ON) return;
    handEl.classList.remove("show");
    clearTimeout(handTimer);
    handTimer = setTimeout(() => {
        const idle = !busy
            && !BoothLayers.isEditing()
            && !lockOverlay.classList.contains("show")
            && !healthPanel.classList.contains("show");
        if (idle) handEl.classList.add("show");
        else scheduleHand();
    }, Math.max(3, Number(CFG.handAfterSeconds) || 20) * 1000);
}

// ── Arranque ────────────────────────────────────────────────────────────────

if (CFG.showPhotoFrame === false) $("photo-frame").classList.add("hidden");
captureBtn.textContent = CFG.buttonText;
if (KIOSK) setupKiosk();
if (HAND_ON) setupHand();

(async function boot() {
    await BoothLayers.init({
        frameEl,
        hostEl:   $("layer-host"),
        videoEl:  video,
        selectEl: $("ed-select"),
        guidesEl: $("ed-guides"),
        snapEl:   $("ed-snaplines"),
        distEl:   $("ed-dist"),
        safeMargin: CFG.safeMargin,
        backgrounds: CFG.backgrounds,
        background: CFG.background,
        format: CFG.format,
        formatsEl: $("ed-formats"),
        bgsEl:     $("ed-backgrounds"),
        panelEl:  $("editor-panel"),
        listEl:   $("ed-list"),
        propsEl:  $("ed-props"),
        onChange: checkHealth,
    });

    // Fondo elegido desde la direccion (?bg=gdn-blanco): asi lo abre el
    // Switch sin tocar el editor. Un id que no exista se ignora.
    const bgParam = new URLSearchParams(location.search).get("bg");
    if (bgParam) BoothLayers.setBackground(bgParam);

    // Marco de assets/layouts/, elegido con ?layout=nombre (asi lo abre el
    // Switch) o con layout en booth-config.js. Solo nombres simples.
    const layoutName = new URLSearchParams(location.search).get("layout") || CFG.layout;
    if (layoutName && /^[a-z0-9-]+$/i.test(layoutName)) {
        await BoothLayers.useLayout(`${BoothLayers.layoutDir}${layoutName}.png`);
    }

    applyScene();

    if (!CFG.pin) {
        // Sin PIN configurado: arranca directo, como antes.
        initCamera();
        checkHealth();
    } else {
        let remembered = "";
        try { remembered = localStorage.getItem("gdn_booth_pin") || ""; } catch { /* modo privado */ }

        if (remembered === CFG.pin) {
            unlockBooth(remembered);
        } else {
            show(lockOverlay);
            lockInput.focus();
            updateEditorButton();
        }
    }
})();

setInterval(processQueue, RETRY_INTERVAL);
setTimeout(processQueue, 3000);
setInterval(checkHealth, 20000);

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(err =>
            console.log("[SW] No se registró:", err.message));
    });
}
