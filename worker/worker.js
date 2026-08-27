/**
 * worker.js — Firma las subidas a Cloudinary.
 *
 * El problema que resuelve: un preset "sin firma" tiene que ir escrito en la
 * pagina, y cualquiera que abra el codigo fuente lo puede leer y usar para
 * subir cosas a tu cuenta.
 *
 * Con este worker el API Secret vive AQUI, en el servidor de Cloudflare, y
 * nunca llega al navegador. La pagina solo pide una firma que sirve unos
 * minutos y solo para una foto.
 *
 * Se configura con estas variables (ver worker/README.md):
 *   CLOUDINARY_CLOUD_NAME    publica
 *   CLOUDINARY_API_KEY       publica
 *   CLOUDINARY_API_SECRET    SECRETA  -> se guarda con `wrangler secret put`
 *   CLOUDINARY_FOLDER        opcional (por defecto gdn_booth)
 *   ALLOWED_ORIGIN           el link del booth, para que nadie mas lo use
 *   BOOTH_PIN                opcional. Si se llena, el mismo PIN que pide
 *                            la pagina (booth-config.js: pin) tiene que
 *                            llegar en cada peticion o no se firma nada.
 */

const DEFAULT_FOLDER = "gdn_booth";

// Solo se firman IDs con esta forma. Evita que alguien pida una firma para
// sobrescribir cualquier archivo de la cuenta.
const PUBLIC_ID_RE = /^capture_\d{10,20}$/;

function corsHeaders(origin, allowed) {
    const ok = allowed === "*" || origin === allowed;
    return {
        "Access-Control-Allow-Origin": ok ? (origin || allowed) : allowed,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
    };
}

function json(body, status, headers) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });
}

async function sha1Hex(text) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
    async fetch(request, env) {
        const allowed = env.ALLOWED_ORIGIN || "*";
        const origin = request.headers.get("Origin") || "";
        const cors = corsHeaders(origin, allowed);

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: cors });
        }
        if (request.method !== "POST") {
            return json({ error: "Usa POST" }, 405, cors);
        }
        if (allowed !== "*" && origin !== allowed) {
            return json({ error: "Origen no permitido" }, 403, cors);
        }

        const secret = env.CLOUDINARY_API_SECRET;
        const apiKey = env.CLOUDINARY_API_KEY;
        const cloudName = env.CLOUDINARY_CLOUD_NAME;
        if (!secret || !apiKey || !cloudName) {
            return json({ error: "Al worker le faltan variables de Cloudinary" }, 500, cors);
        }

        let body = {};
        try { body = await request.json(); } catch { /* cuerpo vacio */ }

        if (env.BOOTH_PIN && String(body.pin || "") !== env.BOOTH_PIN) {
            return json({ error: "PIN invalido" }, 403, cors);
        }

        const publicId = String(body.publicId || "");
        if (!PUBLIC_ID_RE.test(publicId)) {
            return json({ error: "publicId invalido" }, 400, cors);
        }

        const folder = env.CLOUDINARY_FOLDER || DEFAULT_FOLDER;
        const timestamp = Math.round(Date.now() / 1000);

        // Cloudinary firma los parametros ordenados alfabeticamente, unidos con
        // "&", y con el API Secret pegado al final. No se incluyen ni el
        // archivo, ni api_key, ni cloud_name, ni resource_type.
        const params = { folder, public_id: publicId, timestamp: String(timestamp) };
        const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
        const signature = await sha1Hex(toSign + secret);

        return json({ cloudName, apiKey, timestamp, signature, folder, publicId }, 200, cors);
    },
};
