// ============================================================================
//  ESCENAS  —  reemplazan a las escenas de OBS
//  ---------------------------------------------------------------------
//  Cada escena es un "look" que se aplica en vivo a la camara y que queda
//  grabado en la foto final.
//
//  Se cambia de escena con el mismo truco de siempre:
//  5 ENTER rapidos seguidos.
//
//  Para ajustar un look, cambia los numeros de "filter":
//    saturate(1.4)     mas color        saturate(0)    blanco y negro
//    contrast(1.2)     mas contraste    brightness(0.9) mas oscuro
//    sepia(0.3)        tono antiguo     hue-rotate(180deg) cambia los colores
// ============================================================================

window.BOOTH_SCENES = [
  {
    id: "gdn",
    name: "GDN",
    // Look limpio, un poco mas contrastado y calido.
    filter: "contrast(1.08) saturate(1.12) brightness(1.02)",
    vignette: 0.35,
    grain: 0.04,
  },
  {
    id: "rizo",
    name: "Rizo",
    // Calido, tipo foto analoga con algo de grano.
    filter: "contrast(1.18) saturate(1.35) sepia(0.18) brightness(1.03)",
    vignette: 0.5,
    grain: 0.1,
  },
  {
    id: "liminal",
    name: "Liminal",
    // Frio, apagado y raro — como camara de seguridad.
    filter: "contrast(1.25) saturate(0.55) hue-rotate(185deg) brightness(0.92)",
    vignette: 0.65,
    grain: 0.14,
  },
  {
    id: "vhs",
    name: "VHS",
    // Blanco y negro duro con mucho grano.
    filter: "grayscale(1) contrast(1.45) brightness(1.05)",
    vignette: 0.7,
    grain: 0.2,
  },
];
