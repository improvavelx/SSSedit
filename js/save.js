import { moveInfo, speciesName, statsFromEv, levelFromExp, expForLevel } from "./rules.js";

const SECTOR = 0x1000;
const DATA = 0xff4;
const SIG = 0x08012025;
export const BOX_BYTES = 52;
export const PARTY_BYTES = 76;
const PARTY_COUNT = 0x234;
const PARTY_START = 0x238;
export const BOXES = 21;
export const PER_BOX = 30;

// R.O.W.E. bag (SaveBlock1, sequential from 0x498 — sizes from RoweSource constants)
// ItemSlot = u16 itemId + u16 quantity (qty XOR encryptionKey)
const SB1_MONEY = 0x490;
const SB1_COINS = 0x494;
const SB1_REGISTERED = 0x496;
const SB1_PC_ITEMS = 0x498;
const ENCRYPTION_KEY_OFF = 0xac; // SaveBlock2

// Offsets sequenciais a partir de 0x498 (PC). Contagens: RoweSource global.h
// Bolsos após Bolas usam flags TM/HM + possíveis paddings — ficam para bloco futuro.
export const BAG_POCKETS = [
  { id: "pc", name: "PC", offset: 0x498, count: 50 },
  { id: "items", name: "Itens", offset: 0x560, count: 80 },
  { id: "key", name: "Chave", offset: 0x6a0, count: 50 },
  { id: "balls", name: "Bolas", offset: 0x768, count: 31 },
];

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
  buf[offset + 3] = (value >> 24) & 0xff;
}

export function sectorChecksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum = (sum + u32(data, i)) >>> 0;
  }
  return ((sum & 0xffff) + (sum >>> 16)) & 0xffff;
}

function listSections(buf) {
  const sections = [];
  for (let sector = 0; sector < 32; sector++) {
    const base = sector * SECTOR;
    const sig = u32(buf, base + 0xff8);
    if (sig !== SIG) continue;
    sections.push({
      id: u16(buf, base + 0xff4),
      sector,
      counter: u32(buf, base + 0xffc),
      checksum: u16(buf, base + 0xff6),
    });
  }
  return sections;
}

export function activeCounter(buf) {
  const sections = listSections(buf);
  if (!sections.length) throw new Error("Esse arquivo não é um save de GBA do R.O.W.E.");
  return Math.max(...sections.map((section) => section.counter));
}

function activeMap(buf) {
  const counter = activeCounter(buf);
  const map = new Map();
  for (const section of listSections(buf)) {
    if (section.counter === counter) map.set(section.id, section);
  }
  for (let id = 0; id <= 13; id++) {
    if (!map.has(id)) throw new Error("O save mais novo está incompleto.");
  }
  return map;
}

export function checksumsMatch(buf) {
  const map = activeMap(buf);
  for (const section of map.values()) {
    const data = buf.subarray(section.sector * SECTOR, section.sector * SECTOR + DATA);
    if (sectorChecksum(data) !== section.checksum) return false;
  }
  return true;
}

function refreshChecksum(buf, sector) {
  const base = sector * SECTOR;
  const sum = sectorChecksum(buf.subarray(base, base + DATA));
  putU16(buf, base + 0xff6, sum);
}

function writeBlock(buf, map, firstId, offset, bytes) {
  const touched = new Set();
  for (let i = 0; i < bytes.length; i++) {
    const absolute = offset + i;
    const id = firstId + Math.floor(absolute / DATA);
    const section = map.get(id);
    if (!section) throw new Error("Bloco de save fora do intervalo.");
    const local = absolute % DATA;
    buf[section.sector * SECTOR + local] = bytes[i];
    touched.add(section.sector);
  }
  for (const sector of touched) refreshChecksum(buf, sector);
}

