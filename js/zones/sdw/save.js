/**
 * Zona Super Dark Worship (FireRed base).
 * BoxPokemon 80 B / PartyPokemon 100 B, substructs em ordem fixa GAEM,
 * sem criptografia de mon (confirmado no save v2.0.3).
 * Offsets SaveBlock1 no estilo FRLG (party @0x34/0x38, money @0x290).
 */

const SECTOR = 0x1000;
const DATA = 0xff4;
const SIG = 0x08012025;

export const BOX_BYTES = 80;
export const PARTY_BYTES = 100;
export const BOXES = 14;
export const PER_BOX = 30;

// SaveBlock1 (FRLG)
const SB1_PARTY_COUNT = 0x34;
const SB1_PARTY = 0x38;
const SB1_MONEY = 0x290;
const SB1_COINS = 0x294;
const SB1_REGISTERED = 0x296;

// ItemSlot = u16 itemId + u16 quantity (qty may be XOR encryptionKey)
export const BAG_POCKETS = [
  { id: "pc", name: "PC", offset: 0x298, count: 30 },
  { id: "items", name: "Itens", offset: 0x310, count: 40 },
  { id: "key", name: "Chave", offset: 0x3b8, count: 30 },
  { id: "balls", name: "Bolas", offset: 0x430, count: 16 },
];

// SaveBlock2
const SB2_NAME = 0x00;
const SB2_GENDER = 0x08;
const SB2_TRAINER_ID = 0x0a; // u32: TID low, SID high
const SB2_HOURS = 0x0e;
const SB2_MINUTES = 0x10;
const SB2_ENCRYPTION_KEY = 0xf20; // FRLG; may be 0 on some hacks

// PC storage (sections 5–13): currentBox u32 + 14*30*80
const PC_CURRENT_BOX = 0;
const PC_BOX_DATA = 4;

const CHARSET = new Map();
for (let i = 0; i < 26; i++) CHARSET.set(0xbb + i, String.fromCharCode(65 + i));
for (let i = 0; i < 26; i++) CHARSET.set(0xd5 + i, String.fromCharCode(97 + i));
for (let i = 0; i < 10; i++) CHARSET.set(0xa1 + i, String(i));
CHARSET.set(0x00, " ");
CHARSET.set(0xae, "-");
CHARSET.set(0xad, ".");

export function decodeText(bytes) {
  let text = "";
  for (const byte of bytes) {
    if (byte === 0xff) break;
    text += CHARSET.get(byte) ?? "";
  }
  return text.trim();
}

export function encodeText(text, length) {
  const out = new Uint8Array(length);
  out.fill(0xff);
  const rev = new Map();
  for (const [code, ch] of CHARSET.entries()) rev.set(ch, code);
  const s = String(text || "");
  for (let i = 0; i < Math.min(s.length, length); i++) {
    const code = rev.get(s[i]);
    out[i] = code !== undefined ? code : 0x00;
  }
  return out;
}

function u16(buf, offset) {
  return buf[offset] | (buf[offset + 1] << 8);
}

function u32(buf, offset) {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  );
}

function putU16(buf, offset, value) {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
}

