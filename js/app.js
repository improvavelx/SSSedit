import {
  NATURES,
  EV_LABELS,
  MAX_EV_STAT,
  MAX_EV_TOTAL,
  editErrors,
  itemName,
  moveName,
  speciesName,
  statsFromEv,
  POKEBALLS,
  ballName,
  STYLES,
  styleName,
  setCatalog,
  getItemRows,
  getMoveRows,
  getSpeciesRows,
  abilitySlotLabel,
  locationName,
  locationOptions,
  clampEvAt,
  maxEvForStat,
  spriteUrl,
  itemSpriteUrl,
} from "./rules.js";
import { ZONES, getZone, detectZone, defaultZone, zoneFeatures } from "./zones/registry.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function getTheme() {
  try {
    return localStorage.getItem("pokhsave-theme") || "dark";
  } catch (_) {
    return "dark";
  }
}
function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("pokhsave-theme", t);
  } catch (_) {}
  const btn = $("#btnTheme");
  if (btn) btn.textContent = t === "light" ? "☀️" : "🌙";
}
applyTheme(getTheme());

/** Zona ativa (perfil de ROM). Uma zona por família de save. */
let zone = defaultZone();
setCatalog(zone.id);

function api() {
  return zone.api;
}

/** Features da zona ativa (o que a ROM realmente grava). */
function F() {
  return zoneFeatures(zone);
}

let saveBuf = null;
let view = null;
let selected = null;
let dirty = false;
let tab = "party";
let bagPocket = "items"; // pocket ativo na aba Mochila
let boxFilter = -1; // -1 = todas as caixas; 0..N-1 = caixa específica
let listSearch = ""; // busca na lista de party/caixas

let edit = emptyEdit();

function emptyEdit() {
  return {
    nickname: "",
    ot: "",
    speciesId: 25,
    form: 0,
    level: 1,
    itemId: 0,
    nature: 0,
    moves: [0, 0, 0, 0],
    evs: [0, 0, 0, 0, 0, 0],
    shiny: false,
    ability: 0,
    pp: [0, 0, 0, 0],
    friendship: 0,
    isEgg: false,
    metLevel: 1,
    pokeball: 4,
    isAlpha: false,
    pokerus: false,
    style: 0,
    metLocation: 0,
    markings: 0,
    otGender: 0,
    isEventMon: false,
    seasonCaught: 0,
    ivs: [0, 0, 0, 0, 0, 0],
    monGender: 0,
  };
}

function setError(msg) {
  const el = $("#error");
  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.classList.remove("hidden");
}

function getSelectedMon() {
  if (!view || !selected) return null;
  if (selected.kind === "party") return view.party[selected.index] || null;
  if (selected.kind === "box") return view.boxes[selected.index] || null;
  return null;
}

async function loadFile(file) {
  setError(null);
  try {
    const ab = await file.arrayBuffer();
    const buf = new Uint8Array(ab);
    const hinted = detectZone(buf);
    if (hinted && hinted.id !== zone.id) {
      console.info("detectZone:", hinted.id, "zona ativa:", zone.id);
    }
    const next = api().readSave(buf);
    saveBuf = buf;
    view = next;
    dirty = false;
    selected = next.party[0] ? { kind: "party", index: 0 } : null;
    tab = "party";
    if (selected) loadEditFromMon(getSelectedMon());
    render();
  } catch (e) {
    saveBuf = null;
    view = null;
    selected = null;
    setError(e.message || "Não foi possível ler o save.");
    render();
  }
}

function applyEdit() {
  if (!saveBuf || !selected) return;
  const errs = editErrors(edit);
  if (errs.length) {
    setError(errs.join(" "));
    return;
  }
  try {
    const payload = {
      nickname: edit.nickname,
      ot: edit.ot,
      speciesId: edit.speciesId,
      form: edit.form,
      level: edit.level,
      itemId: edit.itemId,
      nature: edit.nature,
      moves: [...edit.moves],
      evs: [...edit.evs],
      shiny: edit.shiny,
      ability: edit.ability,
      pp: [...edit.pp],
      friendship: edit.friendship,
      isEgg: edit.isEgg,
      metLevel: edit.metLevel,
      pokeball: edit.pokeball,
      isAlpha: edit.isAlpha,
      pokerus: edit.pokerus,
      style: edit.style,
      metLocation: edit.metLocation,
      markings: edit.markings,
      otGender: edit.otGender,
      isEventMon: edit.isEventMon,
      seasonCaught: edit.seasonCaught,
      ivs: Array.isArray(edit.ivs) ? [...edit.ivs] : [0, 0, 0, 0, 0, 0],
      monGender: edit.monGender,
    };
    // Só envia mecânicas que a zona grava
    const feat = F();
    const allowed = payload;
    if (!feat.ivs) delete allowed.ivs;
    if (!feat.form) delete allowed.form;
    if (!feat.isAlpha) delete allowed.isAlpha;
    if (!feat.style) delete allowed.style;
    if (!feat.seasonCaught) delete allowed.seasonCaught;
    if (!feat.isEventMon) delete allowed.isEventMon;
    if (!feat.friendship) delete allowed.friendship;
    if (!feat.isEgg) delete allowed.isEgg;
    if (!feat.metLevel) delete allowed.metLevel;
    if (!feat.pokeball) delete allowed.pokeball;
    if (!feat.pokerus) delete allowed.pokerus;
    if (!feat.markings) delete allowed.markings;
    if (!feat.otGender) delete allowed.otGender;
    if (!feat.metLocation) delete allowed.metLocation;
    if (!feat.shiny) delete allowed.shiny;
    if (!feat.nature) delete allowed.nature;
    if (!feat.ability) delete allowed.ability;
    if (!feat.monGender) delete allowed.monGender;
    const nextBuf = api().writeMon(saveBuf, selected, allowed);
    saveBuf = nextBuf;
    view = api().readSave(nextBuf);
    dirty = true;
    setError(null);
    render();
  } catch (e) {
    setError(e.message || "Falha ao gravar o Pokémon.");
  }
}