function readBlock(buf, map, firstId, offset, length) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const absolute = offset + i;
    const section = map.get(firstId + Math.floor(absolute / DATA));
    if (!section) throw new Error("Bloco de save fora do intervalo.");
    out[i] = buf[section.sector * SECTOR + (absolute % DATA)];
  }
  return out;
}

function setBits(word, shift, width, value) {
  const mask = ((1 << width) - 1) << shift;
  return (word & ~mask) | ((value & ((1 << width) - 1)) << shift);
}

/**
 * Layout BoxPokemon (R.O.W.E. / RoweRepo include/pokemon.h):
 * 0x00 personality u32 | 0x04 otId u32
 * 0x08 nickname[12]
 * 0x14 move1:10 | exp:21 | exiolite:1
 * 0x18 move2:10 | move3:10 | pokerus:1 | isAlpha:1 | friendship:8 | seasonCaught:2
 * 0x1C species:12 | formId:5 | move4:10 | hpType:5
 * 0x20 EVs x6
 * 0x26 heldItem:10 | nature:5 | isEgg:1 | metLevel:7 | pokeball:5 | style:3 | isShiny:1
 * 0x2A metLocation | 0x2B otName[7]
 * 0x32 markings:4 | abilityNum:2 | otGender:1 | isEventMon:1
 * Party adds PP[4] @0x34, status@0x38, level@0x3C, mail@0x3D, stats @0x3E+
 */
function readBox(raw) {
  const w1 = u32(raw, 0x14);
  const w2 = u32(raw, 0x18);
  const w3 = u32(raw, 0x1c);
  const w4 = u32(raw, 0x26);
  const speciesId = w3 & 0xfff;
  const exp = (w1 >>> 10) & 0x1fffff;
  const itemId = w4 & 0x3ff;
  return {
    nickname: decodeText(raw.subarray(8, 20)),
    ot: decodeText(raw.subarray(0x2b, 0x32)),
    speciesId,
    species: speciesName(speciesId),
    form: (w3 >>> 12) & 31,
    exp,
    level: levelFromExp(speciesId, exp),
    itemId,
    nature: (w4 >>> 10) & 31,
    isEgg: ((w4 >>> 15) & 1) === 1,
    metLevel: (w4 >>> 16) & 0x7f,
    pokeball: (w4 >>> 23) & 0x1f,
    // friendship: bits 22-29 of word at 0x18 (after pokerus+isAlpha)
    friendship: (w2 >>> 22) & 0xff,
    pokerus: ((w2 >>> 20) & 1) === 1,
    isAlpha: ((w2 >>> 21) & 1) === 1,
    seasonCaught: (w2 >>> 30) & 3,
    style: (w4 >>> 28) & 7,
    moves: [w1 & 0x3ff, w2 & 0x3ff, (w2 >>> 10) & 0x3ff, (w3 >>> 17) & 0x3ff],
    evs: [raw[0x20], raw[0x21], raw[0x22], raw[0x23], raw[0x24], raw[0x25]],
    shiny: ((w4 >>> 31) & 1) === 1,
    metLocation: raw[0x2a],
    // byte 0x32: markings:4 | abilityNum:2 | otGender:1 | isEventMon:1
    markings: raw[0x32] & 0x0f,
    ability: (raw[0x32] >>> 4) & 3,
    otGender: (raw[0x32] >>> 6) & 1,
    isEventMon: ((raw[0x32] >>> 7) & 1) === 1,
    personality: u32(raw, 0),
    otId: u32(raw, 4),
    // IVs não existem neste BoxPokemon compacto do R.O.W.E. (sempre 0 no cálculo)
    ivs: [0, 0, 0, 0, 0, 0],
  };
}

function emptyBox(raw) {
  if (raw.every((byte) => byte === 0)) return true;
  const speciesId = u32(raw, 0x1c) & 0xfff;
  // Slot vazio se species == 0 (não depende de item/nickname)
  return speciesId === 0;
}

