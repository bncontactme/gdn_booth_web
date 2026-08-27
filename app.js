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
    qrMessage: "¡Escanea para descargar tu foto!",
}, window.BOOTH_CONFIG || {});

const SCENES = (window.BOOTH_SCENES && window.BOOTH_SCENES.length)
    ? window.BOOTH_SCENES
    : [{ id: "default", name: "Normal", filter: "none", vignette: 0, grain: 0 }];

const RETRY_INTERVAL = 15000;
const ENTER_COMBO_WINDOW = 2000;
const ENTER_COMBO_COUNT = 5;
const SCENE_DISPLAY_MS = 1800;
const UPLOAD_TIMEOUT_MS = 20000;
const FALLBACK_DISPLAY_MS = 20000;

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
const qrOverlay = $("qr-overlay");
const qrImage = $("qr-image");
const qrMessageEl = $("qr-message");
const qrHintEl = $("qr-hint");
const fallbackOverlay = $("fallback-overlay");
const fallbackPhoto = $("fallback-photo");
const fallbackMessage = $("fallback-message");
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
                const folderPart = CFG.folder ? `${CFG.folder}/` : "";
                return `https://res.cloudinary.com/${cloudName}/image/upload/${folderPart}${publicId}.jpg`;
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

async function processQueue() {
    if (retrying || !isConfigured() || !navigator.onLine) return;
    retrying = true;
    try {
        const items = await queueAll();
        for (const item of items) {
            try {
                await uploadToCloudinary(item.blob, item.publicId);
                await queueRemove(item.publicId);
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

function setBusy(v) {
    busy = v;
    captureBtn.disabled = v;
    buttonContainer.style.visibility = v ? "hidden" : "visible";
    updateEditorButton();
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
    hide(fallbackOverlay);
    hide(uploadingOverlay);
    captureBtn.textContent = "Presiona Enter Para Tomar Foto";
    setBusy(false);
}

function startCountdown() {
    if (busy) return;
    setBusy(true);

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
        showFallback(blob, "Falta configurar Cloudinary. Tómale una foto a la pantalla para llevarte tu foto.");
        return;
    }

    show(uploadingOverlay);

    try {
        const url = await uploadToCloudinary(blob, publicId);
        hide(uploadingOverlay);
        showQR(url);
    } catch (err) {
        console.error("[Subida] Fallo:", err.message);
        hide(uploadingOverlay);
        try {
            await queueAdd({ publicId, blob, createdAt: Date.now() });
            showFallback(blob, "No hay internet ahora mismo. Tu foto se guardó y se subirá sola. Mientras tanto, tómale una foto a la pantalla.");
        } catch (dbErr) {
            console.error("[Cola] No se pudo guardar:", dbErr);
            showFallback(blob, "No se pudo subir la foto. Tómale una foto a la pantalla para no perderla.");
        }
        checkHealth();
    }
}

async function showQR(url) {
    try {
        const dataUrl = await QRCode.toDataURL(url, {
            width: 420, margin: 2,
            color: { dark: "#000000", light: "#ffffff" },
        });
        qrImage.src = dataUrl;
    } catch (err) {
        console.error("[QR] Error generando el codigo:", err);
    }

    qrMessageEl.textContent = CFG.qrMessage;
    qrHintEl.textContent = "📸 Te recomendamos tomarle una foto a tu código QR por si acaso.";
    show(qrOverlay);

    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(resetBooth, CFG.qrSeconds * 1000);
}

let fallbackUrl = null;

function showFallback(blob, message) {
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    fallbackUrl = URL.createObjectURL(blob);
    fallbackPhoto.src = fallbackUrl;
    fallbackMessage.textContent = message;
    show(fallbackOverlay);

    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(resetBooth, FALLBACK_DISPLAY_MS);
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
    try { sessionStorage.setItem("gdn_booth_pin", pin); } catch { /* modo privado */ }
    hide(lockOverlay);
    lockError.textContent = "";
    updateEditorButton();
    initCamera();
    checkHealth();
}

function attemptUnlock() {
    const value = lockInput.value.trim();
    if (value && value === CFG.pin) {
        unlockBooth(value);
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

// ── Arranque ────────────────────────────────────────────────────────────────

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

    applyScene();

    if (!CFG.pin) {
        // Sin PIN configurado: arranca directo, como antes.
        initCamera();
        checkHealth();
    } else {
        let remembered = "";
        try { remembered = sessionStorage.getItem("gdn_booth_pin") || ""; } catch { /* modo privado */ }

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
