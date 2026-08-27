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
  pin: "2026",

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

  // Efecto espejo: la gente se ve como en un espejo (se siente natural).
  // Ponlo en false si sale texto al reves en las fotos.
  mirror: true,

  // Texto que se muestra debajo del QR.
  qrMessage: "¡Escanea para descargar tu foto!",
};