function readEncryptionKey(buf, map) {
  const keyBytes = readBlock(buf, map, 0, ENCRYPTION_KEY_OFF, 4);
  return u32(keyBytes, 0);
}

function decryptQty(encrypted, key) {
  return (encrypted ^ (key & 0xffff)) & 0xffff;
}

function encryptQty(qty, key) {
  return (qty ^ (key & 0xffff)) & 0xffff;
}

function readPocket(buf, map, pocket, key) {
  const slots = [];
  const raw = readBlock(buf, map, 1, pocket.offset, pocket.count * 4);
  for (let i = 0; i < pocket.count; i++) {
    const itemId = u16(raw, i * 4);
    const encQty = u16(raw, i * 4 + 2);
    const quantity = decryptQty(encQty, key);
    if (itemId === 0 && quantity === 0) continue;
    slots.push({ slot: i, itemId, quantity, name: null });
  }
  return slots;
}

export function readSave(buf) {
  if (buf.length !== 128 * 1024) throw new Error("O save precisa ter 128 KB, como o do Pizza Boy.");
  const map = activeMap(buf);
  // SaveBlock2 – treinador + encryption key
  const sb2 = readBlock(buf, map, 0, 0, 0xb0);
  const trainerName = decodeText(sb2.subarray(0, 8));
  const gender = sb2[0x08]; // 0=♂ 1=♀
  const tid = u16(sb2, 0x0a);
  const sid = u16(sb2, 0x0c);
  const hours = sb2[0x0e] | (sb2[0x0f] << 8);
  const minutes = sb2[0x10];
  const seconds = sb2[0x11];
  const frames = sb2[0x12];
  const encryptionKey = u32(sb2, ENCRYPTION_KEY_OFF);

  // money / coins (SaveBlock1)
  const moneyRaw = readBlock(buf, map, 1, SB1_MONEY, 8);
  const money = (u32(moneyRaw, 0) ^ encryptionKey) >>> 0;
  const coins = decryptQty(u16(moneyRaw, 4), encryptionKey);
  const registeredItem = u16(moneyRaw, 6);

  const partyCount = readBlock(buf, map, 1, PARTY_COUNT, 1)[0];
  const party = [];
  for (let index = 0; index < Math.min(partyCount, 6); index++) {
    const raw = readBlock(buf, map, 1, PARTY_START + index * PARTY_BYTES, PARTY_BYTES);
    const box = readBox(raw);
    if (box.speciesId === 0) continue;
    const level = raw[0x3c] || box.level;
    const curHp = u16(raw, 0x3e);
    const maxHp = u16(raw, 0x40);
    party.push({
      ref: { kind: "party", index },
      ...box,
      level,
      pp: [raw[0x34], raw[0x35], raw[0x36], raw[0x37]],
      stats: {
        hp: curHp,
        maxHp,
        atk: u16(raw, 0x42),
        def: u16(raw, 0x44),
        spe: u16(raw, 0x46),
        spa: u16(raw, 0x48),
        spd: u16(raw, 0x4a),
      },
    });
  }
  const boxes = [];
  for (let index = 0; index < BOXES * PER_BOX; index++) {
    const raw = readBlock(buf, map, 5, 4 + index * BOX_BYTES, BOX_BYTES);
    if (emptyBox(raw)) continue;
    boxes.push({ ref: { kind: "box", index }, ...readBox(raw), pp: null, stats: null });
  }

  const bag = {};
  for (const pocket of BAG_POCKETS) {
    bag[pocket.id] = readPocket(buf, map, pocket, encryptionKey);
  }

  return {
    trainer: trainerName,
    gender,
    tid,
    sid,
    hours,
    minutes,
    seconds,
    frames,
    money,
    coins,
    registeredItem,
    encryptionKey,
    party,
    boxes,
    bag,
  };
}

/**
 * Escreve um bolso inteiro. slots = [{slot, itemId, quantity}, ...]
 * Quantidade 0 ou itemId 0 = slot vazio (permite excluir itens-chave).
 */
