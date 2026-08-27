// ============================================================================
//  layers.js — Capas tipo OBS, pero dentro de la pagina
//  ---------------------------------------------------------------------
//  Cada cosa que se ve en el booth es una CAPA, igual que las "fuentes" de
//  OBS: la camara es una capa, cada marco o logo que cargues es otra capa.
//  Se pueden mover, cambiar de tamano, girar, ordenar y esconder.
//
//  Las posiciones se guardan en 0..1 (proporcion del escenario 9:16), no en
//  pixeles. Por eso la foto final sale EXACTAMENTE igual que la vista previa,
//  aunque la pantalla y la foto tengan tamanos distintos.
//
//  Todo se guarda solo en el navegador (IndexedDB), asi que el montaje sigue
//  ahi al día siguiente. Con "Exportar" se lleva a otra computadora.
// ============================================================================

window.BoothLayers = (function () {

    // ── Estado ──────────────────────────────────────────────────────────────

    const CAMERA_ID = "camera";

    // Formatos de la foto. "ar" es ancho/alto: con eso se arma todo, tanto el
    // escenario en pantalla como el canvas de la foto.
    const FORMATS = [
        { id: "story",    name: "Story",    label: "9:16", w: 9,  h: 16 },
        { id: "completo", name: "Completo", label: "16:9", w: 16, h: 9  },
        { id: "perfil",   name: "Perfil",   label: "1:1",  w: 1,  h: 1  },
    ];
    const DEFAULT_BACKGROUNDS = [
        { id: "gdn",    name: "GDN",    color: "#000000", bars: "assets/logo.jpg" },
        { id: "blanco", name: "Blanco", color: "#ffffff" },
        { id: "negro",  name: "Negro",  color: "#000000" },
    ];

    let BACKGROUNDS = DEFAULT_BACKGROUNDS;
    let formatId = "story";
    let backgroundId = "gdn";
    let bgImage = null;          // <img> precargada para pintar el fondo

    const fmt = () => FORMATS.find(f => f.id === formatId) || FORMATS[0];
    const aspect = () => fmt().w / fmt().h;
    const bg = () => BACKGROUNDS.find(b => b.id === backgroundId) || BACKGROUNDS[0];
    const SNAP_PX = 9;            // que tan cerca hay que estar para que pegue
    const MIN_SIZE = 0.02;
    // Margen seguro. Se guarda en dos valores porque el escenario es 9:16:
    // el mismo grosor en pixeles es 6% del ancho pero solo 3.375% del alto.
    let SAFE_X = 0.06;            // se puede cambiar en booth-config.js
    let SAFE_Y = 0.06 * 9 / 16;   // se recalcula con el formato

    let layers = [];              // [0] = hasta atras, [n-1] = hasta el frente
    let selectedId = null;
    let editing = false;
    let frameEl = null;
    let hostEl = null;
    let videoEl = null;
    let selectEl = null;
    let guidesEl = null;
    let snapEl = null;
    let distEl = null;
    let onChange = () => {};

    const nodes = Object.create(null);   // id -> { box, media }
    const urls  = Object.create(null);   // id -> objectURL (para revocar)

    // ── Guardado (IndexedDB propia, para no tocar la cola de subidas) ───────

    const DB_NAME = "gdn_booth_layout";
    const STORE = "layout";
    const KEY = "current";
    let dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    function dbRun(mode, fn) {
        return openDb().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const r = fn(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(r && r.result !== undefined ? r.result : r);
            tx.onerror = () => reject(tx.error);
        }));
    }

    let saveTimer = null;

    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            // Se guarda solo lo que se puede reconstruir: los blobs viajan tal
            // cual (IndexedDB los aguanta), los elementos del DOM no.
            const plain = layers.map(l => ({
                id: l.id, type: l.type, name: l.name,
                x: l.x, y: l.y, w: l.w, h: l.h,
                rot: l.rot, opacity: l.opacity, visible: l.visible,
                blob: l.blob || null, url: l.url || null,
            }));
            dbRun("readwrite", s => s.put(
                { version: 2, layers: plain, format: formatId, background: backgroundId }, KEY))
                .catch(err => console.warn("[Capas] No se pudo guardar:", err));
        }, 300);
    }

    async function load() {
        try {
            const data = await dbRun("readonly", s => s.get(KEY));
            if (data && Array.isArray(data.layers) && data.layers.length) return data;
        } catch (err) {
            console.warn("[Capas] No se pudo leer lo guardado:", err);
        }
        return null;
    }

    // ── Modelo ──────────────────────────────────────────────────────────────

    const uid = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    function defaultCamera() {
        return {
            id: CAMERA_ID, type: "camera", name: "Cámara",
            x: 0, y: 0, w: 1, h: 1, rot: 0, opacity: 1, visible: true,
        };
    }

    function ensureCamera() {
        if (!layers.some(l => l.id === CAMERA_ID)) layers.unshift(defaultCamera());
    }

    const cameraLayer = () => layers.find(l => l.id === CAMERA_ID) || defaultCamera();
    const byId = (id) => layers.find(l => l.id === id) || null;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // ── Vista previa (DOM dentro de #frame) ─────────────────────────────────

    function mediaFor(l) {
        if (l.type === "camera") return videoEl;
        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        return img;
    }

    function srcFor(l) {
        if (l.url) return l.url;
        if (l.blob) {
            if (!urls[l.id]) urls[l.id] = URL.createObjectURL(l.blob);
            return urls[l.id];
        }
        return "";
    }

    /** Crea/actualiza un div por capa y lo coloca en su lugar. */
    function syncPreview() {
        // Fuera los nodos de capas que ya no existen.
        for (const id of Object.keys(nodes)) {
            if (!byId(id)) {
                const n = nodes[id];
                if (n.box.parentNode) n.box.parentNode.removeChild(n.box);
                if (urls[id]) { URL.revokeObjectURL(urls[id]); delete urls[id]; }
                delete nodes[id];
            }
        }

        layers.forEach((l, i) => {
            let n = nodes[l.id];
            if (!n) {
                const box = document.createElement("div");
                box.className = "layer-box";
                box.dataset.id = l.id;
                const media = mediaFor(l);
                box.appendChild(media);
                hostEl.appendChild(box);
                n = nodes[l.id] = { box, media };
                if (l.type === "image") n.media.src = srcFor(l);
            }

            const s = n.box.style;
            s.left    = (l.x * 100) + "%";
            s.top     = (l.y * 100) + "%";
            s.width   = (l.w * 100) + "%";
            s.height  = (l.h * 100) + "%";
            s.opacity = String(l.opacity);
            s.zIndex  = String(i + 1);
            s.display = l.visible ? "block" : "none";
            s.transform = `rotate(${l.rot || 0}deg)` +
                (l.type === "camera" && mirrorOn ? " scaleX(-1)" : "");
            n.box.classList.toggle("selected", editing && l.id === selectedId);
            n.box.classList.toggle("editing", editing);
        });

        drawSelection();
        showDistances(editing ? byId(selectedId) : null);
    }

    /**
     * Empuja el formato y el fondo al CSS. El escenario, las barras de los
     * lados y el margen seguro salen todos de la misma proporcion, asi que
     * cambiar de formato acomoda la pantalla completa de un golpe.
     */
    function applyStage() {
        const ar = aspect();
        document.documentElement.style.setProperty("--ar", String(ar));

        // Mismo grosor de margen por los cuatro lados, sea cual sea el formato.
        SAFE_Y = SAFE_X * ar;
        frameEl.style.setProperty("--safe-x", (SAFE_X * 100) + "%");
        frameEl.style.setProperty("--safe-y", (SAFE_Y * 100) + "%");

        const b = bg() || {};
        const bars = document.querySelectorAll(".side-bar");
        const barImgs = document.querySelectorAll(".side-bar img");
        const stage = document.getElementById("stage");
        const color = b.color || "#000000";

        // ── Fondo DE LA FOTO ───────────────────────────────────────────────
        // Solo "image" llena la foto. "bars" no: esa vive fuera del encuadre.
        if (b.image) {
            frameEl.style.background = `${color} url("${b.image}") center/cover no-repeat`;
            if (!bgImage || bgImage.dataset.src !== b.image) {
                bgImage = new Image();
                bgImage.dataset.src = b.image;
                bgImage.src = b.image;
            }
        } else {
            frameEl.style.background = color;
            bgImage = null;
        }

        // ── Barras de los lados (fuera de la foto) ─────────────────────────
        if (b.bars) {
            bars.forEach(el => { el.style.background = "#000"; });
            barImgs.forEach(im => { im.style.display = ""; im.src = b.bars; });
        } else {
            bars.forEach(el => { el.style.background = color; });
            barImgs.forEach(im => { im.style.display = "none"; });
        }

        // Lo que sobra arriba/abajo del encuadre acompaña a las barras.
        if (stage) stage.style.background = b.bars ? "#000" : color;
    }

    function setFormat(id) {
        if (!FORMATS.some(f => f.id === id)) return;
        formatId = id;
        applyStage();
        syncPreview();
        renderPanel();
        save();
        onChange();
    }

    function setBackground(id) {
        if (!BACKGROUNDS.some(b => b.id === id)) return;
        backgroundId = id;
        applyStage();
        renderPanel();
        save();
        onChange();
    }

    /** Pinta el fondo en el canvas, igual que se ve en pantalla. */
    function drawBackground(ctx, W, H) {
        const b = bg();
        if (b && b.image) {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, W, H);
            if (bgImage && bgImage.complete && bgImage.naturalWidth) {
                const c = coverCrop(bgImage.naturalWidth, bgImage.naturalHeight, W, H);
                ctx.drawImage(bgImage, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
            }
        } else {
            ctx.fillStyle = (b && b.color) || "#000000";
            ctx.fillRect(0, 0, W, H);
        }
    }

    // ── Dibujo en el canvas (la foto final) ─────────────────────────────────

    /**
     * Recorta como "object-fit: cover": llena la caja sin deformar a nadie.
     * Devuelve el recorte del origen que hay que dibujar.
     */
    function coverCrop(srcW, srcH, boxW, boxH) {
        const want = boxW / boxH;
        const have = srcW / srcH;
        let sw, sh, sx, sy;
        if (have > want) {
            sh = srcH; sw = srcH * want; sx = (srcW - sw) / 2; sy = 0;
        } else {
            sw = srcW; sh = srcW / want; sx = 0; sy = (srcH - sh) / 2;
        }
        return { sx, sy, sw, sh };
    }

    /**
     * Pinta todas las capas visibles sobre el canvas, en el mismo orden y con
     * la misma geometria que la vista previa.
     */
    function drawTo(ctx, W, H, opts) {
        drawBackground(ctx, W, H);
        const filter = (opts && opts.filter) || "none";
        const mirror = !!(opts && opts.mirror);
        const canFilter = "filter" in ctx;

        for (const l of layers) {
            if (!l.visible || l.opacity <= 0) continue;

            const n = nodes[l.id];
            const media = n && n.media;
            if (!media) continue;

            let srcW, srcH;
            if (l.type === "camera") {
                srcW = media.videoWidth; srcH = media.videoHeight;
            } else {
                srcW = media.naturalWidth; srcH = media.naturalHeight;
            }
            if (!srcW || !srcH) continue;

            const bw = l.w * W, bh = l.h * H;
            const cx = (l.x + l.w / 2) * W, cy = (l.y + l.h / 2) * H;

            ctx.save();
            ctx.globalAlpha = l.opacity;
            ctx.translate(cx, cy);
            if (l.rot) ctx.rotate(l.rot * Math.PI / 180);

            if (l.type === "camera") {
                if (mirror) ctx.scale(-1, 1);
                if (canFilter) ctx.filter = filter;
                const c = coverCrop(srcW, srcH, bw, bh);
                ctx.drawImage(media, c.sx, c.sy, c.sw, c.sh, -bw / 2, -bh / 2, bw, bh);
                if (canFilter) ctx.filter = "none";
            } else {
                // Los marcos se estiran a su caja, igual que en la vista previa.
                ctx.drawImage(media, -bw / 2, -bh / 2, bw, bh);
            }

            ctx.restore();
        }
    }

    let mirrorOn = true;

    function setCamera(opts) {
        mirrorOn = opts.mirror !== false;
        if (videoEl) videoEl.style.filter = opts.filter || "none";
        syncPreview();
    }

    // ── Agregar imagenes ────────────────────────────────────────────────────

    function loadImageSize(src) {
        return new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = () => resolve({ w: 0, h: 0 });
            im.src = src;
        });
    }

    /**
     * Mete una imagen como capa nueva, al frente. Entra centrada y con su
     * proporcion respetada: si es del tamano del escenario (9:16) entra como
     * marco de pantalla completa, que es lo normal.
     */
    async function addImage(source, name) {
        const l = {
            id: uid(), type: "image", name: name || "Imagen",
            x: 0, y: 0, w: 1, h: 1, rot: 0, opacity: 1, visible: true,
        };
        if (source instanceof Blob) l.blob = source; else l.url = String(source);

        const size = await loadImageSize(srcFor(l));
        if (size.w && size.h) {
            const stageAspect = aspect();
            const imgAspect = size.w / size.h;
            // Casi del mismo formato que el escenario => marco a pantalla completa.
            if (Math.abs(imgAspect - stageAspect) < 0.04) {
                l.x = 0; l.y = 0; l.w = 1; l.h = 1;
            } else if (imgAspect > stageAspect) {
                l.w = 0.7;
                l.h = (0.7 * stageAspect) / imgAspect;
                l.x = (1 - l.w) / 2; l.y = (1 - l.h) / 2;
            } else {
                l.h = 0.5;
                l.w = (0.5 * imgAspect) / stageAspect;
                l.x = (1 - l.w) / 2; l.y = (1 - l.h) / 2;
            }
        }

        layers.push(l);
        selectedId = l.id;
        syncPreview();
        renderPanel();
        save();
        onChange();
        return l;
    }

    // ── Orden, borrar, encuadres ────────────────────────────────────────────

    function move(id, dir) {
        const i = layers.findIndex(l => l.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= layers.length) return;
        const t = layers[i]; layers[i] = layers[j]; layers[j] = t;
        syncPreview(); renderPanel(); save();
    }

    function remove(id) {
        if (id === CAMERA_ID) return;   // la camara no se borra, se esconde
        layers = layers.filter(l => l.id !== id);
        if (selectedId === id) selectedId = null;
        syncPreview(); renderPanel(); save(); onChange();
    }

    function fitSelected(mode) {
        const l = byId(selectedId);
        if (!l) return;

        if (mode === "center") {
            l.x = (1 - l.w) / 2;
            l.y = (1 - l.h) / 2;
        } else if (mode === "fill") {
            l.x = 0; l.y = 0; l.w = 1; l.h = 1; l.rot = 0;
        } else if (mode === "fit") {
            const n = nodes[l.id], m = n && n.media;
            const sw = l.type === "camera" ? (m && m.videoWidth) : (m && m.naturalWidth);
            const sh = l.type === "camera" ? (m && m.videoHeight) : (m && m.naturalHeight);
            if (sw && sh) {
                const stageAspect = aspect();
                const a = sw / sh;
                if (a > stageAspect) { l.w = 1; l.h = stageAspect / a; }
                else { l.h = 1; l.w = a / stageAspect; }
                l.x = (1 - l.w) / 2; l.y = (1 - l.h) / 2; l.rot = 0;
            }
        }
        syncPreview(); renderPanel(); save();
    }

    async function reset() {
        layers = [defaultCamera()];
        selectedId = null;
        syncPreview(); renderPanel(); save(); onChange();
    }

    // ── Exportar / importar (para pasar el montaje a otra computadora) ──────

    const blobToDataUrl = (b) => new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res("");
        fr.readAsDataURL(b);
    });

    async function dataUrlToBlob(d) {
        const r = await fetch(d);
        return await r.blob();
    }

    async function exportLayout() {
        const out = [];
        for (const l of layers) {
            const item = {
                id: l.id, type: l.type, name: l.name,
                x: l.x, y: l.y, w: l.w, h: l.h,
                rot: l.rot, opacity: l.opacity, visible: l.visible,
            };
            if (l.url) item.url = l.url;
            if (l.blob) item.data = await blobToDataUrl(l.blob);
            out.push(item);
        }
        const json = JSON.stringify({ version: 1, layers: out }, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "booth-escena.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    async function importLayout(file) {
        const text = await file.text();
        let data;
        try { data = JSON.parse(text); } catch { alert("Ese archivo no es una escena válida."); return; }
        if (!data || !Array.isArray(data.layers)) { alert("Ese archivo no es una escena válida."); return; }

        const next = [];
        for (const it of data.layers) {
            const l = {
                id: it.type === "camera" ? CAMERA_ID : uid(),
                type: it.type === "camera" ? "camera" : "image",
                name: it.name || "Imagen",
                x: +it.x || 0, y: +it.y || 0,
                w: +it.w || 1, h: +it.h || 1,
                rot: +it.rot || 0,
                opacity: it.opacity === undefined ? 1 : +it.opacity,
                visible: it.visible !== false,
            };
            if (it.url) l.url = it.url;
            if (it.data) { try { l.blob = await dataUrlToBlob(it.data); } catch { /* se ignora */ } }
            next.push(l);
        }

        layers = next;
        ensureCamera();
        selectedId = null;
        syncPreview(); renderPanel(); save(); onChange();
    }

    // ── Seleccion y manijas ─────────────────────────────────────────────────

    function drawSelection() {
        if (!selectEl) return;
        const l = byId(selectedId);
        if (!editing || !l) { selectEl.hidden = true; return; }
        selectEl.hidden = false;
        const s = selectEl.style;
        s.left   = (l.x * 100) + "%";
        s.top    = (l.y * 100) + "%";
        s.width  = (l.w * 100) + "%";
        s.height = (l.h * 100) + "%";
        s.transform = `rotate(${l.rot || 0}deg)`;
    }

    const rect = () => frameEl.getBoundingClientRect();

    /** Punto del puntero -> 0..1 dentro del escenario. */
    function toStage(e) {
        const R = rect();
        return { x: (e.clientX - R.left) / R.width, y: (e.clientY - R.top) / R.height, R };
    }

    /** ¿El punto cae dentro de la capa? (respeta el giro) */
    function hit(l, p, R) {
        const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
        let dx = (p.x - cx) * R.width, dy = (p.y - cy) * R.height;
        if (l.rot) {
            const a = -l.rot * Math.PI / 180;
            const nx = dx * Math.cos(a) - dy * Math.sin(a);
            const ny = dx * Math.sin(a) + dy * Math.cos(a);
            dx = nx; dy = ny;
        }
        return Math.abs(dx) <= (l.w * R.width) / 2 && Math.abs(dy) <= (l.h * R.height) / 2;
    }

    // ── Alineacion inteligente (tipo Instagram / Figma) ─────────────────────
    //
    // No solo pega a las orillas: tambien al centro, al margen seguro y a las
    // orillas y al centro de las OTRAS capas. Mientras arrastras aparecen
    // lineas magenta mostrando con que se esta alineando.

    /** Lugares a los que vale la pena pegarse, en un eje. */
    function snapTargets(axis, excludeId) {
        const safe = axis === "x" ? SAFE_X : SAFE_Y;
        const t = [0, 0.5, 1, safe, 1 - safe];
        for (const l of layers) {
            if (l.id === excludeId || !l.visible) continue;
            const a = axis === "x" ? l.x : l.y;
            const s = axis === "x" ? l.w : l.h;
            t.push(a, a + s / 2, a + s);
        }
        return t;
    }

    /**
     * Busca el mejor iman para un conjunto de bordes que se mueven juntos.
     * Devuelve cuanto hay que correrse y donde pintar la linea.
     */
    function bestSnap(anchors, targets, tol) {
        let best = null;
        for (const a of anchors) {
            for (const t of targets) {
                const d = t - a;
                if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) {
                    best = { delta: d, at: t };
                }
            }
        }
        return best;
    }

    function showSnapLines(xs, ys) {
        if (!snapEl) return;
        if (!xs.length && !ys.length) { snapEl.hidden = true; snapEl.innerHTML = ""; return; }
        snapEl.hidden = false;
        snapEl.innerHTML =
            xs.map(v => `<div class="ed-snap v" style="left:${v * 100}%"></div>`).join("") +
            ys.map(v => `<div class="ed-snap h" style="top:${v * 100}%"></div>`).join("");
    }

    function clearSnapLines() {
        if (!snapEl) return;
        snapEl.hidden = true;
        snapEl.innerHTML = "";
    }

    // ── Medidas de distancia (como Instagram) ───────────────────────────────
    //
    // Se muestran los cuatro huecos entre la capa y la orilla de la foto, en
    // pixeles de la foto final (1080x1920). Si el numero de la izquierda y el
    // de la derecha son iguales, la capa esta centrada — sin adivinar.

    let PHOTO_W = 1080, PHOTO_H = 1920;
    const setPhotoSize = (w, h) => { PHOTO_W = w; PHOTO_H = h; };

    function showDistances(l) {
        if (!distEl) return;
        if (!l) { distEl.hidden = true; distEl.innerHTML = ""; return; }

        const left   = l.x;
        const right  = 1 - (l.x + l.w);
        const top    = l.y;
        const bottom = 1 - (l.y + l.h);

        // Un hueco negativo significa que la capa se sale de la foto: eso se
        // marca aparte porque es justo lo que hay que evitar.
        const px = (v, total) => Math.round(v * total);
        const midY = (l.y + l.h / 2) * 100;
        const midX = (l.x + l.w / 2) * 100;

        const parts = [];
        if (left > 0.001) parts.push(
            `<div class="ed-d h" style="left:0;width:${left * 100}%;top:${midY}%;transform:translateY(-50%)">
                <span>${px(left, PHOTO_W)}</span></div>`);
        if (right > 0.001) parts.push(
            `<div class="ed-d h" style="right:0;width:${right * 100}%;top:${midY}%;transform:translateY(-50%)">
                <span>${px(right, PHOTO_W)}</span></div>`);
        if (top > 0.001) parts.push(
            `<div class="ed-d v" style="top:0;height:${top * 100}%;left:${midX}%;transform:translateX(-50%)">
                <span>${px(top, PHOTO_H)}</span></div>`);
        if (bottom > 0.001) parts.push(
            `<div class="ed-d v" style="bottom:0;height:${bottom * 100}%;left:${midX}%;transform:translateX(-50%)">
                <span>${px(bottom, PHOTO_H)}</span></div>`);

        distEl.innerHTML = parts.join("");
        distEl.hidden = parts.length === 0;
    }

    let drag = null;

    function onPointerDown(e) {
        if (!editing) return;
        const handle = e.target.closest && e.target.closest(".ed-h");
        const p = toStage(e);

        if (handle && byId(selectedId)) {
            const l = byId(selectedId);
            drag = {
                mode: "resize", dir: handle.dataset.h, id: l.id,
                start: p, orig: { x: l.x, y: l.y, w: l.w, h: l.h },
            };
        } else {
            // De adelante hacia atras, como OBS.
            let found = null;
            for (let i = layers.length - 1; i >= 0; i--) {
                const l = layers[i];
                if (l.visible && hit(l, p, p.R)) { found = l; break; }
            }
            selectedId = found ? found.id : null;
            renderPanel();
            if (found) {
                drag = {
                    mode: "move", id: found.id,
                    start: p, orig: { x: found.x, y: found.y, w: found.w, h: found.h },
                };
            }
        }

        syncPreview();
        if (drag) {
            frameEl.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    }

    function onPointerMove(e) {
        if (!drag) return;
        const l = byId(drag.id);
        if (!l) { drag = null; return; }

        const p = toStage(e);
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;

        const tolX = SNAP_PX / p.R.width;
        const tolY = SNAP_PX / p.R.height;
        const guidesX = [], guidesY = [];

        if (drag.mode === "move") {
            let nx = drag.orig.x + dx;
            let ny = drag.orig.y + dy;

            // Se prueban los tres bordes a la vez (izquierda, centro, derecha)
            // y gana el iman mas cercano.
            const sx = bestSnap([nx, nx + l.w / 2, nx + l.w], snapTargets("x", l.id), tolX);
            const sy = bestSnap([ny, ny + l.h / 2, ny + l.h], snapTargets("y", l.id), tolY);
            if (sx) { nx += sx.delta; guidesX.push(sx.at); }
            if (sy) { ny += sy.delta; guidesY.push(sy.at); }

            l.x = nx; l.y = ny;
        } else {
            const d = drag.dir;
            const o = drag.orig;
            let x = o.x, y = o.y, w = o.w, h = o.h;

            if (d.includes("e")) w = o.w + dx;
            if (d.includes("s")) h = o.h + dy;
            if (d.includes("w")) { w = o.w - dx; x = o.x + dx; }
            if (d.includes("n")) { h = o.h - dy; y = o.y + dy; }

            // Shift conserva la proporcion original.
            if (e.shiftKey && o.w > 0 && o.h > 0 && d.length === 2) {
                const ratio = o.w / o.h;
                if (Math.abs(w - o.w) > Math.abs(h - o.h)) h = w / ratio;
                else w = h * ratio;
                if (d.includes("w")) x = o.x + (o.w - w);
                if (d.includes("n")) y = o.y + (o.h - h);
            }

            // El borde que se esta jalando tambien se pega, salvo cuando
            // Shift manda (ahi la proporcion es lo que importa).
            if (!e.shiftKey) {
                const tx = snapTargets("x", l.id);
                const ty = snapTargets("y", l.id);

                if (d.includes("e")) {
                    const s = bestSnap([x + w], tx, tolX);
                    if (s) { w += s.delta; guidesX.push(s.at); }
                } else if (d.includes("w")) {
                    const s = bestSnap([x], tx, tolX);
                    if (s) { x += s.delta; w -= s.delta; guidesX.push(s.at); }
                }

                if (d.includes("s")) {
                    const s = bestSnap([y + h], ty, tolY);
                    if (s) { h += s.delta; guidesY.push(s.at); }
                } else if (d.includes("n")) {
                    const s = bestSnap([y], ty, tolY);
                    if (s) { y += s.delta; h -= s.delta; guidesY.push(s.at); }
                }
            }

            if (w < MIN_SIZE) w = MIN_SIZE;
            if (h < MIN_SIZE) h = MIN_SIZE;

            l.x = x; l.y = y; l.w = w; l.h = h;
        }

        showSnapLines(guidesX, guidesY);
        syncPreview();
    }

    function onPointerUp(e) {
        if (!drag) return;
        drag = null;
        clearSnapLines();
        try { frameEl.releasePointerCapture(e.pointerId); } catch { /* ya se solto */ }
        renderPanel();
        save();
    }

    // ── Panel ───────────────────────────────────────────────────────────────

    let listEl = null, propsEl = null, panelEl = null;
    let formatsEl = null, bgsEl = null;

    const esc = (s) => String(s).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    function renderPanel() {
        if (!listEl) return;

        if (formatsEl) {
            formatsEl.innerHTML = FORMATS.map(f =>
                `<button class="win95-btn ed-btn ed-opt${f.id === formatId ? " on" : ""}" data-fmt="${f.id}">
                    ${f.name}<small>${f.label}</small></button>`).join("");
        }
        if (bgsEl) {
            bgsEl.innerHTML = BACKGROUNDS.map(b => {
                const pic = b.bars || b.image;
                const swatch = pic
                    ? `background-image:url('${pic}');background-size:cover`
                    : `background:${b.color}`;
                return `<button class="win95-btn ed-btn ed-opt${b.id === backgroundId ? " on" : ""}" data-bg="${b.id}">
                    <i class="ed-swatch" style="${swatch}"></i>${esc(b.name)}</button>`;
            }).join("");
        }

        // Arriba en la lista = adelante en la pantalla (como OBS).
        const rows = layers.slice().reverse().map(l => `
            <div class="ed-item${l.id === selectedId ? " sel" : ""}" data-id="${l.id}">
                <button class="ed-eye" data-act="eye" title="Mostrar / esconder">${l.visible ? "👁" : "🚫"}</button>
                <span class="ed-name">${esc(l.name)}</span>
                <button class="ed-mini" data-act="up"   title="Al frente">▲</button>
                <button class="ed-mini" data-act="down" title="Atrás">▼</button>
                <button class="ed-mini" data-act="del"  title="Borrar" ${l.type === "camera" ? "disabled" : ""}>✕</button>
            </div>`).join("");

        listEl.innerHTML = rows || `<div class="ed-empty">No hay capas.</div>`;

        const l = byId(selectedId);
        propsEl.innerHTML = !l ? `<div class="ed-empty">Toca una capa para editarla.</div>` : `
            <div class="ed-prop">
                <label>Opacidad <b>${Math.round(l.opacity * 100)}%</b></label>
                <input type="range" id="ed-op" min="0" max="100" value="${Math.round(l.opacity * 100)}">
            </div>
            <div class="ed-prop">
                <label>Giro <b>${Math.round(l.rot || 0)}°</b></label>
                <input type="range" id="ed-rot" min="-180" max="180" value="${Math.round(l.rot || 0)}">
            </div>`;

        const op = document.getElementById("ed-op");
        if (op) op.oninput = () => { l.opacity = op.value / 100; syncPreview(); renderPanel(); save(); };
        const rot = document.getElementById("ed-rot");
        if (rot) rot.oninput = () => { l.rot = +rot.value; syncPreview(); renderPanel(); save(); };
    }

    function onListClick(e) {
        const item = e.target.closest(".ed-item");
        if (!item) return;
        const id = item.dataset.id;
        const act = e.target.dataset && e.target.dataset.act;

        if (act === "eye") {
            const l = byId(id); if (l) l.visible = !l.visible;
            syncPreview(); renderPanel(); save(); onChange();
        } else if (act === "up") {
            move(id, +1);
        } else if (act === "down") {
            move(id, -1);
        } else if (act === "del") {
            remove(id);
        } else {
            selectedId = id;
            syncPreview(); renderPanel();
        }
    }

    // ── Teclado dentro del editor ───────────────────────────────────────────

    function onKey(e) {
        if (!editing) return;
        const l = byId(selectedId);

        if (e.key === "Delete" || e.key === "Backspace") {
            if (l && l.type !== "camera") { e.preventDefault(); remove(l.id); }
            return;
        }
        if (!l) return;

        const step = e.shiftKey ? 0.05 : 0.005;
        let moved = false;
        if (e.key === "ArrowLeft")  { l.x -= step; moved = true; }
        if (e.key === "ArrowRight") { l.x += step; moved = true; }
        if (e.key === "ArrowUp")    { l.y -= step; moved = true; }
        if (e.key === "ArrowDown")  { l.y += step; moved = true; }
        if (moved) { e.preventDefault(); syncPreview(); save(); }
    }

    // ── Abrir / cerrar ──────────────────────────────────────────────────────

    function setEditing(v) {
        editing = v;
        panelEl.classList.toggle("show", v);
        frameEl.classList.toggle("editing", v);
        document.body.classList.toggle("editing", v);
        if (guidesEl) guidesEl.hidden = !v;
        if (!v) { selectedId = null; clearSnapLines(); showDistances(null); }
        syncPreview();
        renderPanel();
        onChange();
    }

    // ── Arranque ────────────────────────────────────────────────────────────

    async function init(opts) {
        frameEl = opts.frameEl;
        hostEl  = opts.hostEl;
        videoEl = opts.videoEl;
        selectEl = opts.selectEl;
        guidesEl = opts.guidesEl;
        snapEl = opts.snapEl;
        distEl = opts.distEl;
        panelEl = opts.panelEl;

        listEl  = opts.listEl;
        propsEl = opts.propsEl;
        formatsEl = opts.formatsEl;
        bgsEl = opts.bgsEl;
        onChange = opts.onChange || (() => {});

        if (typeof opts.safeMargin === "number") {
            SAFE_X = Math.max(0, Math.min(0.3, opts.safeMargin));
        }
        if (Array.isArray(opts.backgrounds) && opts.backgrounds.length) {
            BACKGROUNDS = opts.backgrounds;
        }

        // Lo guardado manda; si no hay nada, se usa lo de booth-config.js.
        const saved = await load();
        layers = (saved && saved.layers) || [defaultCamera()];
        ensureCamera();

        formatId = (saved && saved.format) || opts.format || "story";
        backgroundId = (saved && saved.background) || opts.background || BACKGROUNDS[0].id;
        if (!FORMATS.some(f => f.id === formatId)) formatId = "story";
        if (!BACKGROUNDS.some(b => b.id === backgroundId)) backgroundId = BACKGROUNDS[0].id;

        applyStage();

        // La capa de camara reutiliza el <video> que ya existe en la pagina:
        // syncPreview lo mete dentro de su caja (appendChild lo mueve).
        syncPreview();
        renderPanel();

        frameEl.addEventListener("pointerdown", onPointerDown);
        frameEl.addEventListener("pointermove", onPointerMove);
        frameEl.addEventListener("pointerup", onPointerUp);
        frameEl.addEventListener("pointercancel", onPointerUp);
        listEl.addEventListener("click", onListClick);
        if (formatsEl) formatsEl.addEventListener("click", (e) => {
            const b = e.target.closest("[data-fmt]");
            if (b) setFormat(b.dataset.fmt);
        });
        if (bgsEl) bgsEl.addEventListener("click", (e) => {
            const b = e.target.closest("[data-bg]");
            if (b) setBackground(b.dataset.bg);
        });
        document.addEventListener("keydown", onKey);
    }

    return {
        init,
        drawTo,
        setCamera,
        addImage,
        exportLayout,
        importLayout,
        fitSelected,
        reset,
        cameraLayer,
        setEditing,
        setFormat,
        setBackground,
        aspect,
        format: () => formatId,
        setPhotoSize,
        isEditing: () => editing,
        count: () => layers.length,
        imageCount: () => layers.filter(l => l.type === "image").length,
    };

})();