function putU32(buf, offset, value) {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

export function sectorChecksum(data) {
  let sum = 0;
  for (let i = 0; i < DATA; i += 4) {
    sum = (sum + u32(data, i)) >>> 0;
  }
  return ((sum >>> 16) + (sum & 0xffff)) & 0xffff;
}

function listSections(buf) {
  const out = [];
  for (let s = 0; s < 32; s++) {
    const base = s * SECTOR;
    const sig = u32(buf, base + 0xff8);
    if (sig !== SIG) continue;
    out.push({
      sector: s,
      id: u16(buf, base + 0xff4),
      counter: u32(buf, base + 0xffc),
      base,
    });
  }
  return out;
}

export function activeCounter(buf) {
  const secs = listSections(buf);
  let best = -1;
  for (const s of secs) if (s.counter > best) best = s.counter;
  return best;
}

function activeMap(buf) {
  const target = activeCounter(buf);
  const map = new Map();
  for (const s of listSections(buf)) {
    if (s.counter === target) map.set(s.id, s.sector);
  }
  return map;
}

export function checksumsMatch(buf) {
  const map = activeMap(buf);
  for (const [, sector] of map) {
    const base = sector * SECTOR;
    const stored = u16(buf, base + 0xff6);
    const calc = sectorChecksum(buf.subarray(base, base + DATA));
    if (stored !== calc) return false;
  }
  return true;
}

function refreshChecksum(buf, sector) {
  const base = sector * SECTOR;
  const calc = sectorChecksum(buf.subarray(base, base + DATA));
  putU16(buf, base + 0xff6, calc);
}

function writeBlock(buf, map, firstId, offset, bytes) {
  let pos = offset;
  let remaining = bytes.length;
  let src = 0;
  while (remaining > 0) {
    const sid = firstId + Math.floor(pos / DATA);
    const local = pos % DATA;
    const take = Math.min(remaining, DATA - local);
    const sector = map.get(sid);
    if (sector === undefined) throw new Error(`Setor ${sid} ausente no save.`);
    const base = sector * SECTOR;
    for (let i = 0; i < take; i++) buf[base + local + i] = bytes[src + i];
    refreshChecksum(buf, sector);
    pos += take;
    src += take;
    remaining -= take;
  }
}

function readBlock(buf, map, firstId, offset, length) {
  const out = new Uint8Array(length);
  let pos = offset;
  let remaining = length;
  let dst = 0;
  while (remaining > 0) {
    const sid = firstId + Math.floor(pos / DATA);
    const local = pos % DATA;
    const take = Math.min(remaining, DATA - local);
    const sector = map.get(sid);
    if (sector === undefined) throw new Error(`Setor ${sid} ausente no save.`);
    const base = sector * SECTOR;
    for (let i = 0; i < take; i++) out[dst + i] = buf[base + local + i];
    pos += take;
    dst += take;
    remaining -= take;
  }
  return out;
}

/** Checksum dos 48 bytes de dados (24 × u16). */
function monDataChecksum(data48) {
  let sum = 0;
  for (let i = 0; i < 48; i += 2) sum = (sum + u16(data48, i)) & 0xffff;
  return sum;
}


/**
 * Taxa de gênero Gen3 (byte da personal).
 * Se (PID & 0xFF) >= threshold → macho; senão fêmea.
 * 0xFF = sem gênero, 0xFE = só fêmea, 0x00 = só macho.
 * Default 0x1F (87,5% macho — starters como Sprigatito).
 */
const GENDER_THRESHOLD_DEFAULT = 0x1f;

function genderThresholdForSpecies(speciesId) {
  // Sem tabela completa do SDW: starters / maioria usam 87,5% macho
  return GENDER_THRESHOLD_DEFAULT;
}

/** 0 = macho, 1 = fêmea, null = sem gênero */
function monGenderFromPid(pid, threshold) {
  if (threshold === 0xff) return null;
  if (threshold === 0xfe) return 1;
  if (threshold === 0x00) return 0;
  return (pid & 0xff) < threshold ? 1 : 0;
}

/**
 * Ajusta PID para o sexo desejado, tentando manter nature e shiny.
 * gender: 0 macho, 1 fêmea
 */
function pidWithGender(pid, otId, gender, threshold, nature, shiny) {
  if (threshold === 0xff || threshold === 0xfe || threshold === 0x00) return pid >>> 0;
  const tid = otId & 0xffff;
  const sid = (otId >>> 16) & 0xffff;
  const wantNature = nature != null && nature >= 0 && nature < 25 ? nature : pid % 25;
  const wantShiny = shiny == null ? null : !!shiny;

  function isShinyPid(p) {
    return (((p >>> 16) ^ (p & 0xffff) ^ tid ^ sid) & 0xffff) < 8;
  }

  // Busca PID que satisfaz sexo + nature (+ shiny se pedido)
  for (let low = 0; low < 256; low++) {
    if (monGenderFromPid(low, threshold) !== gender) continue;
    // base com low byte e nature
    let base = (low + wantNature) % 25;
    // low já fixo; construímos candidatos: ... | low, ajustando high e bits médios
    for (let n = 0; n < 256; n++) {
      // garante % 25 == wantNature: p ≡ wantNature (mod 25)
      let mid = (n << 8);
      let p = ((mid) | low) >>> 0;
      // alinhar nature
      const mod = p % 25;
      if (mod !== wantNature) {
        p = (p + (wantNature - mod + 25) % 25) >>> 0;
        if ((p & 0xff) !== low) continue; // low byte mudou
      }
      if (monGenderFromPid(p, threshold) !== gender) continue;
      if (wantShiny === null) return p >>> 0;
      if (wantShiny) {
        const xor = (tid ^ sid) & 0xffff;
        const newHigh = (xor ^ (p & 0xffff)) & 0xffff;
        const shinyP = ((newHigh << 16) | (p & 0xffff)) >>> 0;
        if (shinyP % 25 === wantNature && monGenderFromPid(shinyP, threshold) === gender && isShinyPid(shinyP))
          return shinyP >>> 0;
      } else {
        // não shiny: se ficou shiny, flip high bit
        let q = p;
        if (isShinyPid(q)) q = (q ^ 0x10000000) >>> 0;
        if (q % 25 === wantNature && monGenderFromPid(q, threshold) === gender && !isShinyPid(q))
          return q >>> 0;
      }
    }
  }
  return pid >>> 0;
}

/**
 * Lê BoxPokemon 80 B (GAEM fixo, sem XOR).
 * Flags em 0x13: bit1 hasSpecies.
 */
function readBox(raw) {
  if (!raw || raw.length < BOX_BYTES) return null;
  const flags = raw[0x13];
  const hasSpecies = (flags & 0x02) !== 0;
  const speciesId = u16(raw, 0x20);
  const pid = u32(raw, 0);
  // Vazio / residual: exige flag hasSpecies ou (species e PID não nulos)
  if (speciesId === 0 || speciesId === 0xffff) return null;
  if (!hasSpecies && pid === 0) return null;

  const otId = u32(raw, 4);
  const nature = pid % 25;
  const shiny =
    (((pid >>> 16) ^ (pid & 0xffff) ^ (otId >>> 16) ^ (otId & 0xffff)) & 0xffff) < 8;

  const itemId = u16(raw, 0x22);
  const exp = u32(raw, 0x24);
  const friendship = raw[0x29];
  const moves = [u16(raw, 0x2c), u16(raw, 0x2e), u16(raw, 0x30), u16(raw, 0x32)];
  const pp = [raw[0x34], raw[0x35], raw[0x36], raw[0x37]];
  const evs = [raw[0x38], raw[0x39], raw[0x3a], raw[0x3b], raw[0x3c], raw[0x3d]];
  const pokerus = raw[0x44];
  const metLocation = raw[0x45];
  const origins = u16(raw, 0x46);
  const metLevel = origins & 0x7f;
  const pokeball = (origins >>> 11) & 0xf;
  const otGender = (origins >>> 15) & 1;
  const ivWord = u32(raw, 0x48);
  const ivs = [
    ivWord & 31,
    (ivWord >>> 5) & 31,
    (ivWord >>> 10) & 31,
    (ivWord >>> 15) & 31,
    (ivWord >>> 20) & 31,
    (ivWord >>> 25) & 31,
  ];
  const isEgg = ((ivWord >>> 30) & 1) === 1;
  const ability = (ivWord >>> 31) & 1;
  const gThreshold = genderThresholdForSpecies(speciesId);
  const monGender = monGenderFromPid(pid, gThreshold);

  return {
    personality: pid,
    otId,
    nickname: decodeText(raw.subarray(0x08, 0x12)),
    ot: decodeText(raw.subarray(0x14, 0x1b)),
    markings: raw[0x1b],
    speciesId,
    form: 0,
    itemId,
    exp,
    friendship,
    moves,
    pp,
    evs,
    ivs,
    nature,
    shiny,
    ability,
    pokerus: pokerus !== 0,
    metLocation,
    metLevel,
    pokeball: pokeball || 4,
    otGender,
    monGender,
    genderThreshold: gThreshold,
    isEgg,
    isAlpha: false,
    style: 0,
    isEventMon: false,
    seasonCaught: 0,
  };
}

function emptyBox(raw) {
  if (!raw || raw.length < BOX_BYTES) return true;
  const speciesId = u16(raw, 0x20);
  const hasSpecies = (raw[0x13] & 0x02) !== 0;
  const pid = u32(raw, 0);
  if (speciesId === 0 || speciesId === 0xffff) return true;
  if (!hasSpecies && pid === 0) return true;
  return false;
}

function readPartyExtra(raw) {
  if (!raw || raw.length < PARTY_BYTES) return {};
  return {
    level: raw[0x54] || 1,
    hp: u16(raw, 0x56),
    maxHp: u16(raw, 0x58),
    atk: u16(raw, 0x5a),
    def: u16(raw, 0x5c),
    spe: u16(raw, 0x5e),
    spa: u16(raw, 0x60),
    spd: u16(raw, 0x62),
  };
}

function readEncryptionKey(buf, map) {
  const sb2 = readBlock(buf, map, 0, 0, 0xf24);
  return u32(sb2, SB2_ENCRYPTION_KEY) >>> 0;
}

function decryptQty(encrypted, key) {
  return (encrypted ^ (key & 0xffff)) & 0xffff;
}

function encryptQty(qty, key) {
  return (qty ^ (key & 0xffff)) & 0xffff;
}

function readPocket(buf, map, pocket, key) {
  const raw = readBlock(buf, map, 1, pocket.offset, pocket.count * 4);
  const slots = [];
  for (let i = 0; i < pocket.count; i++) {
    const itemId = u16(raw, i * 4);
    const qtyEnc = u16(raw, i * 4 + 2);
    const quantity = key ? decryptQty(qtyEnc, key) : qtyEnc;
    if (itemId !== 0) slots.push({ itemId, quantity, slot: i });
  }
  return slots;
}

export function readSave(buf) {
  if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
  if (buf.length !== 0x20000) throw new Error("Save deve ter 128 KB.");
  const map = activeMap(buf);
  if (!map.has(0) || !map.has(1)) throw new Error("Save GBA inválido (setores ausentes).");

  const sb2 = readBlock(buf, map, 0, 0, 0xf24);
  const trainer = decodeText(sb2.subarray(SB2_NAME, SB2_NAME + 8));
  const gender = sb2[SB2_GENDER];
  const tidFull = u32(sb2, SB2_TRAINER_ID);
  const tid = tidFull & 0xffff;
  const sid = (tidFull >>> 16) & 0xffff;
  const hours = u16(sb2, SB2_HOURS);
  const minutes = sb2[SB2_MINUTES];
  const key = u32(sb2, SB2_ENCRYPTION_KEY) >>> 0;

  const sb1 = readBlock(buf, map, 1, 0, 0x3d68);
  const partyCount = Math.min(6, u32(sb1, SB1_PARTY_COUNT) || 0);
  const money = u32(sb1, SB1_MONEY);
  const coins = u16(sb1, SB1_COINS);

  const party = [];
  for (let i = 0; i < partyCount; i++) {
    const raw = sb1.subarray(SB1_PARTY + i * PARTY_BYTES, SB1_PARTY + (i + 1) * PARTY_BYTES);
    const mon = readBox(raw);
    if (!mon) continue;
    Object.assign(mon, readPartyExtra(raw));
    mon.ref = { kind: "party", index: i };
    party.push(mon);
  }

  const pc = readBlock(buf, map, 5, 0, PC_BOX_DATA + BOXES * PER_BOX * BOX_BYTES);
  const boxes = [];
  for (let bi = 0; bi < BOXES; bi++) {
    for (let si = 0; si < PER_BOX; si++) {
      const index = bi * PER_BOX + si;
      const off = PC_BOX_DATA + index * BOX_BYTES;
      const raw = pc.subarray(off, off + BOX_BYTES);
      if (emptyBox(raw)) continue;
      const mon = readBox(raw);
      if (!mon) continue;
      mon.ref = { kind: "box", index };
      boxes.push(mon);
    }
  }

  const bag = {};
  for (const pocket of BAG_POCKETS) {
    bag[pocket.id] = readPocket(buf, map, pocket, key);
  }

  return {
    trainer,
    gender,
    tid,
    sid,
    hours,
    minutes,
    money,
    coins,
    party,
    boxes,
    bag,
    encryptionKey: key,
  };
}

export function writePocket(buf, pocketId, slots) {
  const map = activeMap(buf);
  const pocket = BAG_POCKETS.find((p) => p.id === pocketId);
  if (!pocket) throw new Error("Bolso inválido.");
  const key = readEncryptionKey(buf, map);
  const raw = new Uint8Array(pocket.count * 4);
  const list = Array.isArray(slots) ? slots.filter((s) => s && s.itemId) : [];
  for (let i = 0; i < pocket.count; i++) {
    const s = list[i];
    if (!s) continue;
    putU16(raw, i * 4, s.itemId & 0xffff);
    const qty = Math.max(0, Math.min(0xffff, s.quantity | 0));
    putU16(raw, i * 4 + 2, key ? encryptQty(qty, key) : qty);
  }
  const next = new Uint8Array(buf);
  writeBlock(next, map, 1, pocket.offset, raw);
  return next;
}

export function deleteBagItem(buf, pocketId, slotIndex) {
  const view = readSave(buf);
  const pocket = BAG_POCKETS.find((p) => p.id === pocketId);
  if (!pocket) throw new Error("Bolso inválido.");
  const slots = (view.bag[pocketId] || []).filter((s) => s.slot !== slotIndex);
  // compact by re-writing without holes
  return writePocket(
    buf,
    pocketId,
    slots.map((s) => ({ itemId: s.itemId, quantity: s.quantity }))
  );
}

export function setBagItemQty(buf, pocketId, slotIndex, quantity) {
  const view = readSave(buf);
  const slots = [...(view.bag[pocketId] || [])];
  const hit = slots.find((s) => s.slot === slotIndex);
  if (!hit) throw new Error("Slot de item não encontrado.");
  if (quantity <= 0) return deleteBagItem(buf, pocketId, slotIndex);
  hit.quantity = quantity;
  return writePocket(
    buf,
    pocketId,
    slots.map((s) => ({ itemId: s.itemId, quantity: s.quantity }))
  );
}

export function addBagItem(buf, pocketId, itemId, quantity) {
  if (!itemId) throw new Error("Item inválido.");
  const view = readSave(buf);
  const pocket = BAG_POCKETS.find((p) => p.id === pocketId);
  if (!pocket) throw new Error("Bolso inválido.");
  const slots = [...(view.bag[pocketId] || [])];
  const existing = slots.find((s) => s.itemId === itemId);
  if (existing) {
    existing.quantity = Math.min(0xffff, (existing.quantity || 0) + (quantity || 1));
  } else {
    if (slots.length >= pocket.count) throw new Error("Bolso cheio.");
    slots.push({ itemId, quantity: quantity || 1 });
  }
  return writePocket(
    buf,
    pocketId,
    slots.map((s) => ({ itemId: s.itemId, quantity: s.quantity }))
  );
}

export function writeMoney(buf, money, coins) {
  const map = activeMap(buf);
  const next = new Uint8Array(buf);
  const raw = readBlock(next, map, 1, SB1_MONEY, 6);
  putU32(raw, 0, money >>> 0);
  putU16(raw, 4, coins & 0xffff);
  writeBlock(next, map, 1, SB1_MONEY, raw);
  return next;
}

/**
 * Atualiza treinador em SaveBlock2 (nome, gênero, TID/SID).
 * @param {{ name?: string, gender?: number, tid?: number, sid?: number }} edit
 */
export function writeTrainer(buf, edit) {
  const map = activeMap(buf);
  const next = new Uint8Array(buf);
  // só o trecho inicial do SB2 (nome + ids)
  const sb2 = new Uint8Array(readBlock(next, map, 0, 0, 0x20));
  if (edit.name != null) {
    sb2.set(encodeText(String(edit.name), 8), SB2_NAME);
  }
  if (edit.gender != null) sb2[SB2_GENDER] = edit.gender & 1;
  if (edit.tid != null || edit.sid != null) {
    const cur = u32(sb2, SB2_TRAINER_ID);
    const tid = edit.tid != null ? edit.tid & 0xffff : cur & 0xffff;
    const sid = edit.sid != null ? edit.sid & 0xffff : (cur >>> 16) & 0xffff;
    putU32(sb2, SB2_TRAINER_ID, ((sid << 16) | tid) >>> 0);
  }
  writeBlock(next, map, 0, 0, sb2);
  return next;
}

export function saveStatus(buf) {
  try {
    const map = activeMap(buf);
    const ok = checksumsMatch(buf);
    const ctr = activeCounter(buf);
    return { ok, counter: ctr, sectors: map.size, size: buf.length };
  } catch (e) {
    return { ok: false, counter: -1, sectors: 0, size: buf?.length || 0, error: String(e.message || e) };
  }
}

function patchBox(raw, edit) {
  if (!raw || raw.length < BOX_BYTES) throw new Error("Buffer de mon inválido.");
  if (edit.nickname != null) {
    const enc = encodeText(edit.nickname, 10);
    raw.set(enc, 0x08);
  }
  if (edit.ot != null) {
    const enc = encodeText(edit.ot, 7);
    raw.set(enc, 0x14);
  }
  if (edit.speciesId != null) {
    putU16(raw, 0x20, edit.speciesId & 0xffff);
    raw[0x13] = (raw[0x13] | 0x02) & 0xff; // hasSpecies
  }
  if (edit.itemId != null) putU16(raw, 0x22, edit.itemId & 0xffff);
  if (edit.exp != null) putU32(raw, 0x24, edit.exp >>> 0);
  if (edit.friendship != null) raw[0x29] = edit.friendship & 0xff;
  if (Array.isArray(edit.moves) && edit.moves.length > 0) {
    for (let i = 0; i < 4; i++) putU16(raw, 0x2c + i * 2, (edit.moves[i] || 0) & 0xffff);
  }
  if (Array.isArray(edit.pp) && edit.pp.length > 0) {
    for (let i = 0; i < 4; i++) raw[0x34 + i] = (edit.pp[i] || 0) & 0xff;
  }
  if (Array.isArray(edit.evs) && edit.evs.length >= 6) {
    for (let i = 0; i < 6; i++) raw[0x38 + i] = edit.evs[i] & 0xff;
  }
  if (edit.metLocation != null) raw[0x45] = edit.metLocation & 0xff;
  if (edit.pokerus != null) raw[0x44] = edit.pokerus ? (raw[0x44] || 0x10) : 0;

  // origins: metLevel, ball, otGender
  let origins = u16(raw, 0x46);
  if (edit.metLevel != null) origins = (origins & ~0x7f) | (edit.metLevel & 0x7f);
  if (edit.pokeball != null) origins = (origins & ~(0xf << 11)) | ((edit.pokeball & 0xf) << 11);
  if (edit.otGender != null) origins = (origins & ~(1 << 15)) | ((edit.otGender & 1) << 15);
  putU16(raw, 0x46, origins);

  if (Array.isArray(edit.ivs) && edit.ivs.length >= 6) {
    let ivWord = 0;
    for (let i = 0; i < 6; i++) ivWord |= (edit.ivs[i] & 31) << (5 * i);
    if (edit.isEgg) ivWord |= 1 << 30;
    if (edit.ability) ivWord |= 1 << 31;
    putU32(raw, 0x48, ivWord >>> 0);
  } else if (edit.ability != null || edit.isEgg != null) {
    let ivWord = u32(raw, 0x48);
    if (edit.isEgg != null) {
      if (edit.isEgg) ivWord |= 1 << 30;
      else ivWord &= ~(1 << 30);
    }
    if (edit.ability != null) {
      if (edit.ability) ivWord |= 1 << 31;
      else ivWord &= ~(1 << 31);
    }
    putU32(raw, 0x48, ivWord >>> 0);
  }

  if (edit.markings != null) raw[0x1b] = edit.markings & 0xff;

  // Shiny: adjust PID low bits vs OTID (simple approach — set/clear by rewriting PID)
  if (edit.shiny != null) {
    const otId = u32(raw, 4);
    let pid = u32(raw, 0);
    const tid = otId & 0xffff;
    const sid = (otId >>> 16) & 0xffff;
    const isShiny =
      (((pid >>> 16) ^ (pid & 0xffff) ^ tid ^ sid) & 0xffff) < 8;
    if (edit.shiny && !isShiny) {
      const psv = (pid >>> 16) ^ (pid & 0xffff);
      const xor = (tid ^ sid) & 0xffff;
      // force shiny by setting upper to match
      const newHigh = (xor ^ (pid & 0xffff)) & 0xffff;
      pid = ((newHigh << 16) | (pid & 0xffff)) >>> 0;
      putU32(raw, 0, pid);
    } else if (!edit.shiny && isShiny) {
      pid = (pid ^ 0x10000000) >>> 0;
      putU32(raw, 0, pid);
    }
  }

  // Nature is PID % 25 — only rewrite PID if nature requested and differs
  if (edit.nature != null && edit.nature >= 0 && edit.nature < 25) {
    let pid = u32(raw, 0);
    if (pid % 25 !== edit.nature) {
      pid = (pid - (pid % 25) + edit.nature) >>> 0;
      putU32(raw, 0, pid);
    }
  }

  // Sexo do mon (Gen3): ajusta PID vs taxa da espécie
  const wantGender = edit.monGender != null ? edit.monGender : edit.gender;
  if (wantGender != null && (wantGender === 0 || wantGender === 1)) {
    const speciesId = edit.speciesId != null ? edit.speciesId : u16(raw, 0x20);
    const threshold = genderThresholdForSpecies(speciesId);
    const otId = u32(raw, 4);
    let pid = u32(raw, 0);
    const nature = edit.nature != null ? edit.nature : pid % 25;
    const shiny =
      edit.shiny != null
        ? edit.shiny
        : (((pid >>> 16) ^ (pid & 0xffff) ^ (otId >>> 16) ^ (otId & 0xffff)) & 0xffff) < 8;
    pid = pidWithGender(pid, otId, wantGender, threshold, nature, shiny);
    putU32(raw, 0, pid);
  }

  // checksum over data region
  const data = raw.subarray(0x20, 0x50);
  putU16(raw, 0x1c, monDataChecksum(data));
}

export function writeMon(buf, ref, edit) {
  const map = activeMap(buf);
  const next = new Uint8Array(buf);

  if (ref.kind === "party") {
    // Escrita cirúrgica: só o slot do mon (não reescreve o SaveBlock1 inteiro)
    const off = SB1_PARTY + ref.index * PARTY_BYTES;
    const raw = new Uint8Array(readBlock(next, map, 1, off, PARTY_BYTES));
    patchBox(raw, edit);
    if (edit.level != null) raw[0x54] = edit.level & 0xff;
    if (edit.pp && Array.isArray(edit.pp)) {
      for (let i = 0; i < 4; i++) raw[0x34 + i] = (edit.pp[i] || 0) & 0xff;
    }
    writeBlock(next, map, 1, off, raw);
    return next;
  }

  if (ref.kind === "box") {
    const index = ref.index | 0;
    const off = PC_BOX_DATA + index * BOX_BYTES;
    const raw = new Uint8Array(readBlock(next, map, 5, off, BOX_BYTES));
    patchBox(raw, edit);
    writeBlock(next, map, 5, off, raw);
    return next;
  }

  throw new Error("Referência inválida.");
}

export function deleteMon(buf, ref) {
  const map = activeMap(buf);
  const next = new Uint8Array(buf);

  if (ref.kind === "party") {
    // Compacta só a área do party + contador (offsets baixos do SB1)
    const areaOff = SB1_PARTY_COUNT;
    const areaLen = SB1_PARTY + 6 * PARTY_BYTES - SB1_PARTY_COUNT;
    const area = new Uint8Array(readBlock(next, map, 1, areaOff, areaLen));
    // area[0..3] = count, party starts at (SB1_PARTY - SB1_PARTY_COUNT)
    const partyBase = SB1_PARTY - SB1_PARTY_COUNT;
    const count = Math.min(6, u32(area, 0) || 0);
    const idx = ref.index | 0;
    if (idx < 0 || idx >= count) throw new Error("Slot de party inválido.");
    for (let i = idx; i < count - 1; i++) {
      const src = partyBase + (i + 1) * PARTY_BYTES;
      const dst = partyBase + i * PARTY_BYTES;
      area.copyWithin(dst, src, src + PARTY_BYTES);
    }
    const last = partyBase + (count - 1) * PARTY_BYTES;
    area.fill(0, last, last + PARTY_BYTES);
    putU32(area, 0, count - 1);
    writeBlock(next, map, 1, areaOff, area);
    return next;
  }

  if (ref.kind === "box") {
    const index = ref.index | 0;
    const off = PC_BOX_DATA + index * BOX_BYTES;
    const zeros = new Uint8Array(BOX_BYTES);
    writeBlock(next, map, 5, off, zeros);
    return next;
  }

  throw new Error("Referência inválida.");
}

export function cloneMon(buf, srcRef, destRef, force = false) {
  const map = activeMap(buf);
  const next = new Uint8Array(buf);
  let srcRaw;

  if (srcRef.kind === "party") {
    srcRaw = new Uint8Array(
      readBlock(next, map, 1, SB1_PARTY + srcRef.index * PARTY_BYTES, BOX_BYTES)
    );
  } else if (srcRef.kind === "box") {
    const off = PC_BOX_DATA + srcRef.index * BOX_BYTES;
    srcRaw = new Uint8Array(readBlock(next, map, 5, off, BOX_BYTES));
  } else throw new Error("Origem inválida.");

  if (emptyBox(srcRaw)) throw new Error("Origem vazia.");

  if (destRef.kind === "box") {
    const off = PC_BOX_DATA + destRef.index * BOX_BYTES;
    const destRaw = readBlock(next, map, 5, off, BOX_BYTES);
    if (!force && !emptyBox(destRaw))
      throw new Error("Slot de caixa ocupado. Use force ou escolha outro.");
    writeBlock(next, map, 5, off, srcRaw);
    return next;
  }

  if (destRef.kind === "party") {
    const countRaw = readBlock(next, map, 1, SB1_PARTY_COUNT, 4);
    let count = Math.min(6, u32(countRaw, 0) || 0);
    let destIndex = destRef.index;
    if (destIndex == null || destIndex >= count) {
      if (count >= 6) throw new Error("Time cheio.");
      destIndex = count;
      putU32(countRaw, 0, count + 1);
      writeBlock(next, map, 1, SB1_PARTY_COUNT, countRaw);
      count += 1;
    }
    const dest = new Uint8Array(PARTY_BYTES);
    dest.set(srcRaw, 0);
    if (dest[0x54] === 0) dest[0x54] = 1;
    writeBlock(next, map, 1, SB1_PARTY + destIndex * PARTY_BYTES, dest);
    return next;
  }

  throw new Error("Destino inválido.");
}

export function moveMon(buf, srcRef, destRef) {
  let next = cloneMon(buf, srcRef, destRef, false);
  next = deleteMon(next, srcRef);
  return next;
}

export function findEmptyBoxSlot(buf) {
  const map = activeMap(buf);
  const pc = readBlock(buf, map, 5, 0, PC_BOX_DATA + BOXES * PER_BOX * BOX_BYTES);
  for (let index = 0; index < BOXES * PER_BOX; index++) {
    const off = PC_BOX_DATA + index * BOX_BYTES;
    const raw = pc.subarray(off, off + BOX_BYTES);
    if (emptyBox(raw)) return index;
  }
  return -1;
}

export function boxLabel(index) {
  const box = Math.floor(index / PER_BOX) + 1;
  const slot = (index % PER_BOX) + 1;
  return `Caixa ${box} · ${slot}`;
}