export function writePocket(buf, pocketId, slots) {
  const pocket = BAG_POCKETS.find((p) => p.id === pocketId);
  if (!pocket) throw new Error("Bolso desconhecido: " + pocketId);
  const next = new Uint8Array(buf);
  const map = activeMap(next);
  const key = readEncryptionKey(next, map);
  const raw = new Uint8Array(pocket.count * 4);
  // limpa tudo
  raw.fill(0);
  for (const s of slots) {
    if (s.slot < 0 || s.slot >= pocket.count) continue;
    const itemId = s.itemId | 0;
    const qty = Math.max(0, Math.min(0xffff, s.quantity | 0));
    if (itemId === 0 || qty === 0) {
      putU16(raw, s.slot * 4, 0);
      putU16(raw, s.slot * 4 + 2, 0);
    } else {
      putU16(raw, s.slot * 4, itemId & 0xffff);
      putU16(raw, s.slot * 4 + 2, encryptQty(qty, key));
    }
  }
  writeBlock(next, map, 1, pocket.offset, raw);
  return next;
}

/** Remove item do bolso (qualquer um, inclusive chave). Compacta slots vazios. */
export function deleteBagItem(buf, pocketId, slotIndex) {
  const view = readSave(buf);
  const pocket = BAG_POCKETS.find((p) => p.id === pocketId);
  if (!pocket) throw new Error("Bolso desconhecido");
  const current = view.bag[pocketId] || [];
  const remaining = current.filter((s) => s.slot !== slotIndex);
  // recompacta: preenche a partir do slot 0
  const compacted = remaining.map((s, i) => ({
    slot: i,
    itemId: s.itemId,
    quantity: s.quantity,
  }));
  return writePocket(buf, pocketId, compacted);
}

/** Define quantidade de um slot (0 = exclui). */
export function setBagItemQty(buf, pocketId, slotIndex, quantity) {
  const view = readSave(buf);
  const current = [...(view.bag[pocketId] || [])];
  const idx = current.findIndex((s) => s.slot === slotIndex);
  if (idx < 0) throw new Error("Slot não encontrado");
  if (quantity <= 0) {
    return deleteBagItem(buf, pocketId, slotIndex);
  }
  current[idx] = { ...current[idx], quantity };
  return writePocket(buf, pocketId, current);
}

/** Adiciona item em slot livre do bolso. */
export function addBagItem(buf, pocketId, itemId, quantity) {
  if (!itemId || quantity <= 0) throw new Error("Item/quantidade inválidos");
  const view = readSave(buf);
  const pocket = BAG_POCKETS.find((p) => p.id === pocketId);
  if (!pocket) throw new Error("Bolso desconhecido");
  const current = [...(view.bag[pocketId] || [])];
  // soma se já existe
  const existing = current.find((s) => s.itemId === itemId);
  if (existing) {
    existing.quantity = Math.min(0xffff, existing.quantity + quantity);
    return writePocket(buf, pocketId, current);
  }
  if (current.length >= pocket.count) throw new Error("Bolso cheio");
  const used = new Set(current.map((s) => s.slot));
  let free = -1;
  for (let i = 0; i < pocket.count; i++) {
    if (!used.has(i)) {
      free = i;
      break;
    }
  }
  if (free < 0) throw new Error("Bolso cheio");
  current.push({ slot: free, itemId, quantity });
  return writePocket(buf, pocketId, current);
}

export function writeMoney(buf, money, coins) {
  const next = new Uint8Array(buf);
  const map = activeMap(next);
  const key = readEncryptionKey(next, map);
  const raw = new Uint8Array(8);
  putU32(raw, 0, (money >>> 0) ^ key);
  putU16(raw, 4, encryptQty(coins & 0xffff, key));
  // preserva registered item
  const old = readBlock(next, map, 1, SB1_MONEY, 8);
  putU16(raw, 6, u16(old, 6));
  writeBlock(next, map, 1, SB1_MONEY, raw);
  return next;
}