function download() {
  if (!saveBuf) return;
  const blob = new Blob([saveBuf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${zone.id}.edited.sav`;
  a.click();
  URL.revokeObjectURL(url);
}

function loadEditFromMon(mon) {
  if (!mon) return;
  edit = {
    nickname: mon.nickname || "",
    ot: mon.ot || "",
    speciesId: mon.speciesId,
    form: mon.form || 0,
    level: mon.level || 1,
    itemId: mon.itemId || 0,
    nature: mon.nature || 0,
    moves: [...(mon.moves || [0, 0, 0, 0])],
    evs: [...(mon.evs || [0, 0, 0, 0, 0, 0])],
    shiny: !!mon.shiny,
    ability: mon.ability || 0,
    pp: mon.pp ? [...mon.pp] : [0, 0, 0, 0],
    friendship: mon.friendship != null ? mon.friendship : 0,
    isEgg: !!mon.isEgg,
    metLevel: mon.metLevel != null ? mon.metLevel : 1,
    pokeball: mon.pokeball != null ? mon.pokeball : 4,
    isAlpha: !!mon.isAlpha,
    pokerus: !!mon.pokerus,
    style: mon.style != null ? mon.style : 0,
    metLocation: mon.metLocation != null ? mon.metLocation : 0,
    markings: mon.markings != null ? mon.markings : 0,
    otGender: mon.otGender != null ? mon.otGender : 0,
    isEventMon: !!mon.isEventMon,
    seasonCaught: mon.seasonCaught != null ? mon.seasonCaught : 0,
    ivs: Array.isArray(mon.ivs) && mon.ivs.length >= 6
      ? mon.ivs.map((v) => Math.max(0, Math.min(31, v | 0)))
      : [0, 0, 0, 0, 0, 0],
    monGender: mon.monGender == null ? 0 : mon.monGender,
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHeader() {
  const sub = $("#headerSub");
  const dl = $("#btnDownload");
  const title = document.querySelector("header h1");
  if (title) title.textContent = "Poké Save";
  if (view && saveBuf) {
    const sex = view.gender === 1 ? "♀" : view.gender === 0 ? "♂" : "";
    const tidSid =
      view.tid != null ? ` · TID ${view.tid}/${view.sid ?? "?"}` : "";
    const moneyStr =
      view.money != null ? ` · $${Number(view.money).toLocaleString("pt-BR")}` : "";
    let statusHtml = "";
    try {
      const st = typeof api().saveStatus === "function" ? api().saveStatus(saveBuf) : null;
      if (st) {
        const cls = st.ok ? "ok" : "bad";
        const label = st.ok ? "checksum OK" : "checksum ?";
        statusHtml = `<span class="status-pill ${cls}" title="Setores ativos: ${st.sectors} · contador ${st.counter}">${label}</span>`;
      }
    } catch (_) {}
    if (dirty) statusHtml += `<span class="status-pill dirty">não baixado</span>`;
    sub.innerHTML = `${escapeHtml(zone.short)} · ${escapeHtml(view.trainer || "?")}${sex} · ${view.hours || 0}h ${view.minutes || 0}m${tidSid}${moneyStr} ${statusHtml}`;
    dl.classList.remove("hidden");
    dl.textContent = dirty ? "Baixar ★" : "Baixar";
  } else {
    sub.textContent = `Zona: ${zone.name} · Salve GBA`;
    dl.classList.add("hidden");
  }
}

function renderList() {
  const list = $("#list");
  list.innerHTML = "";
  if (!view) return;

  if (tab === "bag") {
    renderBagList(list);
    return;
  }
  if (tab === "trainer") {
    list.innerHTML = `<p style="padding:16px;text-align:center;color:var(--muted);font-size:13px">Edite os dados do treinador ao lado.</p>`;
    return;
  }

  // Toolbar: busca + (caixas) seletor
  const toolbar = document.createElement("div");
  toolbar.className = "box-toolbar";
  const boxesCount = api().BOXES || 14;
  const perBox = api().PER_BOX || 30;

  if (tab === "boxes") {
    const sel = document.createElement("select");
    sel.id = "boxSelect";
    const optAll = document.createElement("option");
    optAll.value = "-1";
    optAll.textContent = `Todas (${view.boxes.length})`;
    sel.appendChild(optAll);
    for (let b = 0; b < boxesCount; b++) {
      const count = view.boxes.filter((m) => {
        const idx = m.ref?.index ?? 0;
        return Math.floor(idx / perBox) === b;
      }).length;
      const o = document.createElement("option");
      o.value = String(b);
      o.textContent = `Caixa ${b + 1} (${count})`;
      if (boxFilter === b) o.selected = true;
      sel.appendChild(o);
    }
    if (boxFilter === -1) sel.value = "-1";
    sel.onchange = () => {
      boxFilter = Number(sel.value);
      selected = null;
      render();
    };
    toolbar.appendChild(sel);
  }

  const search = document.createElement("input");
  search.type = "search";
  search.id = "listSearch";
  search.placeholder = tab === "boxes" ? "Buscar na caixa..." : "Buscar no time...";
  search.value = listSearch;
  search.oninput = () => {
    listSearch = search.value;
    // re-render list body only would be ideal; full render is fine
    renderListBody(list, toolbar);
  };
  toolbar.appendChild(search);
  list.appendChild(toolbar);
  renderListBody(list, toolbar);
}

function monMatchesSearch(mon, q) {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const nick = (mon.nickname || "").toLowerCase();
  const sp = (mon.species || speciesName(mon.speciesId) || "").toLowerCase();
  const id = String(mon.speciesId || "");
  return nick.includes(s) || sp.includes(s) || id.includes(s);
}

function renderListBody(list, toolbar) {
  // remove previous rows (keep toolbar)
  [...list.querySelectorAll(".mon-row, .list-empty")].forEach((n) => n.remove());

  let items = tab === "party" ? [...view.party] : [...view.boxes];
  const perBox = api().PER_BOX || 30;

  if (tab === "boxes" && boxFilter >= 0) {
    items = items.filter((m) => Math.floor((m.ref?.index ?? 0) / perBox) === boxFilter);
  }
  items = items.filter((m) => monMatchesSearch(m, listSearch));

  if (!items.length) {
    const p = document.createElement("p");
    p.className = "list-empty";
    p.style.cssText = "padding:24px 16px;text-align:center;color:var(--muted);font-size:14px";
    p.textContent = tab === "boxes" ? "Nenhum Pokémon nesta caixa/filtro." : "Nenhum Pokémon aqui.";
    list.appendChild(p);
    return;
  }

  for (const mon of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mon-row";
    const ref = mon.ref || {};
    if (selected && selected.kind === ref.kind && selected.index === ref.index) {
      btn.classList.add("active");
    }
    const label = ref.kind === "box" ? api().boxLabel(ref.index) + " · " : "";
    const sp = spriteUrl(mon.speciesId, !!mon.shiny);
    btn.innerHTML = `
      ${sp
        ? `<img class="mon-sprite" src="${sp}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\'badge ${mon.shiny ? "shiny" : ""}\'>${mon.speciesId}</div>'" />`
        : `<div class="badge ${mon.shiny ? "shiny" : ""}">${mon.speciesId}</div>`}
      <div style="min-width:0;flex:1">
        <div class="name">${escapeHtml(mon.nickname || mon.species || speciesName(mon.speciesId))}${mon.shiny ? " ★" : ""}</div>
        <div class="meta">${label}Lv.${mon.level} · ${escapeHtml(mon.species || speciesName(mon.speciesId) || "#" + mon.speciesId)}${mon.itemId ? ` · <span class="held-inline">${itemSpriteUrl(mon.itemId) ? `<img src="${itemSpriteUrl(mon.itemId)}" alt="" onerror="this.remove()" />` : ""}${escapeHtml(itemName(mon.itemId))}</span>` : ""}</div>
      </div>
    `;
    btn.onclick = () => {
      selected = { ...ref };
      loadEditFromMon(mon);
      render();
    };
    list.appendChild(btn);
  }
}

function renderPicker(container, rows, selectedId, onPick) {
  container.innerHTML = rows
    .map(
      (r) =>
        `<button type="button" class="${r.id === selectedId ? "selected" : ""}" data-id="${r.id}">${escapeHtml(r.n)}</button>`
    )
    .join("");
  container.querySelectorAll("button").forEach((b) => {
    b.onclick = () => onPick(Number(b.dataset.id));
  });
}

function filterRows(rows, q, extraZero) {
  const list = extraZero ? [{ id: 0, n: extraZero }, ...rows] : [...rows];
  const query = (q || "").trim().toLowerCase();
  if (!query) return list.slice(0, 50);
  return list
    .filter((r) => r.n.toLowerCase().includes(query) || String(r.id) === query)
    .slice(0, 50);
}

function renderBagList(list) {
  // seletor de bolso
  const nav = document.createElement("div");
  nav.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid var(--border)";
  for (const p of api().BAG_POCKETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn" + (bagPocket === p.id ? " btn-primary" : "");
    b.style.cssText = "padding:6px 10px;font-size:12px";
    const count = (view.bag[p.id] || []).length;
    b.textContent = `${p.name} (${count})`;
    b.onclick = () => {
      bagPocket = p.id;
      selected = null;
      render();
    };
    nav.appendChild(b);
  }
  list.appendChild(nav);

  const items = view.bag[bagPocket] || [];
  if (!items.length) {
    const empty = document.createElement("p");
    empty.style.cssText = "padding:24px 16px;text-align:center;color:var(--muted);font-size:14px";
    empty.textContent = "Bolso vazio.";
    list.appendChild(empty);
    return;
  }
  for (const slot of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mon-row";
    if (selected && selected.kind === "bag" && selected.pocket === bagPocket && selected.slot === slot.slot) {
      btn.classList.add("active");
    }
    const name = itemName(slot.itemId);
    const isp = itemSpriteUrl(slot.itemId);
    btn.innerHTML = `
      ${isp
        ? `<img class="item-sprite" src="${isp}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\'badge\'>${slot.itemId}</div>'" />`
        : `<div class="badge">${slot.itemId}</div>`}
      <div style="min-width:0;flex:1">
        <div class="name">${escapeHtml(name)}</div>
        <div class="meta">×${slot.quantity} · slot ${slot.slot}</div>
      </div>
    `;
    btn.onclick = () => {
      selected = { kind: "bag", pocket: bagPocket, slot: slot.slot, itemId: slot.itemId, quantity: slot.quantity };
      render();
    };
    list.appendChild(btn);
  }
}

function renderBagEditor() {
  const ed = $("#editor");
  const pocketInfo = api().BAG_POCKETS.find((p) => p.id === bagPocket);
  const isKey = bagPocket === "key";

  // painel dinheiro sempre no topo da aba bag
  let moneyPanel = `
    <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div>
        <label>Dinheiro</label>
        <input type="number" id="moneyIn" min="0" max="999999" value="${view.money ?? 0}" />
      </div>
      <div>
        <label>Moedas</label>
        <input type="number" id="coinsIn" min="0" max="9999" value="${view.coins ?? 0}" />
      </div>
    </div>
    <button type="button" class="btn btn-block" id="btnMoney" style="margin-bottom:20px">Aplicar dinheiro/moedas</button>
  `;

  if (!selected || selected.kind !== "bag") {
    ed.innerHTML = moneyPanel + `
      <p style="padding:16px 0;text-align:center;color:var(--muted);font-size:14px">
        Selecione um item do bolso <strong>${escapeHtml(pocketInfo?.name || bagPocket)}</strong>.
        ${isKey ? "<br><span style='color:var(--danger)'>Itens-chave podem ser excluídos.</span>" : ""}
      </p>
      <div class="field">
        <label>Adicionar item neste bolso</label>
        <input type="search" id="bagAddSearch" placeholder="Buscar item..." />
        <div class="picker" id="bagAddPicker"></div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input type="number" id="bagAddQty" min="1" max="999" value="1" style="width:80px" />
          <button type="button" class="btn btn-primary" id="btnBagAdd">Adicionar</button>
        </div>
      </div>
    `;
  } else {
    const name = itemName(selected.itemId);
    const isp = itemSpriteUrl(selected.itemId);
    ed.innerHTML = moneyPanel + `
      <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center">
        ${isp ? `<img class="item-sprite lg" src="${isp}" alt="" onerror="this.remove()" />` : `<div class="badge">${selected.itemId}</div>`}
        <div style="min-width:0">
        <div style="font-size:18px;font-weight:600">${escapeHtml(name)}</div>
        <div style="font-size:12px;color:var(--muted)">ID ${selected.itemId} · ${escapeHtml(pocketInfo?.name || "")} · slot ${selected.slot}
          ${isKey ? " · <span style='color:#f59e0b'>Item-chave</span>" : ""}
        </div>
        </div>
      </div>
      <div class="field">
        <label>Quantidade (0 = excluir)</label>
        <input type="number" id="bagQtyIn" min="0" max="9999" value="${selected.quantity}" />
      </div>
      <button type="button" class="btn btn-primary btn-block" id="btnBagQty">Aplicar quantidade</button>
      <button type="button" class="btn btn-block" id="btnBagDel" style="margin-top:10px;background:#7f1d1d;color:#fecaca">
        Excluir item${isKey ? " (chave)" : ""}
      </button>
    `;
  }

  $("#btnMoney").onclick = () => {
    try {
      const m = Math.max(0, Math.min(999999, Number($("#moneyIn").value) || 0));
      const c = Math.max(0, Math.min(9999, Number($("#coinsIn").value) || 0));
      saveBuf = api().writeMoney(saveBuf, m, c);
      view = api().readSave(saveBuf);
      dirty = true;
      setError(null);
      render();
    } catch (e) {
      setError(e.message || "Falha ao gravar dinheiro.");
    }
  };

  const qtyBtn = $("#btnBagQty");
  if (qtyBtn) {
    qtyBtn.onclick = () => {
      try {
        const q = Math.max(0, Math.min(9999, Number($("#bagQtyIn").value) || 0));
        saveBuf = api().setBagItemQty(saveBuf, selected.pocket, selected.slot, q);
        view = api().readSave(saveBuf);
        dirty = true;
        selected = null;
        setError(null);
        render();
      } catch (e) {
        setError(e.message || "Falha ao alterar quantidade.");
      }
    };
  }
  const delBtn = $("#btnBagDel");
  if (delBtn) {
    delBtn.onclick = () => {
      try {
        saveBuf = api().deleteBagItem(saveBuf, selected.pocket, selected.slot);
        view = api().readSave(saveBuf);
        dirty = true;
        selected = null;
        setError(null);
        render();
      } catch (e) {
        setError(e.message || "Falha ao excluir item.");
      }
    };
  }

  const addSearch = $("#bagAddSearch");
  const addPicker = $("#bagAddPicker");
  if (addSearch && addPicker) {
    let pendingId = 0;
    const fill = (q) => {
      renderPicker(addPicker, filterRows(getItemRows(), q, null), pendingId, (id) => {
        pendingId = id;
        renderPicker(addPicker, filterRows(getItemRows(), addSearch.value, null), pendingId, arguments.callee);
      });
    };
    // fix picker callback
    const fillAdd = (q) => {
      const rows = filterRows(getItemRows(), q);
      addPicker.innerHTML = rows
        .map((r) => `<button type="button" class="${r.id === pendingId ? "selected" : ""}" data-id="${r.id}">${escapeHtml(r.n)}</button>`)
        .join("");
      addPicker.querySelectorAll("button").forEach((b) => {
        b.onclick = () => {
          pendingId = Number(b.dataset.id);
          fillAdd(addSearch.value);
        };
      });
    };
    fillAdd("");
    addSearch.oninput = () => fillAdd(addSearch.value);
    $("#btnBagAdd").onclick = () => {
      if (!pendingId) {
        setError("Escolha um item na lista.");
        return;
      }
      try {
        const q = Math.max(1, Math.min(999, Number($("#bagAddQty").value) || 1));
        saveBuf = api().addBagItem(saveBuf, bagPocket, pendingId, q);
        view = api().readSave(saveBuf);
        dirty = true;
        setError(null);
        render();
      } catch (e) {
        setError(e.message || "Falha ao adicionar item.");
      }
    };
  }
}


function renderTrainerEditor() {
  const ed = $("#editor");
  if (!view) {
    ed.innerHTML = `<p style="padding:32px 0;text-align:center;color:var(--muted)">Abra um save.</p>`;
    return;
  }
  const sex = view.gender === 1 ? 1 : 0;
  let statusLine = "";
  try {
    const st = typeof api().saveStatus === "function" ? api().saveStatus(saveBuf) : null;
    if (st) {
      statusLine = st.ok
        ? `<p class="hint">Checksums dos setores ativos: OK · contador ${st.counter} · ${st.sectors} setores</p>`
        : `<p class="hint" style="color:#fca5a5">Checksums: divergência em algum setor (comum em hacks). O jogo pode ainda carregar se só editamos setores corretos.</p>`;
    }
  } catch (_) {}

  ed.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-size:18px;font-weight:600">Treinador</div>
      <div style="font-size:12px;color:var(--muted)">${escapeHtml(zone.name)} · dados em SaveBlock2 + dinheiro</div>
    </div>
    ${statusLine}
    <div class="trainer-grid">
      <div class="field full">
        <label>Nome (máx. 7–8)</label>
        <input type="text" id="trName" maxlength="8" value="${escapeHtml(view.trainer || "")}" />
      </div>
      <div class="field">
        <label>Gênero</label>
        <select id="trGender">
          <option value="0" ${sex === 0 ? "selected" : ""}>♂ Masculino</option>
          <option value="1" ${sex === 1 ? "selected" : ""}>♀ Feminino</option>
        </select>
      </div>
      <div class="field">
        <label>Tempo de jogo</label>
        <input type="text" disabled value="${view.hours || 0}h ${view.minutes || 0}m" />
      </div>
      <div class="field">
        <label>TID</label>
        <input type="number" id="trTid" min="0" max="65535" value="${view.tid ?? 0}" />
      </div>
      <div class="field">
        <label>SID</label>
        <input type="number" id="trSid" min="0" max="65535" value="${view.sid ?? 0}" />
      </div>
      <div class="field">
        <label>Dinheiro</label>
        <input type="number" id="trMoney" min="0" max="999999" value="${view.money ?? 0}" />
      </div>
      <div class="field">
        <label>Fichas (coins)</label>
        <input type="number" id="trCoins" min="0" max="9999" value="${view.coins ?? 0}" />
      </div>
    </div>
    <button type="button" class="btn btn-primary btn-block" id="btnTrainerApply" style="margin-top:16px">Aplicar treinador</button>
    <p class="hint">TID/SID afetam shiny de mons novos. Alterar o nome do treinador não muda o OT dos Pokémon já capturados.</p>
  `;

  $("#btnTrainerApply").onclick = () => {
    try {
      setError(null);
      const name = ($("#trName").value || "").trim();
      const gender = Number($("#trGender").value) || 0;
      const tid = Math.max(0, Math.min(65535, Number($("#trTid").value) || 0));
      const sid = Math.max(0, Math.min(65535, Number($("#trSid").value) || 0));
      const money = Math.max(0, Math.min(999999, Number($("#trMoney").value) || 0));
      const coins = Math.max(0, Math.min(9999, Number($("#trCoins").value) || 0));
      if (typeof api().writeTrainer !== "function") {
        throw new Error("Esta zona ainda não implementa writeTrainer.");
      }
      saveBuf = api().writeTrainer(saveBuf, { name, gender, tid, sid });
      saveBuf = api().writeMoney(saveBuf, money, coins);
      view = api().readSave(saveBuf);
      dirty = true;
      render();
    } catch (err) {
      setError(err.message || String(err));
    }
  };
}

function renderEditor() {
  if (tab === "bag") {
    renderBagEditor();
    return;
  }
  if (tab === "trainer") {
    renderTrainerEditor();
    return;
  }
  const mon = getSelectedMon();
  const ed = $("#editor");
  if (!mon) {
    ed.innerHTML = `<p style="padding:32px 0;text-align:center;color:var(--muted);font-size:14px">Selecione um Pokémon.</p>`;
    return;
  }

  const preview =
    statsFromEv(
      edit.speciesId,
      edit.evs,
      edit.level,
      edit.nature,
      F().ivs ? edit.ivs : [0, 0, 0, 0, 0, 0]
    ) || mon.stats;
  const feat = F();
  const totalEv = edit.evs.reduce((a, b) => a + b, 0);
  const isParty = selected && selected.kind === "party";

    const editorSprite = spriteUrl(edit.speciesId, !!edit.shiny);
  ed.innerHTML = `
    <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center">
      ${editorSprite ? `<img class="mon-sprite lg" src="${editorSprite}" alt="" onerror="this.remove()" />` : ""}
      <div style="min-width:0">
      <div style="font-size:18px;font-weight:600">
        ${escapeHtml(edit.nickname || speciesName(edit.speciesId))}
        <span style="font-size:14px;font-weight:400;color:var(--muted)">Lv.${edit.level}</span>
        ${edit.shiny ? '<span style="color:#fbbf24"> ★</span>' : ""}
      </div>
      <div style="font-size:12px;color:var(--muted)">
        ${escapeHtml(speciesName(edit.speciesId))} · OT ${escapeHtml(edit.ot || "—")}
        · ${abilitySlotLabel(edit.ability, feat.abilityMax)}
      </div>
      </div>
    </div>

    <div class="field">
      <label>Apelido</label>
      <input type="text" id="nickIn" maxlength="10" value="${escapeHtml(edit.nickname)}" />
    </div>

    <div class="field">
      <label>OT (treinador original)</label>
      <input type="text" id="otIn" maxlength="7" value="${escapeHtml(edit.ot)}" />
    </div>

    <div class="field">
      <label>Espécie · atual: ${escapeHtml(speciesName(edit.speciesId))}</label>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input type="number" id="speciesIdIn" min="1" max="65535" value="${edit.speciesId}" style="width:110px;padding:8px" title="ID interno" />
        <span style="font-size:12px;color:var(--muted)">ID (hacks Gen 9: digite o número)</span>
      </div>
      <input type="search" id="speciesSearch" placeholder="Buscar no catálogo..." />
      <div class="picker" id="speciesPicker"></div>
    </div>

    <div class="field" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div>
        <label>Nível</label>
        <input type="number" id="levelIn" min="1" max="100" value="${edit.level}" />
      </div>
      ${feat.form ? `<div>
        <label>Forma (0–31 · R.O.W.E.)</label>
        <input type="number" id="formIn" min="0" max="31" value="${edit.form}" />
        <p class="hint">Campo de forma no mon.</p>
      </div>` : `<p class="hint">Formas regionais/Mega nesta zona = espécies separadas (ex.: “Raichu (Alola)” no seletor).</p>`}
      ${feat.ability ? `<div>
        <label>Ability</label>
        <select id="abilityIn">
          ${[...Array(feat.abilityMax + 1).keys()].map((a) => `<option value="${a}" ${edit.ability === a ? "selected" : ""}>${a} · ${abilitySlotLabel(a, feat.abilityMax)}</option>`).join("")}
        </select>
      </div>` : `<div></div>`}
    </div>
    <p class="hint" style="margin-top:-8px;margin-bottom:12px">${escapeHtml(zone.short)} · ${escapeHtml(feat.monFormat || "")}</p>

    <div class="field" style="display:flex;flex-wrap:wrap;gap:8px 16px">
      ${feat.shiny ? `<label><input type="checkbox" id="shinyIn" ${edit.shiny ? "checked" : ""} style="width:auto;margin-right:8px" />Shiny</label>` : ""}
      ${feat.isEgg ? `<label><input type="checkbox" id="isEggIn" ${edit.isEgg ? "checked" : ""} style="width:auto;margin-right:8px" />Ovo</label>` : ""}
      ${feat.isAlpha ? `<label><input type="checkbox" id="isAlphaIn" ${edit.isAlpha ? "checked" : ""} style="width:auto;margin-right:8px" />Alpha</label>` : ""}
      ${feat.pokerus ? `<label><input type="checkbox" id="pokerusIn" ${edit.pokerus ? "checked" : ""} style="width:auto;margin-right:8px" />Pokerus</label>` : ""}
      ${feat.isEventMon ? `<label><input type="checkbox" id="isEventIn" ${edit.isEventMon ? "checked" : ""} style="width:auto;margin-right:8px" />Event</label>` : ""}
    </div>

    <div class="field" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div>
        <label>Friendship</label>
        <input type="number" id="friendshipIn" min="0" max="255" value="${edit.friendship}" />
      </div>
      <div>
        <label>Met Level</label>
        <input type="number" id="metLevelIn" min="0" max="100" value="${edit.metLevel}" />
      </div>
      <div>
        <label>Poké Ball</label>
        <select id="pokeballIn">
          ${POKEBALLS.map(
            (b) =>
              `<option value="${b.id}" ${b.id === edit.pokeball ? "selected" : ""}>${escapeHtml(b.n)}</option>`
          ).join("")}
        </select>
      </div>
    </div>

    <div class="field" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      ${feat.style ? `<div>
        <label>Style</label>
        <select id="styleIn">
          ${STYLES.map((s) => `<option value="${s.id}" ${s.id === edit.style ? "selected" : ""}>${escapeHtml(s.n)}</option>`).join("")}
        </select>
      </div>` : ""}
      ${feat.otGender ? `<div>
        <label>OT Gender (cor do nome OT)</label>
        <select id="otGenderIn">
          <option value="0" ${edit.otGender === 0 ? "selected" : ""}>♂</option>
          <option value="1" ${edit.otGender === 1 ? "selected" : ""}>♀</option>
        </select>
      </div>` : ""}
      ${feat.monGender ? `<div>
        <label>Sexo do Pokémon</label>
        <select id="monGenderIn">
          <option value="0" ${edit.monGender === 0 ? "selected" : ""}>♂ Macho</option>
          <option value="1" ${edit.monGender === 1 ? "selected" : ""}>♀ Fêmea</option>
        </select>
      </div>` : ""}
      ${feat.metLocation ? `<div>
        <label>Met Location · ${escapeHtml(locationName(edit.metLocation))}</label>
        <input type="number" id="metLocIn" min="0" max="255" value="${edit.metLocation}" style="margin-bottom:6px" />
        <select id="metLocSelect">
          ${locationOptions().map((o) => `<option value="${o.id}" ${o.id === (edit.metLocation|0) ? "selected" : ""}>${escapeHtml(o.n)}</option>`).join("")}
          ${locationOptions().some((o) => o.id === (edit.metLocation|0)) ? "" : `<option value="${edit.metLocation}" selected>#${edit.metLocation} (custom)</option>`}
        </select>
      </div>` : ""}
    </div>

    <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${feat.markings ? `<div>
        <label>Markings (0–15)</label>
        <input type="number" id="markingsIn" min="0" max="15" value="${edit.markings}" />
      </div>` : ""}
      ${feat.seasonCaught ? `<div>
        <label>Season Caught</label>
        <input type="number" id="seasonIn" min="0" max="3" value="${edit.seasonCaught}" />
      </div>` : ""}
    </div>

    <div class="field">
      <label>Natureza</label>
      <select id="natureSel">
        ${NATURES.map((n, i) => `<option value="${i}" ${i === edit.nature ? "selected" : ""}>${n}</option>`).join("")}
      </select>
    </div>

    <div class="field">
      <label class="item-field-head">
        ${edit.itemId && itemSpriteUrl(edit.itemId) ? `<img class="item-sprite" src="${itemSpriteUrl(edit.itemId)}" alt="" onerror="this.remove()" style="width:32px;height:32px" />` : ""}
        <span>Item · ${escapeHtml(itemName(edit.itemId))}</span>
      </label>
      <input type="search" id="itemSearch" placeholder="Buscar item..." />
      <div class="picker" id="itemPicker"></div>
    </div>

    <div class="field">
      <label>Golpes</label>
      ${[0, 1, 2, 3]
        .map(
          (slot) => `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">
            Golpe ${slot + 1}: ${escapeHtml(moveName(edit.moves[slot]))}
            ${isParty ? ` · PP <input type="number" min="0" max="64" data-pp="${slot}" value="${edit.pp[slot] || 0}" style="width:52px;display:inline-block;padding:4px;font-size:12px" />` : ""}
          </div>
          <input type="search" data-move-slot="${slot}" class="move-search" placeholder="Buscar golpe..." />
          <div class="picker move-picker" data-move-slot="${slot}"></div>
        </div>
      `
        )
        .join("")}
    </div>

    <div class="field">
      <label>EVs (${totalEv}/${MAX_EV_TOTAL})</label>
      ${EV_LABELS.map((label, i) => {
        const maxI = maxEvForStat(edit.evs, i);
        const val = Math.min(edit.evs[i] | 0, maxI);
        return `
        <div class="ev-row">
          <span>${label}</span>
          <input type="range" min="0" max="${Math.max(maxI, val)}" step="1" value="${val}" data-ev="${i}" />
          <input type="number" min="0" max="${Math.max(maxI, val)}" value="${val}" data-ev-num="${i}" />
        </div>`;
      }).join("")}
      <p class="ev-budget ${totalEv >= MAX_EV_TOTAL ? "full" : ""} ${totalEv > MAX_EV_TOTAL ? "over" : ""}">
        Restante: ${Math.max(0, MAX_EV_TOTAL - totalEv)} · máx. por stat ${MAX_EV_STAT}${totalEv >= MAX_EV_TOTAL ? " · limite total atingido" : ""}
      </p>
    </div>

    ${feat.ivs ? `
    <div class="field">
      <label>IVs (0–31 · gravados no save)</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${["HP", "Atk", "Def", "Spe", "SpA", "SpD"].map((label, i) => `
          <div style="display:flex;flex-direction:column;gap:4px">
            <span style="font-size:11px;color:var(--muted)">${label}</span>
            <input type="number" min="0" max="31" data-iv="${i}" value="${edit.ivs[i] ?? 0}" style="padding:8px" />
          </div>`).join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button type="button" class="btn" id="btnIv31" style="font-size:12px;padding:6px 10px">Tudo 31</button>
        <button type="button" class="btn" id="btnIv0" style="font-size:12px;padding:6px 10px">Tudo 0</button>
      </div>
    </div>` : `<p class="hint">Esta zona não grava IVs no mon (ex.: R.O.W.E. usa 0 no cálculo).</p>`}

    ${preview ? `
    <div class="field">
      <label>Stats (preview${feat.ivs ? " · com IVs" : " · IVs 0"})</label>
      <div class="stats">
        <div class="stat"><div class="n">HP</div><div class="v">${preview.maxHp ?? preview.hp ?? "—"}</div></div>
        <div class="stat"><div class="n">Atk</div><div class="v">${preview.atk ?? "—"}</div></div>
        <div class="stat"><div class="n">Def</div><div class="v">${preview.def ?? "—"}</div></div>
        <div class="stat"><div class="n">Spe</div><div class="v">${preview.spe ?? "—"}</div></div>
        <div class="stat"><div class="n">SpA</div><div class="v">${preview.spa ?? "—"}</div></div>
        <div class="stat"><div class="n">SpD</div><div class="v">${preview.spd ?? "—"}</div></div>
      </div>
    </div>` : ""}

    <div class="field" style="margin-top:8px">
      <label>Atalhos (batch)</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${feat.ivs ? `<button type="button" class="btn" id="btnBatchIv31" style="font-size:12px;padding:6px 10px">IVs 31</button>
        <button type="button" class="btn" id="btnBatchIv0" style="font-size:12px;padding:6px 10px">IVs 0</button>` : ""}
        <button type="button" class="btn" id="btnBatchEv0" style="font-size:12px;padding:6px 10px">EVs 0</button>
        ${isParty ? `<button type="button" class="btn" id="btnBatchPp" style="font-size:12px;padding:6px 10px">Curar PP</button>` : ""}
        ${feat.shiny ? `<button type="button" class="btn" id="btnBatchShiny" style="font-size:12px;padding:6px 10px">${edit.shiny ? "Remover shiny" : "Fazer shiny"}</button>` : ""}
      </div>
      <p class="hint">Atalhos só preenchem o formulário — use <strong>Aplicar no save</strong> para gravar.</p>
    </div>

    <button type="button" class="btn btn-primary btn-block" id="btnApply">Aplicar no save</button>
    <div class="import-export">
      <button type="button" class="btn" id="btnExportMon" style="font-size:12px;padding:6px 10px">Exportar JSON</button>
      <button type="button" class="btn" id="btnImportMon" style="font-size:12px;padding:6px 10px">Importar JSON</button>
      <input type="file" id="importMonFile" accept="application/json,.json" class="hidden" />
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
      <button type="button" class="btn btn-block" id="btnClone">Clonar → caixa</button>
      <button type="button" class="btn btn-block" id="btnMove">Mover ↔</button>
      <button type="button" class="btn btn-block" id="btnDelete" style="background:#7f1d1d;color:#fecaca;grid-column:1/-1">Excluir</button>
    </div>
  `;

  $("#nickIn").oninput = (e) => { edit.nickname = e.target.value; };
  $("#otIn").oninput = (e) => { edit.ot = e.target.value; };
  $("#levelIn").onchange = (e) => {
    edit.level = Math.max(1, Math.min(100, Number(e.target.value) || 1));
    renderEditor();
  };
  const formIn = $("#formIn");
  if (formIn) formIn.onchange = (e) => {
    edit.form = Math.max(0, Math.min(31, Number(e.target.value) || 0));
  };
  const abilityIn = $("#abilityIn");
  if (abilityIn) abilityIn.onchange = (e) => { edit.ability = Number(e.target.value); };
  const shinyIn = $("#shinyIn"); if (shinyIn) shinyIn.onchange = (e) => { edit.shiny = e.target.checked; renderEditor(); };
  const isEggIn = $("#isEggIn"); if (isEggIn) isEggIn.onchange = (e) => { edit.isEgg = e.target.checked; };
  $("#friendshipIn").onchange = (e) => {
    edit.friendship = Math.max(0, Math.min(255, Number(e.target.value) || 0));
  };
  $$("[data-iv]").forEach((inp) => {
    inp.onchange = () => {
      const i = Number(inp.dataset.iv);
      if (!Array.isArray(edit.ivs)) edit.ivs = [0, 0, 0, 0, 0, 0];
      edit.ivs[i] = Math.max(0, Math.min(31, Number(inp.value) || 0));
      renderEditor();
    };
  });
  const btnIv31 = $("#btnIv31");
  if (btnIv31) {
    btnIv31.onclick = () => {
      edit.ivs = [31, 31, 31, 31, 31, 31];
      renderEditor();
    };
  }
  const btnIv0 = $("#btnIv0");
  if (btnIv0) {
    btnIv0.onclick = () => {
      edit.ivs = [0, 0, 0, 0, 0, 0];
      renderEditor();
    };
  }
  $("#metLevelIn").onchange = (e) => {
    edit.metLevel = Math.max(0, Math.min(100, Number(e.target.value) || 0));
  };
  $("#pokeballIn").onchange = (e) => {
    edit.pokeball = Number(e.target.value);
  };
  const isAlphaIn = $("#isAlphaIn"); if (isAlphaIn) isAlphaIn.onchange = (e) => { edit.isAlpha = e.target.checked; };
  const pokerusIn = $("#pokerusIn"); if (pokerusIn) pokerusIn.onchange = (e) => { edit.pokerus = e.target.checked; };
  const isEventIn = $("#isEventIn"); if (isEventIn) isEventIn.onchange = (e) => { edit.isEventMon = e.target.checked; };
  const styleIn = $("#styleIn"); if (styleIn) styleIn.onchange = (e) => { edit.style = Number(e.target.value); };
  const otGenderIn = $("#otGenderIn"); if (otGenderIn) otGenderIn.onchange = (e) => { edit.otGender = Number(e.target.value); };
  const monGenderIn = $("#monGenderIn"); if (monGenderIn) monGenderIn.onchange = (e) => { edit.monGender = Number(e.target.value); };
  const metLocIn = $("#metLocIn"); if (metLocIn) metLocIn.onchange = (e) => {
    edit.metLocation = Math.max(0, Math.min(255, Number(e.target.value) || 0));
    const sel = $("#metLocSelect");
    if (sel) sel.value = String(edit.metLocation);
    renderEditor();
  };
  const metLocSelect = $("#metLocSelect");
  if (metLocSelect) metLocSelect.onchange = (e) => {
    edit.metLocation = Math.max(0, Math.min(255, Number(e.target.value) || 0));
    const inp = $("#metLocIn");
    if (inp) inp.value = String(edit.metLocation);
    renderEditor();
  };

  const bindBatch = (id, fn) => {
    const el = $(id);
    if (el) el.onclick = () => { fn(); renderEditor(); };
  };
  bindBatch("#btnBatchIv31", () => { edit.ivs = [31, 31, 31, 31, 31, 31]; });
  bindBatch("#btnBatchIv0", () => { edit.ivs = [0, 0, 0, 0, 0, 0]; });
  bindBatch("#btnBatchEv0", () => { edit.evs = [0, 0, 0, 0, 0, 0]; });
  bindBatch("#btnBatchPp", () => { edit.pp = [64, 64, 64, 64]; });
  bindBatch("#btnBatchShiny", () => { edit.shiny = !edit.shiny; });
  const markingsIn = $("#markingsIn"); if (markingsIn) markingsIn.onchange = (e) => {
    edit.markings = Math.max(0, Math.min(15, Number(e.target.value) || 0));
  };
  const seasonIn = $("#seasonIn"); if (seasonIn) seasonIn.onchange = (e) => {
    edit.seasonCaught = Math.max(0, Math.min(3, Number(e.target.value) || 0));
  };
  $("#natureSel").onchange = (e) => { edit.nature = Number(e.target.value); renderEditor(); };

  const speciesIdIn = $("#speciesIdIn");
  if (speciesIdIn) {
    speciesIdIn.onchange = () => {
      edit.speciesId = Math.max(1, Math.min(0xffff, Number(speciesIdIn.value) || 1));
      renderEditor();
    };
  }

  const spSearch = $("#speciesSearch");
  const spPicker = $("#speciesPicker");
  const fillSpecies = (q) => {
    renderPicker(spPicker, filterRows(getSpeciesRows(), q), edit.speciesId, (id) => {
      edit.speciesId = id;
      renderEditor();
    });
  };
  fillSpecies("");
  spSearch.oninput = () => fillSpecies(spSearch.value);

  const itemSearch = $("#itemSearch");
  const itemPicker = $("#itemPicker");
  const fillItems = (q) => {
    renderPicker(itemPicker, filterRows(getItemRows(), q, "Nenhum"), edit.itemId, (id) => {
      edit.itemId = id;
      renderEditor();
    });
  };
  fillItems("");
  itemSearch.oninput = () => fillItems(itemSearch.value);

  $$(".move-search").forEach((input) => {
    const slot = Number(input.dataset.moveSlot);
    const picker = ed.querySelector(`.move-picker[data-move-slot="${slot}"]`);
    const fillMoves = (q) => {
      renderPicker(picker, filterRows(getMoveRows(), q, "—"), edit.moves[slot], (id) => {
        edit.moves[slot] = id;
        renderEditor();
      });
    };
    fillMoves("");
    input.oninput = () => fillMoves(input.value);
  });
  $$("[data-pp]").forEach((inp) => {
    inp.onchange = () => {
      const slot = Number(inp.dataset.pp);
      edit.pp[slot] = Math.max(0, Math.min(64, Number(inp.value) || 0));
    };
  });

  $$("[data-ev]").forEach((range) => {
    range.oninput = () => {
      const i = Number(range.dataset.ev);
      edit.evs = clampEvAt(edit.evs, i, Number(range.value));
      renderEditor();
    };
  });
  $$("[data-ev-num]").forEach((num) => {
    const apply = () => {
      const i = Number(num.dataset.evNum);
      edit.evs = clampEvAt(edit.evs, i, Number(num.value) || 0);
    };
    num.oninput = apply;
    num.onchange = () => { apply(); renderEditor(); };
  });

  $("#btnApply").onclick = applyEdit;

  const btnExport = $("#btnExportMon");
  if (btnExport) {
    btnExport.onclick = () => {
      const payload = {
        format: "pokhw-mon-v1",
        zone: zone.id,
        mon: {
          speciesId: edit.speciesId,
          nickname: edit.nickname,
          ot: edit.ot,
          level: edit.level,
          itemId: edit.itemId,
          ability: edit.ability,
          nature: edit.nature,
          shiny: edit.shiny,
          friendship: edit.friendship,
          isEgg: edit.isEgg,
          metLevel: edit.metLevel,
          pokeball: edit.pokeball,
          metLocation: edit.metLocation,
          markings: edit.markings,
          otGender: edit.otGender,
          isEventMon: edit.isEventMon,
          isAlpha: edit.isAlpha,
          seasonCaught: edit.seasonCaught,
          style: edit.style,
          pokerus: edit.pokerus,
          moves: [...edit.moves],
          pp: [...(edit.pp || [0, 0, 0, 0])],
          evs: [...edit.evs],
          ivs: [...(edit.ivs || [0, 0, 0, 0, 0, 0])],
        },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(edit.nickname || speciesName(edit.speciesId) || "mon").replace(/[^\w\-]+/g, "_")}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
  }
  const btnImport = $("#btnImportMon");
  const importFile = $("#importMonFile");
  if (btnImport && importFile) {
    btnImport.onclick = () => importFile.click();
    importFile.onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        const mon = data.mon || data;
        if (!mon || typeof mon !== "object") throw new Error("JSON inválido.");
        if (mon.speciesId != null) edit.speciesId = mon.speciesId | 0;
        if (mon.nickname != null) edit.nickname = String(mon.nickname);
        if (mon.ot != null) edit.ot = String(mon.ot);
        if (mon.level != null) edit.level = Math.max(1, Math.min(100, mon.level | 0));
        if (mon.itemId != null) edit.itemId = mon.itemId | 0;
        if (mon.ability != null) edit.ability = mon.ability | 0;
        if (mon.nature != null) edit.nature = mon.nature | 0;
        if (mon.shiny != null) edit.shiny = !!mon.shiny;
        if (mon.friendship != null) edit.friendship = mon.friendship | 0;
        if (mon.isEgg != null) edit.isEgg = !!mon.isEgg;
        if (mon.metLevel != null) edit.metLevel = mon.metLevel | 0;
        if (mon.pokeball != null) edit.pokeball = mon.pokeball | 0;
        if (mon.metLocation != null) edit.metLocation = mon.metLocation | 0;
        if (mon.markings != null) edit.markings = mon.markings | 0;
        if (mon.otGender != null) edit.otGender = mon.otGender | 0;
        if (mon.isEventMon != null) edit.isEventMon = !!mon.isEventMon;
        if (mon.isAlpha != null) edit.isAlpha = !!mon.isAlpha;
        if (mon.seasonCaught != null) edit.seasonCaught = mon.seasonCaught | 0;
        if (mon.style != null) edit.style = mon.style | 0;
        if (mon.pokerus != null) edit.pokerus = !!mon.pokerus;
        if (Array.isArray(mon.moves)) edit.moves = mon.moves.map((x) => x | 0).slice(0, 4).concat([0,0,0,0]).slice(0,4);
        if (Array.isArray(mon.pp)) edit.pp = mon.pp.map((x) => x | 0).slice(0, 4).concat([0,0,0,0]).slice(0,4);
        if (Array.isArray(mon.evs)) {
          let evs = mon.evs.map((x) => x | 0).slice(0, 6);
          while (evs.length < 6) evs.push(0);
          // clamp total
          for (let i = 0; i < 6; i++) evs = clampEvAt(evs, i, evs[i]);
          edit.evs = evs;
        }
        if (Array.isArray(mon.ivs)) edit.ivs = mon.ivs.map((x) => Math.max(0, Math.min(31, x | 0))).slice(0, 6).concat([0,0,0,0,0,0]).slice(0,6);
        setError(null);
        renderEditor();
      } catch (err) {
        setError("Importar JSON: " + (err.message || String(err)));
      }
    };
  }

  $("#btnClone").onclick = () => {
    if (!saveBuf || !selected || selected.kind === "bag") return;
    try {
      const empty = api().findEmptyBoxSlot(saveBuf);
      if (empty < 0) {
        setError("Nenhum slot de caixa vazio.");
        return;
      }
      saveBuf = api().cloneMon(saveBuf, selected, { kind: "box", index: empty }, false);
      view = api().readSave(saveBuf);
      dirty = true;
      setError(null);
      selected = { kind: "box", index: empty };
      tab = "boxes";
      const mon = getSelectedMon();
      if (mon) loadEditFromMon(mon);
      render();
    } catch (e) {
      setError(e.message || "Falha ao clonar.");
    }
  };

  $("#btnMove").onclick = () => {
    if (!saveBuf || !selected || selected.kind === "bag") return;
    try {
      if (selected.kind === "party") {
        const empty = api().findEmptyBoxSlot(saveBuf);
        if (empty < 0) {
          setError("Nenhum slot de caixa vazio para mover.");
          return;
        }
        saveBuf = api().moveMon(saveBuf, selected, { kind: "box", index: empty });
        view = api().readSave(saveBuf);
        dirty = true;
        selected = { kind: "box", index: empty };
        tab = "boxes";
      } else if (selected.kind === "box") {
        if (view.party.length >= 6) {
          setError("Time cheio (6/6). Libere um slot antes de mover.");
          return;
        }
        const destIndex = view.party.length; // anexa no fim
        saveBuf = api().moveMon(saveBuf, selected, { kind: "party", index: destIndex });
        view = api().readSave(saveBuf);
        dirty = true;
        selected = { kind: "party", index: Math.min(destIndex, view.party.length - 1) };
        tab = "party";
      } else {
        return;
      }
      setError(null);
      const mon = getSelectedMon();
      if (mon) loadEditFromMon(mon);
      render();
    } catch (e) {
      setError(e.message || "Falha ao mover.");
    }
  };

  $("#btnDelete").onclick = () => {
    if (!saveBuf || !selected || selected.kind === "bag") return;
    if (!confirm("Excluir este Pokémon do save? Não dá para desfazer.")) return;
    try {
      saveBuf = api().deleteMon(saveBuf, selected);
      view = api().readSave(saveBuf);
      dirty = true;
      selected = null;
      setError(null);
      render();
    } catch (e) {
      setError(e.message || "Falha ao excluir.");
    }
  };
}

function render() {
  renderHeader();
  const hasSave = !!view;
  $("#empty").classList.toggle("hidden", hasSave);
  $("#main").classList.toggle("hidden", !hasSave);
  if (!hasSave) return;
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  renderList();
  renderEditor();
}

function fillZoneSelect() {
  const sel = $("#zoneSelect");
  const desc = $("#zoneDesc");
  if (!sel) return;
  sel.innerHTML = "";
  for (const z of ZONES) {
    const opt = document.createElement("option");
    opt.value = z.id;
    opt.textContent = z.name;
    if (z.id === zone.id) opt.selected = true;
    sel.appendChild(opt);
  }
  if (desc) desc.textContent = zone.description || "";
  sel.onchange = () => {
    const next = getZone(sel.value);
    if (!next) return;
    if (view && dirty) {
      if (!confirm("Trocar de zona descarta o save aberto (não salvo). Continuar?")) {
        sel.value = zone.id;
        return;
      }
    }
    zone = next;
    setCatalog(zone.id);
    saveBuf = null;
    view = null;
    selected = null;
    dirty = false;
    if (desc) desc.textContent = zone.description || "";
    setError(null);
    render();
  };
}

$("#btnOpen").onclick = () => $("#fileInput").click();
$("#btnOpen2").onclick = () => $("#fileInput").click();
$("#btnDownload").onclick = download;
$("#fileInput").onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) loadFile(f);
  e.target.value = "";
};
$$(".tabs button").forEach((b) => {
  b.onclick = () => {
    const next = b.dataset.tab;
    if (next !== tab) {
      selected = null;
      tab = next;
      listSearch = "";
      if (next !== "boxes") boxFilter = -1;
    }
    $$(".tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
    render();
  };
});

const btnTheme = $("#btnTheme");
if (btnTheme) {
  btnTheme.onclick = () => applyTheme(getTheme() === "light" ? "dark" : "light");
}
applyTheme(getTheme());
fillZoneSelect();
$$(".tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
render();
