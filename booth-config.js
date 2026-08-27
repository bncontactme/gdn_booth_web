// ============================================================================
//  CONFIGURACION DEL PHOTO BOOTH
//  ---------------------------------------------------------------------
//  Este es el UNICO archivo que necesitas editar.
//  Cambia los dos valores de abajo y guarda. Nada mas.
// ============================================================================

window.BOOTH_CONFIG = {

  // --------------------------------------------------------------------
  //  1. TU "CLOUD NAME" DE CLOUDINARY
  // --------------------------------------------------------------------
  //  Entra a https://console.cloudinary.com  ->  arriba a la izquierda
  //  aparece "Cloud name". Copialo y pegalo aqui entre las comillas.
  cloudName: "duog120j4",

  // --------------------------------------------------------------------
  //  2. TU "UPLOAD PRESET" (sin firma)
  // --------------------------------------------------------------------
  //  En Cloudinary:  Settings -> Upload -> Upload presets -> Add upload preset
  //    - Signing Mode:  Unsigned      <-- MUY IMPORTANTE
  //    - Folder:        gdn_booth
  //  Guarda y copia el nombre del preset aqui abajo.
  uploadPreset: "",

  // --------------------------------------------------------------------
  //  3. MODO SEGURO (opcional, recomendado)
  // --------------------------------------------------------------------
  //  Si llenas esto, el "uploadPreset" de arriba YA NO SE USA y tu cuenta
  //  de Cloudinary queda protegida: la clave secreta vive en el worker,
  //  nunca en esta pagina.
  //
  //  Pega aqui el link que te da Cloudflare al publicar worker/worker.js.
  //  Instrucciones completas en  worker/README.md
  //
  //  Ejemplo:  "https://gdn-booth-sign.TU-USUARIO.workers.dev"
  signUrl: "https://gdn-booth-sign.guadalajaradenoxe.workers.dev",

  // --------------------------------------------------------------------
  //  4. CANDADO (opcional, recomendado)
  // --------------------------------------------------------------------
  //  Pide un PIN antes de dejar prender la camara. No es un secreto real
  //  (esta pagina es publica), pero evita que cualquiera que llegue al
  //  link se ponga a usar el booth sin que tu se lo digas.
  //
  //  Si tienes el "modo seguro" (signUrl arriba) prendido, el worker
  //  TAMBIEN revisa este PIN antes de firmar cualquier foto — asi que
  //  aunque alguien se salte esta pantalla desde las herramientas del
  //  navegador, el worker igual le va a decir que no.
  //
  //  Para que el worker lo revise, pon el MISMO valor en
  //  worker/wrangler.toml (BOOTH_PIN) y vuelve a publicar el worker.
  //
  //  Cambialo antes de cada evento. Dejalo vacio ("") para no pedir nada.
  pin: "GDN2026",

  // --------------------------------------------------------------------
  //  5. AJUSTES (opcional — funcionan bien asi)
  // --------------------------------------------------------------------

  // Carpeta dentro de Cloudinary. Debe ser LA MISMA que pusiste en el preset.
  folder: "gdn_booth",

  // Segundos de cuenta regresiva antes de la foto.
  countdownSeconds: 3,

  // Segundos que se queda el codigo QR en pantalla.
  qrSeconds: 18,

  // Calidad del JPEG (0.5 = mas ligero, 0.95 = mas nitido).
  jpegQuality: 0.85,

  // Lado largo maximo de la foto en pixeles.
  maxLongEdge: 1920,

  // Margen seguro del editor (F2): el recuadro punteado que marca hasta
  // donde conviene acercar las cosas a la orilla. 0.06 = 6% de cada lado.
  // Solo es una guia para acomodar; no recorta la foto.
  safeMargin: 0.06,

  // --------------------------------------------------------------------
  //  FONDOS (se eligen en el editor, F2 -> Fondo)
  // --------------------------------------------------------------------
  //  El fondo se ve atras de todas las capas y TAMBIEN sale en la foto
  //  cuando la camara no cubre toda la pantalla (por ejemplo en Perfil).
  //
  //  Para agregar mas: copia un renglon y cambia los datos.
  //    color: el fondo DE LA FOTO (cualquier color CSS)
  //    bars:  imagen SOLO para las barras de los lados (no sale en la foto)
  //    image: imagen que SI llena la foto entera (usalo solo si eso quieres)
  backgrounds: [
    { id: "gdn",    name: "GDN",    color: "#000000", bars: "assets/logo.jpg" },
    { id: "blanco", name: "Blanco", color: "#ffffff" },
    { id: "negro",  name: "Negro",  color: "#000000" },
  ],

  // Fondo con el que arranca la primera vez.
  background: "gdn",

  // Formato con el que arranca: "story" (9:16), "completo" (16:9) o "perfil" (1:1).
  format: "story",

  // Efecto espejo: la gente se ve como en un espejo (se siente natural).
  // Ponlo en false si sale texto al reves en las fotos.
  mirror: true,

  // Texto que se muestra debajo del QR.
  qrMessage: "¡Escanea para descargar tu foto!",
};