/**
 * Atualiza dados do treinador em SaveBlock2 (nome, gênero, TID, SID).
 * @param {{ name?: string, gender?: number, tid?: number, sid?: number }} edit
 */
export function writeTrainer(buf, edit) {
  const next = new Uint8Array(buf);
  const map = activeMap(next);
  const sb2 = new Uint8Array(readBlock(next, map, 0, 0, 0xb0));
  if (edit.name != null) {
    sb2.set(encodeText(String(edit.name), 8), 0);
  }
  if (edit.gender != null) sb2[0x08] = edit.gender & 1;
  if (edit.tid != null) putU16(sb2, 0x0a, edit.tid & 0xffff);
  if (edit.sid != null) putU16(sb2, 0x0c, edit.sid & 0xffff);
  writeBlock(next, map, 0, 0, sb2);
  return next;
}

/** Status resumido do save (checksums + contador). */
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
  let w1 = u32(raw, 0x14);
  let w2 = u32(raw, 0x18);
  let w3 = u32(raw, 0x1c);
  let w4 = u32(raw, 0x26);

  // moves (só se array completo)
  if (Array.isArray(edit.moves) && edit.moves.length >= 4) {
    w1 = setBits(w1, 0, 10, edit.moves[0]);
    w2 = setBits(w2, 0, 10, edit.moves[1]);
    w2 = setBits(w2, 10, 10, edit.moves[2]);
    w3 = setBits(w3, 17, 10, edit.moves[3]);
  }

  // species + form
  if (edit.speciesId != null) {
    w3 = setBits(w3, 0, 12, edit.speciesId);
  }
  if (edit.form != null) {
    w3 = setBits(w3, 12, 5, edit.form);
  }

  // exp from level
  if (edit.level != null && edit.speciesId != null) {
    const exp = expForLevel(edit.speciesId, edit.level);
    w1 = setBits(w1, 10, 21, exp);
  } else if (edit.exp != null) {
    w1 = setBits(w1, 10, 21, edit.exp);
  }

  // item (10 bits), nature (5), isEgg (1), metLevel (7), pokeball (5), shiny (bit 31)
  if (edit.itemId != null) {
    w4 = setBits(w4, 0, 10, edit.itemId);
  }
  if (edit.nature != null) {
    w4 = setBits(w4, 10, 5, edit.nature);
  }
  if (edit.isEgg != null) {
    w4 = setBits(w4, 15, 1, edit.isEgg ? 1 : 0);
  }
  if (edit.metLevel != null) {
    w4 = setBits(w4, 16, 7, edit.metLevel);
  }
  if (edit.pokeball != null) {
    w4 = setBits(w4, 23, 5, edit.pokeball);
  }
  if (edit.style != null) {
    w4 = setBits(w4, 28, 3, edit.style);
  }
  if (edit.shiny != null) {
    w4 = setBits(w4, 31, 1, edit.shiny ? 1 : 0);
  }

  // pokerus / isAlpha / friendship / seasonCaught in w2
  if (edit.pokerus != null) {
    w2 = setBits(w2, 20, 1, edit.pokerus ? 1 : 0);
  }
  if (edit.friendship != null) {
    w2 = setBits(w2, 22, 8, edit.friendship);
  }
  if (edit.isAlpha != null) {
    w2 = setBits(w2, 21, 1, edit.isAlpha ? 1 : 0);
  }
  if (edit.seasonCaught != null) {
    w2 = setBits(w2, 30, 2, edit.seasonCaught);
  }

  putU32(raw, 0x14, w1);
  putU32(raw, 0x18, w2);
  putU32(raw, 0x1c, w3);
  putU32(raw, 0x26, w4);

  // EVs
  if (Array.isArray(edit.evs) && edit.evs.length >= 6) {
    for (let i = 0; i < 6; i++) raw[0x20 + i] = edit.evs[i] & 0xff;
  }

  // nickname (12 bytes at 0x08)
  if (edit.nickname != null) {
    const nick = encodeText(edit.nickname, 12);
    raw.set(nick, 8);
  }
  // OT (7 bytes at 0x2b)
  if (edit.ot != null) {
    const ot = encodeText(edit.ot, 7);
    raw.set(ot, 0x2b);
  }
  // metLocation byte 0x2A
  if (edit.metLocation != null) {
    raw[0x2a] = edit.metLocation & 0xff;
  }
  // byte 0x32: markings:4 | abilityNum:2 | otGender:1 | isEventMon:1
  let flags32 = raw[0x32];
  if (edit.markings != null) {
    flags32 = (flags32 & 0xf0) | (edit.markings & 0x0f);
  }
  if (edit.ability != null) {
    flags32 = (flags32 & 0xcf) | ((edit.ability & 3) << 4);
  }
  if (edit.otGender != null) {
    flags32 = (flags32 & 0xbf) | ((edit.otGender & 1) << 6);
  }
  if (edit.isEventMon != null) {
    flags32 = (flags32 & 0x7f) | ((edit.isEventMon ? 1 : 0) << 7);
  }
  raw[0x32] = flags32;
}

