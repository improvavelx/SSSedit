/**
 * Registry de zonas (uma por ROM / família de save).
 * `features` controla o que a UI pode mostrar/editar — só mecânicas reais da ROM.
 */

import * as roweSave from "../save.js";
import * as sdwSave from "./sdw/save.js";

/**
 * @typedef {object} ZoneFeatures
 * @property {boolean} ivs
 * @property {boolean} form
 * @property {boolean} isAlpha
 * @property {boolean} style
 * @property {boolean} seasonCaught
 * @property {boolean} isEventMon
 * @property {boolean} friendship
 * @property {boolean} isEgg
 * @property {boolean} metLevel
 * @property {boolean} pokeball
 * @property {boolean} pokerus
 * @property {boolean} markings
 * @property {boolean} otGender
 * @property {boolean} metLocation
 * @property {boolean} shiny
 * @property {boolean} nature
 * @property {boolean} ability
 * @property {number}  abilityMax
 * @property {boolean} speciesIdFree
 * @property {number}  boxes
 * @property {number}  perBox
 * @property {string}  monFormat
 */

/** @type {import('./registry.js').Zone[]} */
export const ZONES = [
  {
    id: "rowe",
    name: "R.O.W.E.",
    short: "R.O.W.E.",
    description:
      "Rom of the Wild Emerald — mon compacto (~52/76 B), sem IVs no save. Flags: Alpha, Style, Season, Event.",
    api: roweSave,
    detect: detectGbaSignature,
    features: {
      ivs: false,
      form: true,
      isAlpha: true,
      style: true,
      seasonCaught: true,
      isEventMon: true,
      friendship: true,
      isEgg: true,
      metLevel: true,
      pokeball: true,
      pokerus: true,
      markings: true,
      otGender: true,
      metLocation: true,
      shiny: true,
      nature: true,
      ability: true,
      abilityMax: 3,
      monGender: false, // R.O.W.E. compacto — gênero via PID não exposto ainda
      speciesIdFree: true,
      boxes: 21,
      perBox: 30,
      monFormat: "compacto 52/76 · bitfields R.O.W.E.",
    },
  },
  {
    id: "sdw",
    name: "Super Dark Worship",
    short: "SDW",
    description:
      "FireRed (BPRE) — mon 80/100 B, GAEM fixo sem XOR. IVs e origem Gen3. Sem Alpha/Style/Season/Event do R.O.W.E.",
    api: sdwSave,
    detect: detectGbaSignature,
    features: {
      ivs: true,
      form: false,
      isAlpha: false,
      style: false,
      seasonCaught: false,
      isEventMon: false,
      friendship: true,
      isEgg: true,
      metLevel: true,
      pokeball: true,
      pokerus: true,
      markings: true,
      otGender: true,
      metLocation: true,
      shiny: true,
      nature: true,
      ability: true,
      abilityMax: 1,
      monGender: true, // Gen3: sexo do mon = PID vs taxa da espécie
      speciesIdFree: true,
      boxes: 14,
      perBox: 30,
      monFormat: "Gen3 80/100 · GAEM · sem XOR",
    },
  },
];

function detectGbaSignature(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length !== 0x20000) return false;
  const SIG = 0x08012025;
  let found = 0;
  for (let s = 0; s < 32; s++) {
    const off = s * 0x1000 + 0xff8;
    const sig =
      (buf[off] |
        (buf[off + 1] << 8) |
        (buf[off + 2] << 16) |
        (buf[off + 3] << 24)) >>>
      0;
    if (sig === SIG) found++;
  }
  return found >= 8;
}

export function getZone(id) {
  return ZONES.find((z) => z.id === id);
}

export function detectZone(buf) {
  for (const z of ZONES) {
    if (typeof z.detect === "function" && z.detect(buf)) return z;
  }
  return undefined;
}

export function defaultZone() {
  return ZONES[0];
}

export function zoneFeatures(z) {
  return (z && z.features) || ZONES[0].features;
}
