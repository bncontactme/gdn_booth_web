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
    const SNAP = 0.008;           // iman a orillas y centro (en 0..1)
    const MIN_SIZE = 0.02;

    let layers = [];              // [0] = hasta atras, [n-1] = hasta el frente
    let selectedId = null;
    let editing = false;
    let frameEl = null;
    let hostEl = null;
    let videoEl = null;
    let selectEl = null;
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
            dbRun("readwrite", s => s.put({ version: 1, layers: plain }, KEY))
                .catch(err => console.warn("[Capas] No se pudo guardar:", err));
        }, 300);
    }

    async function load() {
        try {
            const data = await dbRun("readonly", s => s.get(KEY));
            if (data && Array.isArray(data.layers) && data.layers.length) return data.layers;
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
            const stageAspect = 9 / 16;
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
                const stageAspect = 9 / 16;
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

    function snap(v, targets) {
        for (const t of targets) if (Math.abs(v - t) < SNAP) return t;
        return v;
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

        if (drag.mode === "move") {
            let nx = drag.orig.x + dx;
            let ny = drag.orig.y + dy;
            nx = snap(nx, [0, 0.5 - l.w / 2, 1 - l.w]);
            ny = snap(ny, [0, 0.5 - l.h / 2, 1 - l.h]);
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

            if (w < MIN_SIZE) w = MIN_SIZE;
            if (h < MIN_SIZE) h = MIN_SIZE;

            l.x = x; l.y = y; l.w = w; l.h = h;
        }

        syncPreview();
    }

    function onPointerUp(e) {
        if (!drag) return;
        drag = null;
        try { frameEl.releasePointerCapture(e.pointerId); } catch { /* ya se solto */ }
        renderPanel();
        save();
    }

    // ── Panel ───────────────────────────────────────────────────────────────

    let listEl = null, propsEl = null, panelEl = null;

    const esc = (s) => String(s).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    function renderPanel() {
        if (!listEl) return;

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
        if (!v) selectedId = null;
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
        panelEl = opts.panelEl;
        listEl  = opts.listEl;
        propsEl = opts.propsEl;
        onChange = opts.onChange || (() => {});

        const saved = await load();
        layers = saved || [defaultCamera()];
        ensureCamera();

        // La capa de camara reutiliza el <video> que ya existe en la pagina:
        // syncPreview lo mete dentro de su caja (appendChild lo mueve).
        syncPreview();
        renderPanel();

        frameEl.addEventListener("pointerdown", onPointerDown);
        frameEl.addEventListener("pointermove", onPointerMove);
        frameEl.addEventListener("pointerup", onPointerUp);
        frameEl.addEventListener("pointercancel", onPointerUp);
        listEl.addEventListener("click", onListClick);
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
        isEditing: () => editing,
        count: () => layers.length,
        imageCount: () => layers.filter(l => l.type === "image").length,
    };

})();