export function writeMon(buf, ref, edit) {
  const next = new Uint8Array(buf);
  const map = activeMap(next);
  if (ref.kind === "box") {
    const offset = 4 + ref.index * BOX_BYTES;
    const raw = readBlock(next, map, 5, offset, BOX_BYTES);
    patchBox(raw, edit);
    writeBlock(next, map, 5, offset, raw);
    return next;
  }
  const offset = PARTY_START + ref.index * PARTY_BYTES;
  const raw = readBlock(next, map, 1, offset, PARTY_BYTES);
  const previous = readBox(raw);
  const oldMax = u16(raw, 0x40);
  const oldHp = u16(raw, 0x3e);
  const speciesId = edit.speciesId != null ? edit.speciesId : previous.speciesId;
  const level = edit.level != null ? edit.level : (raw[0x3c] || previous.level);
  const fullEdit = {
    ...edit,
    speciesId,
    level,
    form: edit.form != null ? edit.form : previous.form,
    shiny: edit.shiny != null ? edit.shiny : previous.shiny,
    ability: edit.ability != null ? edit.ability : previous.ability,
    nickname: edit.nickname != null ? edit.nickname : previous.nickname,
    ot: edit.ot != null ? edit.ot : previous.ot,
    itemId: edit.itemId != null ? edit.itemId : previous.itemId,
    nature: edit.nature != null ? edit.nature : previous.nature,
    moves: edit.moves || previous.moves,
    evs: edit.evs || previous.evs,
    friendship: edit.friendship != null ? edit.friendship : previous.friendship,
    isEgg: edit.isEgg != null ? edit.isEgg : previous.isEgg,
    metLevel: edit.metLevel != null ? edit.metLevel : previous.metLevel,
    pokeball: edit.pokeball != null ? edit.pokeball : previous.pokeball,
    isAlpha: edit.isAlpha != null ? edit.isAlpha : previous.isAlpha,
    pokerus: edit.pokerus != null ? edit.pokerus : previous.pokerus,
    style: edit.style != null ? edit.style : previous.style,
    metLocation: edit.metLocation != null ? edit.metLocation : previous.metLocation,
    markings: edit.markings != null ? edit.markings : previous.markings,
    otGender: edit.otGender != null ? edit.otGender : previous.otGender,
    isEventMon: edit.isEventMon != null ? edit.isEventMon : previous.isEventMon,
    seasonCaught: edit.seasonCaught != null ? edit.seasonCaught : previous.seasonCaught,
  };
  patchBox(raw, fullEdit);
  // party level @ 0x3C
  raw[0x3c] = level;
  // PP @ 0x34–0x37
  for (let i = 0; i < 4; i++) {
    if (edit.pp && edit.pp[i] != null) {
      raw[0x34 + i] = edit.pp[i] & 0xff;
    } else if (fullEdit.moves[i] !== previous.moves[i]) {
      raw[0x34 + i] = fullEdit.moves[i] === 0 ? 0 : (moveInfo(fullEdit.moves[i])?.pp ?? raw[0x34 + i]);
    }
  }
  const stats = statsFromEv(speciesId, fullEdit.evs, level, fullEdit.nature);
  if (stats) {
    const hp = oldHp === oldMax ? stats.maxHp : Math.min(oldHp, stats.maxHp);
    putU16(raw, 0x3e, hp);
    putU16(raw, 0x40, stats.maxHp);
    putU16(raw, 0x42, stats.atk);
    putU16(raw, 0x44, stats.def);
    putU16(raw, 0x46, stats.spe);
    putU16(raw, 0x48, stats.spa);
    putU16(raw, 0x4a, stats.spd);
  }
  writeBlock(next, map, 1, offset, raw);
  return next;
}

/**
 * Apaga um Pokémon (party ou caixa).
 * Party: zera o slot e compacta o time (recalcula partyCount).
 * Caixa: zera os BOX_BYTES do slot.
 */
export function deleteMon(buf, ref) {
  const next = new Uint8Array(buf);
  const map = activeMap(next);
  if (ref.kind === "box") {
    const offset = 4 + ref.index * BOX_BYTES;
    const raw = new Uint8Array(BOX_BYTES);
    writeBlock(next, map, 5, offset, raw);
    return next;
  }
  if (ref.kind !== "party") throw new Error("Referência inválida para excluir.");
  // Compacta party: lê todos, remove o índice, reescreve e atualiza count
  const partyCount = readBlock(next, map, 1, PARTY_COUNT, 1)[0];
  const mons = [];
  for (let i = 0; i < Math.min(partyCount, 6); i++) {
    if (i === ref.index) continue;
    const raw = readBlock(next, map, 1, PARTY_START + i * PARTY_BYTES, PARTY_BYTES);
    if ((u32(raw, 0x1c) & 0xfff) === 0) continue;
    mons.push(raw);
  }
  // limpa os 6 slots e regrava
  for (let i = 0; i < 6; i++) {
    const empty = new Uint8Array(PARTY_BYTES);
    writeBlock(next, map, 1, PARTY_START + i * PARTY_BYTES, empty);
  }
  for (let i = 0; i < mons.length; i++) {
    writeBlock(next, map, 1, PARTY_START + i * PARTY_BYTES, mons[i]);
  }
  writeBlock(next, map, 1, PARTY_COUNT, new Uint8Array([mons.length]));
  return next;
}

/**
 * Clona um Pokémon para um slot de caixa vazio (ou sobrescreve se force).
 * destRef = { kind: "box", index } | { kind: "party", index }
 * Copia bytes brutos (BoxPokemon 52 + party extras se destino for party).
 */
export function cloneMon(buf, srcRef, destRef, force = false) {
  const next = new Uint8Array(buf);
  const map = activeMap(next);

  // lê origem
  let srcRaw;
  if (srcRef.kind === "party") {
    srcRaw = readBlock(next, map, 1, PARTY_START + srcRef.index * PARTY_BYTES, PARTY_BYTES);
  } else if (srcRef.kind === "box") {
    srcRaw = readBlock(next, map, 5, 4 + srcRef.index * BOX_BYTES, BOX_BYTES);
  } else {
    throw new Error("Origem inválida.");
  }
  if ((u32(srcRaw, 0x1c) & 0xfff) === 0) throw new Error("Origem está vazia.");

  if (destRef.kind === "box") {
    const offset = 4 + destRef.index * BOX_BYTES;
    const destRaw = readBlock(next, map, 5, offset, BOX_BYTES);
    if (!force && !emptyBox(destRaw)) throw new Error("Slot de caixa ocupado. Use force ou escolha outro.");
    // copia só a parte BoxPokemon (52 bytes)
    const boxPart = srcRaw.subarray(0, BOX_BYTES);
    writeBlock(next, map, 5, offset, boxPart);
    return next;
  }

  if (destRef.kind === "party") {
    const partyCount = readBlock(next, map, 1, PARTY_COUNT, 1)[0];
    // se índice >= count, anexa no fim
    let destIndex = destRef.index;
    if (destIndex == null || destIndex < 0) destIndex = partyCount;
    if (destIndex > 5) throw new Error("Party cheia (máx. 6).");
    const offset = PARTY_START + destIndex * PARTY_BYTES;
    if (destIndex < partyCount) {
      const destRaw = readBlock(next, map, 1, offset, PARTY_BYTES);
      if (!force && (u32(destRaw, 0x1c) & 0xfff) !== 0) {
        throw new Error("Slot do time ocupado.");
      }
    }
    // monta party mon: se origem é box, completa com level/stats/pp
    let partyRaw = new Uint8Array(PARTY_BYTES);
    partyRaw.set(srcRaw.subarray(0, Math.min(srcRaw.length, BOX_BYTES)), 0);
    if (srcRef.kind === "party" && srcRaw.length >= PARTY_BYTES) {
      partyRaw = new Uint8Array(srcRaw);
    } else {
      const box = readBox(partyRaw);
      const level = box.level || 1;
      partyRaw[0x3c] = level;
      const stats = statsFromEv(box.speciesId, box.evs, level, box.nature);
      if (stats) {
        putU16(partyRaw, 0x3e, stats.maxHp);
        putU16(partyRaw, 0x40, stats.maxHp);
        putU16(partyRaw, 0x42, stats.atk);
        putU16(partyRaw, 0x44, stats.def);
        putU16(partyRaw, 0x46, stats.spe);
        putU16(partyRaw, 0x48, stats.spa);
        putU16(partyRaw, 0x4a, stats.spd);
      }
      for (let i = 0; i < 4; i++) {
        const mv = box.moves[i];
        partyRaw[0x34 + i] = mv ? (moveInfo(mv)?.pp ?? 0) : 0;
      }
    }
    writeBlock(next, map, 1, offset, partyRaw);
    const newCount = Math.max(partyCount, destIndex + 1);
    writeBlock(next, map, 1, PARTY_COUNT, new Uint8Array([Math.min(6, newCount)]));
    return next;
  }

  throw new Error("Destino inválido.");
}

/**
 * Move Pokémon de src → dest (party↔box ou box→box).
 * Copia e depois apaga a origem (evita duplicar).
 */
export function moveMon(buf, srcRef, destRef) {
  if (
    srcRef.kind === destRef.kind &&
    srcRef.index === destRef.index
  ) {
    throw new Error("Origem e destino são o mesmo slot.");
  }
  let next = cloneMon(buf, srcRef, destRef, false);
  // após clone, índices de party podem ter mudado se anexou no fim;
  // a origem ainda aponta para o slot original no buffer clonado.
  next = deleteMon(next, srcRef);
  return next;
}

/** Primeiro slot de caixa vazio (0..BOXES*PER_BOX-1) ou -1. */
export function findEmptyBoxSlot(buf) {
  const map = activeMap(buf);
  for (let index = 0; index < BOXES * PER_BOX; index++) {
    const raw = readBlock(buf, map, 5, 4 + index * BOX_BYTES, BOX_BYTES);
    if (emptyBox(raw)) return index;
  }
  return -1;
}

export function boxLabel(index) {
  const box = Math.floor(index / PER_BOX) + 1;
  const slot = (index % PER_BOX) + 1;
  return `Caixa ${box} · ${slot}`;
}
