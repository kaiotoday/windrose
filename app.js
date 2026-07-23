/* ============================================================================
   Windrose — App-Logik (UI, Filter, Detail, Formular, Auth, Anhänge)
   Klassisches Script, teilt sich window.SO mit data.js und map.js.
   ========================================================================== */
(function (SO) {
  "use strict";

  var store = SO.store;
  var esc = SO.esc;
  var safeUrl = SO.safeUrl;

  // ---------- Nominatim (OSM) — Endpunkt, Rate-Limit, Cache ----------
  // OSM-Nutzungsregeln: max. 1 Anfrage/Sekunde, keine Autocomplete-Flut.
  // Ein gemeinsamer Rate-Limiter gilt für Suche UND Reverse-Geocoding.
  var NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
  var NOMINATIM_MIN_INTERVAL = 1200; // ms zwischen ZWEI beliebigen Anfragen
  var lastNominatimAt = 0;
  var geoCache = {}; // query -> results (In-Memory-Cache)

  // Führt fn nur aus, wenn seit der letzten Nominatim-Anfrage genug Zeit verging.
  // Sonst: Aufruf verwerfen (mit optionaler Meldung) statt zu queuen/spammen.
  function nominatimGate() {
    var now = Date.now();
    if (now - lastNominatimAt < NOMINATIM_MIN_INTERVAL) return false;
    lastNominatimAt = now;
    return true;
  }

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  var el = {};
  function cacheDom() {
    [
      "auth", "auth-form", "auth-step-email", "auth-step-code", "auth-email", "auth-send",
      "auth-sent-text", "auth-code-toggle", "auth-code-fallback",
      "auth-code", "auth-verify", "auth-back", "auth-msg",
      "connError", "connRetry", "connErrorTitle", "connErrorText",
      "app", "demoBadge", "userEmail", "btnLogout",
      "search", "sort", "archivToggle", "btnAddDesktop", "btnListMode", "filterMenu", "filterCount",
      "filterSummary", "activeFilterCount", "countrySummary", "countryOptions", "catSummary", "statusSummary", "filterClear",
      "suggestionCount", "suggestionTabCount",
      "catFilters", "statusFilters", "deadlineStrip", "deadlineTags", "rows",
      "map", "legend", "pickBanner", "pickDone",
      "scrim", "detail", "detailKicker", "detailBody",
      "form", "formTitle", "entryForm",
      "formConflict", "f-conflict-reload", "f-conflict-overwrite",
      "f-id", "f-name", "f-cat", "f-status", "f-geosearch", "f-geosearchBtn", "f-geosuggest", "f-pickmap",
      "f-paste", "f-pastehint", "f-lat", "f-lng", "f-city", "f-country",
      "f-dates", "f-event-start", "f-event-end", "f-deadline", "f-deadlinetext",
      "f-link", "f-contact", "f-cost", "f-note", "f-save",
      "toasts"
    ].forEach(function (id) { el[id] = $(id); });
    el.tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    el.catInputs = Array.prototype.slice.call(el.catFilters.querySelectorAll("input[data-cat]"));
    el.statusInputs = Array.prototype.slice.call(el.statusFilters.querySelectorAll("input[data-status]"));
    el.segBtns = Array.prototype.slice.call(el.archivToggle.querySelectorAll(".seg-btn"));
  }

  // ---------- Zustand ----------
  var state = {
    view: "map",
    pool: "aktiv",
    cats: new Set(SO.CATEGORIES),
    countries: new Set(),
    statuses: new Set(["offen", "beworben", "wartet", "zugesagt", "abgesagt", "verpasst"]),
    search: "",
    sort: "deadline",
    selectedId: null,
    detailId: null,
    editingId: null,
    openSheet: null,
    returnFocus: null,
    pickActive: false
  };
  var FILTER_STATUSES = ["offen", "beworben", "wartet", "zugesagt", "abgesagt", "verpasst"];
  var mapInited = false;
  var detailAtts = {}; // id -> attachment (für Löschen)

  // ============================================================================
  //  Toast
  // ============================================================================
  SO.toast = function (msg, type) {
    var t = document.createElement("div");
    t.className = "toast" + (type ? " is-" + type : "");
    t.textContent = msg;
    el.toasts.appendChild(t);
    setTimeout(function () {
      t.style.transition = "opacity .3s ease";
      t.style.opacity = "0";
      setTimeout(function () { t.remove(); }, 320);
    }, 3200);
  };

  // ============================================================================
  //  Sheets
  // ============================================================================
  function transitionEndOnce(node, cb) {
    var done = false;
    function fire() {
      if (done) return;
      done = true;
      node.removeEventListener("transitionend", handler);
      cb();
    }
    function handler(e) {
      if (e.target !== node) return;
      fire();
    }
    node.addEventListener("transitionend", handler);
    // Fallback, falls kein transitionend feuert
    setTimeout(fire, 400);
  }

  function openSheet(name) {
    var node = name === "form" ? el.form : el.detail;
    var other = name === "form" ? el.detail : el.form;
    if (!state.openSheet) state.returnFocus = document.activeElement;
    if (other.classList.contains("is-open")) {
      other.classList.remove("is-open");
      transitionEndOnce(other, function () { if (!other.classList.contains("is-open")) other.hidden = true; });
    }
    node.hidden = false;
    el.scrim.hidden = false;
    el.scrim.dataset.sheet = name;
    var modal = name === "form" || window.innerWidth < 880;
    el.app.classList.toggle("has-detail", name === "detail");
    node.setAttribute("aria-modal", modal ? "true" : "false");
    if (modal) el.app.inert = true;
    else el.app.inert = false;
    function focusCloseButton() {
      if (state.openSheet !== name || node.hidden) return;
      var closeButton = node.querySelector(".sheet-close");
      if (!closeButton) return;
      try { closeButton.focus({ preventScroll: true }); }
      catch (_) { closeButton.focus(); }
    }
    requestAnimationFrame(function () {
      el.scrim.classList.add("is-open");
      node.classList.add("is-open");
      focusCloseButton();
      // Chromium kann beim nachträglichen Setzen von `inert` den Fokus erst im
      // nächsten Task auf <body> verschieben. Danach nochmals sicher setzen.
      setTimeout(focusCloseButton, 60);
    });
    state.openSheet = name;
  }

  function closeSheet(name) {
    var node = name === "form" ? el.form : el.detail;
    node.classList.remove("is-open");
    el.scrim.classList.remove("is-open");
    if (state.openSheet === name) state.openSheet = null;
    if (name === "detail") el.app.classList.remove("has-detail");
    transitionEndOnce(node, function () { if (!node.classList.contains("is-open")) node.hidden = true; });
    transitionEndOnce(el.scrim, function () {
      if (!el.scrim.classList.contains("is-open")) {
        el.scrim.hidden = true;
        delete el.scrim.dataset.sheet;
      }
    });
    if (name === "detail") { clearSelection(); }
    if (name === "form") { SO.map.clearPick(); invalidateGeo(); hideFormConflict(); }
    setTimeout(function () {
      if (!state.openSheet) {
        el.app.inert = false;
        if (state.returnFocus && state.returnFocus.isConnected && typeof state.returnFocus.focus === "function") {
          state.returnFocus.focus();
        }
        state.returnFocus = null;
      }
    }, 410);
  }

  // Entwertet laufende Geo-Anfragen (Suche + Reverse-Geocoding), damit eine
  // veraltete Antwort niemals ein NEUERES Formular befüllt. Wird beim Öffnen und
  // Schließen des Formulars aufgerufen. revToken/geoAbort sind weiter unten
  // deklariert (hoisted var), zur Laufzeit hier bereits gesetzt.
  function invalidateGeo() {
    revToken++;
    if (geoAbort) { try { geoAbort.abort(); } catch (e) {} geoAbort = null; }
  }

  function clearSelection() {
    state.selectedId = null;
    state.detailId = null;
    var sel = el.rows.querySelector(".row.is-selected");
    if (sel) sel.classList.remove("is-selected");
    if (mapInited) SO.map.select(null);
  }

  // ============================================================================
  //  Filter + Sortierung
  // ============================================================================
  function countryKey(value) {
    return String(value || "").trim().toLocaleLowerCase("de-CH");
  }

  function passesFilter(e) {
    if (!state.cats.has(SO.normCat(e))) return false;
    if (!state.statuses.has(SO.derivedStatus(e))) return false;
    if (state.countries.size && !state.countries.has(countryKey(e.country))) return false;
    if (state.search) {
      var hay = ((e.name || "") + " " + (e.city || "") + " " + (e.country || "")).toLowerCase();
      if (hay.indexOf(state.search) < 0) return false;
    }
    return true;
  }

  function sortEntries(arr) {
    var by = state.sort;
    return arr.slice().sort(function (a, b) {
      if (by === "name") return (a.name || "").localeCompare(b.name || "", "de");
      if (by === "country") {
        var countryOrder = (a.country || "").localeCompare(b.country || "", "de");
        if (countryOrder) return countryOrder;
        var cityOrder = (a.city || "").localeCompare(b.city || "", "de");
        return cityOrder || (a.name || "").localeCompare(b.name || "", "de");
      }
      if (by === "event") {
        var da = SO.parseDate(a.event_start), db = SO.parseDate(b.event_start);
        if (!da && !db) return (a.name || "").localeCompare(b.name || "", "de");
        if (!da) return 1;
        if (!db) return -1;
        return da - db;
      }
      // deadline (Standard): kommende Fristen aufsteigend zuerst,
      // dann Einträge ohne Frist, ganz am Ende die abgelaufenen.
      var ra = deadlineSortRank(a), rb = deadlineSortRank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 1) return (a.name || "").localeCompare(b.name || "", "de"); // beide ohne Frist
      return SO.parseDate(a.deadline) - SO.parseDate(b.deadline);            // beide kommend bzw. beide abgelaufen
    });
  }

  // 0 = kommende Frist, 1 = keine Frist, 2 = abgelaufen
  function deadlineSortRank(e) {
    if (!e.deadline || !SO.parseDate(e.deadline)) return 1;
    return SO.deadlineState(e) === "passed" ? 2 : 0;
  }

  function listEntries() {
    return sortEntries(store.list().filter(function (e) {
      return entryInPool(e) && passesFilter(e);
    }));
  }
  function entryInPool(e, pool) {
    var target = pool || state.pool;
    if (target === "archiv") return !!e.archived;
    if (target === "vorschlag") return !e.archived && !!e.is_suggestion;
    return !e.archived && !e.is_suggestion;
  }
  function poolEntries(pool) {
    return store.list().filter(function (e) { return entryInPool(e, pool); });
  }
  function mapEntries() {
    // Karte und Liste teilen sich dieselbe Filterquelle für Aktiv, Vorschläge
    // und Archiv.
    return store.list().filter(function (e) {
      return entryInPool(e) && passesFilter(e);
    });
  }

  // ============================================================================
  //  Badges
  // ============================================================================
  function deadlineBadge(e) {
    var ds = SO.deadlineState(e);
    var urgent = SO.showUrgency(e);
    // „abgelaufen"/„diesen Monat" (rot/amber) nur für aktiv verfolgte Einträge.
    if (urgent && ds === "passed") return { cls: "d-passed", text: "abgelaufen" };
    if (urgent && ds === "thismonth") return { cls: "d-thismonth", text: "diesen Monat" };
    // Zugesagt/abgesagt (oder nicht dringlich): Datum neutral anzeigen.
    if (ds !== "none") return { cls: "d-upcoming", text: SO.fmtDate(e.deadline) };
    return { cls: "d-none", text: e.deadline_text ? e.deadline_text : "laufend" };
  }
  function statusBadgeHtml(e) {
    var s = SO.derivedStatus(e);
    return '<span class="status-badge status-' + s + '">' + esc(SO.STATUS_LABEL[s]) + "</span>";
  }

  // ============================================================================
  //  Rendering
  // ============================================================================
  function render() {
    renderPoolCounts();
    renderCountryFilter();
    renderFilterSummary();
    renderList();
    renderDeadlineStrip();
    if (mapInited) {
      SO.map.render(mapEntries());
      if (state.selectedId) SO.map.select(state.selectedId);
    }
  }

  function renderList() {
    var items = listEntries();
    el.filterCount.textContent = items.length + (items.length === 1 ? " Eintrag" : " Einträge");
    if (!items.length) {
      var emptyTitle = state.pool === "archiv" ? "Archiv ist leer" :
        state.pool === "vorschlag" ? "Nichts zu kuratieren" : "Nichts gefunden";
      var emptyText = state.pool === "archiv" ? "Archivierte Einträge tauchen hier auf." :
        state.pool === "vorschlag" ? "Neue Recherchevorschläge erscheinen hier nach dem nächsten Datenimport." :
        "Passe Suche oder Filter an — oder leg einen neuen Eintrag an.";
      el.rows.innerHTML =
        '<div class="empty"><div class="empty-title">' + emptyTitle +
        '</div><div class="empty-sub">' + emptyText + "</div></div>";
      return;
    }
    el.rows.innerHTML = items.map(function (e) {
      var d = deadlineBadge(e);
      var place = [e.city, e.country].filter(Boolean).join(", ");
      // Fällt dates_text weg, aber event_start ist gesetzt: Datum formatiert zeigen.
      var termin = e.dates_text || dateRange(e.event_start, e.event_end);
      var cat = SO.normCat(e);
      return '<div class="row row-' + cat + (e.archived ? " is-archived" : "") +
        (e.is_suggestion ? " is-suggestion" : "") +
        (e.id === state.selectedId ? " is-selected" : "") + '" data-id="' + esc(e.id) + '" tabindex="0" role="button">' +
        '<span class="chip-dot" style="background:' + (SO.CAT_COLOR[cat] || "#999") + '"></span>' +
        '<div class="row-main">' +
        '<p class="row-name">' + esc(e.name) + "</p>" +
        '<div class="row-meta">' +
        (place ? '<span class="m">' + iconPin() + esc(place) + "</span>" : "") +
        (termin ? '<span class="m">' + iconCal() + esc(termin) + "</span>" : "") +
        "</div></div>" +
        '<div class="row-badges">' +
        (e.is_suggestion ? '<span class="suggestion-badge">Vorschlag</span>' : "") +
        statusBadgeHtml(e) +
        '<span class="badge badge-deadline ' + d.cls + '">' + esc(d.text) + "</span>" +
        "</div></div>";
    }).join("");
  }

  function renderPoolCounts() {
    var count = poolEntries("vorschlag").length;
    el.suggestionCount.textContent = count;
    el.suggestionTabCount.textContent = count;
    el.suggestionTabCount.hidden = count === 0;
    var tab = el.suggestionTabCount.closest(".tab");
    if (tab) tab.setAttribute("aria-label", "Zu kuratieren, " + count + (count === 1 ? " Vorschlag" : " Vorschläge"));
  }

  function renderFilterSummary() {
    var catCount = state.cats.size;
    var catText = catCount === SO.CATEGORIES.length ? "Alle Arten" :
      catCount === 0 ? "Keine Art" : catCount + (catCount === 1 ? " Art" : " Arten");
    var statusCount = state.statuses.size;
    var statusText = statusCount === FILTER_STATUSES.length ? "Alle Status" :
      statusCount === 0 ? "Kein Status" : statusCount + " Status";
    var countryText = el.countrySummary.textContent || "Alle Länder";
    var activeGroups = (state.countries.size ? 1 : 0) +
      (catCount !== SO.CATEGORIES.length ? 1 : 0) +
      (statusCount !== FILTER_STATUSES.length ? 1 : 0);

    el.catSummary.textContent = catText;
    el.statusSummary.textContent = statusText;
    el.filterSummary.textContent = activeGroups ? [countryText, catText, statusText].join(" · ") : "Alle Einträge";
    el.activeFilterCount.textContent = activeGroups;
    el.activeFilterCount.hidden = activeGroups === 0;
    el.filterMenu.classList.toggle("has-active-filters", activeGroups > 0);

    el.catInputs.forEach(function (input) { input.checked = state.cats.has(input.dataset.cat); });
    el.statusInputs.forEach(function (input) { input.checked = state.statuses.has(input.dataset.status); });

    var catCounts = { festival: 0, markt: 0, messe: 0, sonstiges: 0 };
    var statusCounts = { offen: 0, beworben: 0, wartet: 0, zugesagt: 0, abgesagt: 0, verpasst: 0 };
    poolEntries().forEach(function (entry) {
      catCounts[SO.normCat(entry)]++;
      statusCounts[SO.derivedStatus(entry)]++;
    });
    el.catFilters.querySelectorAll("[data-cat-count]").forEach(function (node) {
      node.textContent = catCounts[node.dataset.catCount] || 0;
    });
    el.statusFilters.querySelectorAll("[data-status-count]").forEach(function (node) {
      node.textContent = statusCounts[node.dataset.statusCount] || 0;
    });
  }

  function renderCountryFilter() {
    // Null-Prototyp: frei eingegebene Ländernamen wie "__proto__" oder
    // "constructor" dürfen nicht mit Object-Eigenschaften kollidieren.
    var countries = Object.create(null);
    var available = poolEntries();
    available.forEach(function (e) {
      var label = String(e.country || "").trim();
      var key = countryKey(label);
      if (!key) return;
      if (!countries[key]) countries[key] = { label: label, count: 0 };
      countries[key].count++;
    });

    var keys = Object.keys(countries).sort(function (a, b) {
      return countries[a].label.localeCompare(countries[b].label, "de");
    });
    Array.from(state.countries).forEach(function (key) {
      if (keys.indexOf(key) === -1) state.countries.delete(key);
    });

    var fragment = document.createDocumentFragment();
    keys.forEach(function (key) {
      var label = document.createElement("label");
      label.className = "country-option";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = key;
      input.checked = state.countries.has(key);
      input.dataset.country = key;
      var name = document.createElement("span");
      name.textContent = countries[key].label;
      var count = document.createElement("span");
      count.className = "country-option-count";
      count.textContent = countries[key].count;
      label.appendChild(input);
      label.appendChild(name);
      label.appendChild(count);
      fragment.appendChild(label);
    });
    el.countryOptions.replaceChildren(fragment);
    if (!state.countries.size) {
      el.countrySummary.textContent = "Alle Länder";
    } else if (state.countries.size === 1) {
      var selectedKey = Array.from(state.countries)[0];
      el.countrySummary.textContent = countries[selectedKey] ? countries[selectedKey].label : "1 Land";
    } else {
      el.countrySummary.textContent = state.countries.size + " Länder";
    }
  }

  function renderDeadlineStrip() {
    // Der Streifen ist eine Arbeitsliste für bereits übernommene, aktive
    // Einträge. Recherchevorschläge und Archiviertes bleiben bewusst draussen.
    if (state.pool !== "aktiv") { el.deadlineStrip.hidden = true; return; }
    var now = SO.todayStart();
    var upcoming = store.list().filter(function (e) {
      if (e.archived || e.is_suggestion || !e.deadline) return false;
      if (!passesFilter(e)) return false;
      if (!SO.showUrgency(e)) return false; // zugesagt/abgesagt tauchen hier nie auf
      return SO.parseDate(e.deadline) >= now;
    }).sort(function (a, b) { return SO.parseDate(a.deadline) - SO.parseDate(b.deadline); }).slice(0, 3);

    if (!upcoming.length) { el.deadlineStrip.hidden = true; return; }
    el.deadlineStrip.hidden = false;
    // Kompakte VERTIKALE Liste: je eine volle Zeile „Datum · Name". Punkt zeigt
    // Dringlichkeit (amber = diesen Monat, sonst Tinte). Name wird nicht gekürzt.
    el.deadlineTags.innerHTML = upcoming.map(function (e) {
      var ds = SO.deadlineState(e);
      var urg = ds === "thismonth" ? "urgent-amber" : "urgent-normal";
      return '<button class="deadline-row ' + urg + '" data-id="' + esc(e.id) + '">' +
        '<span class="dl-dot" aria-hidden="true"></span>' +
        '<span class="dl-date">' + esc(SO.fmtDate(e.deadline)) + "</span>" +
        '<span class="dl-name">' + esc(e.name) + "</span></button>";
    }).join("");
  }

  function iconPin() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
  }
  function iconCal() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 9h14v10H5V9z"/></svg>';
  }

  // ============================================================================
  //  Detail-Panel
  // ============================================================================
  function openDetail(id) {
    var e = store.getById(id);
    if (!e) return;
    state.detailId = id;
    setSelected(id);
    el.detailKicker.textContent = (e.is_suggestion ? "Zu kuratieren · " : "") + SO.CAT_LABEL[SO.normCat(e)];
    el.detailBody.innerHTML = detailHtml(e);
    openSheet("detail");
    if (!store.isDemo()) loadAttachments(id);
  }

  function detailHtml(e) {
    var place = [e.city, e.country].filter(Boolean).join(", ");
    var d = deadlineBadge(e);
    var gmaps = "https://maps.google.com/?q=" + encodeURIComponent(e.lat + "," + e.lng);
    var amaps = "https://maps.apple.com/?ll=" + encodeURIComponent(e.lat + "," + e.lng) + "&q=" + encodeURIComponent(e.name || "Ort");

    var cat = SO.normCat(e);
    var html = "";
    html += '<h2 class="detail-title">' + esc(e.name) + "</h2>";
    html += '<div class="detail-chips">' +
      '<span class="cat-tag cat-' + cat + '">' + esc(SO.CAT_LABEL[cat]) + "</span>" +
      (e.is_suggestion ? '<span class="suggestion-badge">Vorschlag</span>' : "") +
      statusBadgeHtml(e) +
      '<span class="badge badge-deadline ' + d.cls + '">Frist: ' + esc(d.text) + "</span>" +
      "</div>";

    // Status-Umschalter
    var curStatus = SO.normStatus(e);
    html += '<div class="detail-section"><h3>Status ändern</h3><div class="status-switch">' +
      SO.STATUSES.map(function (s) {
        var on = curStatus === s ? " is-on" : "";
        return '<button data-act="status" data-status="' + s + '" class="status-' + s + on + '">' + esc(SO.STATUS_LABEL[s]) + "</button>";
      }).join("") + "</div></div>";

    // Termin + Frist
    var termin = e.dates_text || dateRange(e.event_start, e.event_end);
    html += '<div class="detail-section"><h3>Termin &amp; Frist</h3><div class="kv">';
    if (termin) html += kv("Termin", esc(termin));
    if (e.deadline) html += kv("Deadline", esc(SO.fmtDate(e.deadline)));
    if (e.deadline_text) html += kv("Frist-Notiz", esc(e.deadline_text));
    if (!termin && !e.deadline && !e.deadline_text) html += '<div class="kv-row"><span class="v">Keine Termine hinterlegt.</span></div>';
    html += "</div></div>";

    // Ort
    html += '<div class="detail-section"><h3>Ort</h3><div class="kv">';
    if (place) html += kv("Adresse", esc(place));
    html += kv("Koordinaten",
      '<span style="font-family:var(--font-mono);font-size:13px">' + esc(Number(e.lat).toFixed(4)) + ", " + esc(Number(e.lng).toFixed(4)) + "</span>" +
      '<button type="button" class="linkbtn" data-act="editpos">Position ändern</button>');
    html += "</div>";
    html += '<div class="map-links" style="margin-top:10px">' +
      '<a class="btn btn-soft btn-sm" href="' + esc(gmaps) + '" target="_blank" rel="noopener">In Google Maps öffnen</a>' +
      '<a class="btn btn-soft btn-sm" href="' + esc(amaps) + '" target="_blank" rel="noopener">In Apple Maps öffnen</a>' +
      "</div></div>";

    // Weitere Infos
    var safeLink = safeUrl(e.link);
    var hasMore = e.link || e.contact || e.cost || e.source;
    if (hasMore) {
      html += '<div class="detail-section"><h3>Infos</h3><div class="kv">';
      if (safeLink) {
        html += kv("Link", '<a href="' + esc(safeLink) + '" target="_blank" rel="noopener">' + esc(shortUrl(safeLink)) + "</a>");
      } else if (e.link) {
        // Unsicherer/ungültiger Link: als reiner Text, ohne anklickbaren href.
        html += kv("Link", esc(e.link));
      }
      if (e.contact) html += kv("Kontakt", esc(e.contact));
      if (e.cost) html += kv("Kosten", esc(e.cost));
      if (e.source) html += kv("Quelle", sourceHtml(e.source));
      html += "</div></div>";
    }

    html += '<div class="detail-section detail-note-editor">' +
      '<div class="detail-section-head"><h3>Notiz</h3><span>direkt bearbeitbar</span></div>' +
      '<textarea id="quickNote" rows="5" placeholder="Eigene Einschätzung, Rückmeldung oder nächste Schritte …">' +
      esc(e.note || "") + "</textarea>" +
      '<div class="note-actions"><button class="btn btn-soft btn-sm" data-act="save-note">Notiz speichern</button></div>' +
      "</div>";

    // Anhänge
    html += '<div class="detail-section"><h3>Anhänge</h3><div id="attachBox">';
    if (store.isDemo()) {
      html += '<div class="attach-hint">Anhänge (PDFs, Bilder) sind nur im geteilten Modus mit Supabase verfügbar.</div>';
    } else {
      html += '<div class="attach-list" id="attachList"><div class="attach-empty">Wird geladen…</div></div>' +
        '<label class="attach-upload"><span class="btn btn-soft btn-sm">Datei hochladen</span>' +
        '<input type="file" id="attachInput" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" hidden></label>';
    }
    html += "</div></div>";

    // Aktionen
    html += '<div class="detail-actions">' +
      (e.is_suggestion && !e.archived ? '<button class="btn btn-primary" data-act="adopt">Übernehmen</button>' : "") +
      '<button class="btn" data-act="edit">Bearbeiten</button>' +
      '<button class="btn btn-soft" data-act="archive">' +
        (e.archived ? "Wiederherstellen" : e.is_suggestion ? "Verwerfen" : "Archivieren") + "</button>" +
      '<button class="btn btn-danger" data-act="delete">Löschen</button>' +
      "</div>";

    return html;
  }

  function kv(k, vHtml) {
    return '<div class="kv-row"><span class="k">' + esc(k) + '</span><span class="v">' + vHtml + "</span></div>";
  }
  function dateRange(a, b) {
    if (!a && !b) return "";
    if (a && b && a !== b) return SO.fmtDate(a) + " – " + SO.fmtDate(b);
    return SO.fmtDate(a || b);
  }
  function shortUrl(u) {
    try { var x = new URL(u); return x.hostname.replace(/^www\./, "") + (x.pathname !== "/" ? x.pathname : ""); }
    catch (e) { return u; }
  }

  function sourceHtml(value) {
    var text = String(value || "").trim();
    var match = text.match(/https?:\/\/[^\s]+/i);
    if (!match) return esc(text);
    var href = safeUrl(match[0]);
    if (!href) return esc(text);
    var start = match.index || 0;
    var end = start + match[0].length;
    return esc(text.slice(0, start)) + '<a href="' + esc(href) +
      '" target="_blank" rel="noopener">' + esc(shortUrl(href)) + "</a>" + esc(text.slice(end));
  }

  function refreshDetailIfOpen() {
    if (state.detailId && el.detail.classList.contains("is-open")) {
      var e = store.getById(state.detailId);
      if (!e) { closeSheet("detail"); return; }
      el.detailBody.innerHTML = detailHtml(e);
      if (!store.isDemo()) loadAttachments(state.detailId);
    }
  }

  // ---------- Anhänge ----------
  var attachReqToken = 0;
  async function loadAttachments(id) {
    var box = $("attachList");
    if (!box) return;
    var myToken = ++attachReqToken; // beim Wechsel des Detaileintrags entwerten
    try {
      var atts = await store.listAttachments(id);
      if (myToken !== attachReqToken) return; // ein neuerer Ladevorgang läuft
      detailAtts = {};
      if (!atts.length) { box.innerHTML = '<div class="attach-empty">Noch keine Anhänge.</div>'; return; }
      box.innerHTML = atts.map(function (a) {
        detailAtts[a.id] = a;
        return '<div class="attach-item"><span class="af-name">' + esc(a.filename || a.path) + "</span>" +
          '<button class="icon-btn" data-act="att-open" data-id="' + esc(a.id) + '" title="Öffnen" style="width:32px;height:32px">' +
          '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M14 3v2h3.6l-9.3 9.3 1.4 1.4L19 6.4V10h2V3h-7zM5 5h5V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-2v5H5V5z"/></svg></button>' +
          '<button class="icon-btn" data-act="att-del" data-id="' + esc(a.id) + '" title="Löschen" style="width:32px;height:32px">' +
          '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 4V2h10v2h5v2H2V4h5zM5 7h14l-1 14H6L5 7zm4 3v8h2v-8H9zm4 0v8h2v-8h-2z"/></svg></button></div>';
      }).join("");
    } catch (e) {
      if (myToken !== attachReqToken) return;
      box.innerHTML = '<div class="attach-empty">' + esc(e.message || "Anhänge konnten nicht geladen werden.") + "</div>";
    }
  }

  // ============================================================================
  //  Formular
  // ============================================================================
  // Befüllt das Formular (Bearbeitungs-Zustand + Felder), OHNE das Sheet zu
  // öffnen. openForm ruft danach openSheet auf; der Schnellpfad „Position ändern"
  // nutzt fillForm allein und geht direkt in den Karten-Pick-Modus.
  function fillForm(entry) {
    // Beim (Neu-)Befüllen laufende Geo-Anfragen entwerten und eine evtl. sichtbare
    // Konflikt-Leiste zurücksetzen.
    invalidateGeo();
    hideFormConflict();
    state.editingId = entry ? entry.id : null;
    // updated_at merken, um beim Speichern gleichzeitige Fremdänderungen zu erkennen.
    state.editUpdatedAt = entry ? (entry.updated_at || null) : null;
    el.formTitle.textContent = entry ? "Eintrag bearbeiten" : "Neuer Eintrag";
    el["f-id"].value = entry ? entry.id : "";
    el["f-name"].value = entry ? (entry.name || "") : "";
    el["f-cat"].value = entry ? SO.normCat(entry) : "festival";
    el["f-status"].value = entry ? SO.normStatus(entry) : "offen";
    el["f-lat"].value = entry && entry.lat != null ? entry.lat : "";
    el["f-lng"].value = entry && entry.lng != null ? entry.lng : "";
    el["f-city"].value = entry ? (entry.city || "") : "";
    el["f-country"].value = entry ? (entry.country || "") : "";
    el["f-dates"].value = entry ? (entry.dates_text || "") : "";
    el["f-event-start"].value = entry ? (entry.event_start || "") : "";
    el["f-event-end"].value = entry ? (entry.event_end || "") : "";
    el["f-deadline"].value = entry ? (entry.deadline || "") : "";
    el["f-deadlinetext"].value = entry ? (entry.deadline_text || "") : "";
    el["f-link"].value = entry ? (entry.link || "") : "";
    el["f-contact"].value = entry ? (entry.contact || "") : "";
    el["f-cost"].value = entry ? (entry.cost || "") : "";
    el["f-note"].value = entry ? (entry.note || "") : "";
    el["f-geosearch"].value = "";
    el["f-paste"].value = "";
    el["f-pastehint"].textContent = defaultPasteHint; // Hinweistext zurücksetzen
    el["f-geosuggest"].hidden = true;
    el["f-geosuggest"].innerHTML = "";
  }

  function openForm(entry) {
    fillForm(entry);
    openSheet("form");
  }

  // Strikte Dezimal-Validierung der GESAMTEN Eingabe. parseFloat("47foo") wäre 47
  // (führende Zahl), was falsche Koordinaten durchlässt. Hier muss der komplette
  // getrimmte String eine reine Dezimalzahl sein, sonst NaN.
  function parseCoord(raw) {
    var s = String(raw == null ? "" : raw).trim().replace(",", ".");
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return NaN;
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  async function saveForm(ev) {
    if (ev) ev.preventDefault();
    var name = el["f-name"].value.trim();
    var lat = parseCoord(el["f-lat"].value);
    var lng = parseCoord(el["f-lng"].value);
    if (!name) { SO.toast("Bitte einen Namen eingeben.", "error"); el["f-name"].focus(); return; }
    if (!isFinite(lat) || !isFinite(lng)) {
      SO.toast("Position fehlt oder ungültig — Ort suchen, auf Karte wählen oder Koordinaten als „lat, lng“ einfügen.", "error");
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      SO.toast("Koordinaten außerhalb des gültigen Bereichs (Breite ±90, Länge ±180).", "error");
      return;
    }
    var evStart = el["f-event-start"].value || null;
    var evEnd = el["f-event-end"].value || null;
    // Date-Inputs liefern „YYYY-MM-DD" — String-Vergleich ist chronologisch korrekt.
    if (evStart && evEnd && evEnd < evStart) {
      SO.toast("„Termin bis“ darf nicht vor „Termin von“ liegen.", "error");
      return;
    }
    var payload = {
      name: name,
      category: el["f-cat"].value,
      status: el["f-status"].value,
      lat: lat, lng: lng,
      city: el["f-city"].value.trim(),
      country: el["f-country"].value.trim(),
      dates_text: el["f-dates"].value.trim(),
      event_start: evStart,
      event_end: evEnd,
      deadline: el["f-deadline"].value || null,
      deadline_text: el["f-deadlinetext"].value.trim(),
      link: el["f-link"].value.trim(),
      contact: el["f-contact"].value.trim(),
      cost: el["f-cost"].value.trim(),
      note: el["f-note"].value.trim()
    };
    el["f-save"].disabled = true;
    try {
      var saved;
      var wasCreating = !state.editingId;
      if (!wasCreating) saved = await store.update(state.editingId, payload, state.editUpdatedAt);
      else saved = await store.create(payload);
      closeSheet("form");
      SO.toast("Gespeichert.", "ok");
      if (saved && saved.id) {
        // Neue eigene Einträge gehören immer zu „Aktiv". Wird einer aus dem
        // Vorschlags- oder Archiv-Pool angelegt, dorthin wechseln, bevor das
        // Detail geöffnet wird.
        if (wasCreating && state.pool !== "aktiv") setPool("aktiv");
        openDetail(saved.id);
      }
    } catch (e) {
      if (e && e.conflict) {
        // Gleichzeitige Fremdänderung: NICHTS überschreiben. Frische Werte holen
        // und im Formular eine Konflikt-Leiste zeigen. Der/die Nutzer:in wählt
        // bewusst: „Neu laden" (eigene Eingaben verwerfen) oder „Trotzdem
        // überschreiben" (mit dem frischen Versionsstempel speichern).
        try { await store.refetch(); } catch (_) {}
        showFormConflict();
      } else {
        SO.toast(e.message || "Speichern fehlgeschlagen.", "error");
      }
    } finally {
      el["f-save"].disabled = false;
    }
  }

  // ---------- Formular-Konflikt (Lost-Update, geteilter Modus) ----------
  function showFormConflict() { if (el.formConflict) el.formConflict.hidden = false; }
  function hideFormConflict() { if (el.formConflict) el.formConflict.hidden = true; }

  // „Neu laden": eigene Änderungen verwerfen, frische Werte ins Formular laden.
  function onConflictReload() {
    hideFormConflict();
    var fresh = store.getById(state.editingId);
    if (!fresh) {
      SO.toast("Der Eintrag wurde von der anderen Person gelöscht.", "error");
      closeSheet("form");
      return;
    }
    openForm(fresh); // setzt Felder + state.editUpdatedAt auf den frischen Stand
  }

  // „Trotzdem überschreiben": mit dem frischen updated_at erneut speichern —
  // die eigenen (im Formular stehenden) Eingaben gewinnen.
  function onConflictOverwrite() {
    hideFormConflict();
    var fresh = store.getById(state.editingId);
    if (!fresh) {
      SO.toast("Der Eintrag wurde von der anderen Person gelöscht.", "error");
      closeSheet("form");
      return;
    }
    state.editUpdatedAt = fresh.updated_at || null;
    saveForm();
  }

  // ---------- Ortssuche (Nominatim) ----------
  // Kein Autocomplete/kein Debounce (OSM-Policy). Suche NUR per Enter oder Button.
  var geoAbort = null;
  function triggerGeoSearch() {
    var q = el["f-geosearch"].value.trim();
    if (q.length < 3) { SO.toast("Bitte mindestens 3 Zeichen eingeben.", "error"); return; }
    // Cache: identische Anfrage nicht erneut ans OSM-Netz schicken.
    if (geoCache[q]) { showGeoResults(geoCache[q]); return; }
    if (!nominatimGate()) {
      SO.toast("Kurz warten — die Kartensuche ist auf 1 Anfrage/Sekunde begrenzt.", "error");
      return;
    }
    runGeoSearch(q);
  }
  async function runGeoSearch(q) {
    try {
      if (geoAbort) geoAbort.abort();
      geoAbort = new AbortController();
      var url = NOMINATIM_BASE + "/search?format=json&addressdetails=1&limit=5&accept-language=de&q=" + encodeURIComponent(q);
      var res = await fetch(url, { signal: geoAbort.signal, headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error("Suche nicht verfügbar");
      var results = await res.json();
      geoCache[q] = results;
      showGeoResults(results);
    } catch (e) {
      if (e.name !== "AbortError") {
        el["f-geosuggest"].hidden = true;
        SO.toast("Ortssuche gerade nicht verfügbar.", "error");
      }
    }
  }
  function showGeoResults(results) {
    if (!results || !results.length) {
      el["f-geosuggest"].hidden = true;
      SO.toast("Keine Treffer für diese Suche.", "error");
      return;
    }
    el["f-geosuggest"].innerHTML = results.map(function (r, i) {
      return '<button type="button" data-i="' + i + '">' + esc(r.display_name) + "</button>";
    }).join("");
    el["f-geosuggest"]._results = results;
    el["f-geosuggest"].hidden = false;
  }
  function pickGeoResult(i) {
    var r = (el["f-geosuggest"]._results || [])[i];
    if (!r) return;
    var lat = parseFloat(r.lat), lng = parseFloat(r.lon);
    el["f-lat"].value = lat.toFixed(5);
    el["f-lng"].value = lng.toFixed(5);
    var a = r.address || {};
    var city = a.city || a.town || a.village || a.municipality || a.county || "";
    if (city) el["f-city"].value = city;
    if (a.country) el["f-country"].value = a.country;
    el["f-geosuggest"].hidden = true;
    el["f-geosearch"].value = "";
    if (mapInited) SO.map.setPickMarker(lat, lng);
  }

  // ---------- Koordinaten / Link einfügen ----------
  function parseLocationInput(text) {
    if (!text) return null;
    var t = text.trim();
    if (/maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\.com\/\?address|apple\.co\//i.test(t)) {
      return { shortlink: true };
    }
    var m;
    // Google: @lat,lng  (auch /place/...@lat,lng)
    m = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return valid(m[1], m[2]);
    // Google: !3dlat!4dlng
    m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return valid(m[1], m[2]);
    // Apple: ll= oder coordinate=
    m = t.match(/[?&](?:ll|coordinate)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/i);
    if (m) return valid(m[1], m[2]);
    // ?q=lat,lng  / &q=lat,lng
    m = t.match(/[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/i);
    if (m) return valid(m[1], m[2]);
    // reines "lat, lng"
    m = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) return valid(m[1], m[2]);
    return null;
  }
  function valid(a, b) {
    var lat = parseFloat(a), lng = parseFloat(b);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }
  function onPasteInput() {
    var val = el["f-paste"].value;
    if (!val.trim()) { el["f-pastehint"].textContent = defaultPasteHint; return; }
    var parsed = parseLocationInput(val);
    if (parsed && parsed.shortlink) {
      el["f-pastehint"].textContent = "Kurzlink erkannt: bitte im Browser öffnen und die vollständige URL (mit Koordinaten) hier einfügen.";
      return;
    }
    if (parsed) {
      el["f-lat"].value = parsed.lat.toFixed(5);
      el["f-lng"].value = parsed.lng.toFixed(5);
      el["f-pastehint"].textContent = "Koordinaten übernommen: " + parsed.lat.toFixed(4) + ", " + parsed.lng.toFixed(4);
      if (mapInited) SO.map.setPickMarker(parsed.lat, parsed.lng);
      reverseGeocodeFill(parsed.lat, parsed.lng);
    } else {
      el["f-pastehint"].textContent = "Keine Koordinaten erkannt. Erwartet: Google-/Apple-Maps-Link oder „lat, lng“.";
    }
  }
  var defaultPasteHint = "Aus Google Maps, Apple Maps oder als „lat, lng“. Kurzlinks (maps.app.goo.gl) vorher im Browser öffnen und die vollständige URL kopieren.";

  // ---------- Position auf Karte wählen ----------
  function startPick() {
    var lat = parseCoord(el["f-lat"].value);
    var lng = parseCoord(el["f-lng"].value);
    var initial = (isFinite(lat) && isFinite(lng)) ? [lat, lng] : null;
    state.pickActive = true;
    closeSheet("form");
    setView("map");
    SO.map.invalidate();
    SO.map.enablePick(onPickUpdate, initial);
    el.pickBanner.hidden = false;
  }
  function finishPick() {
    state.pickActive = false;
    SO.map.disablePick();
    el.pickBanner.hidden = true;
    openSheet("form");
  }
  function onPickUpdate(lat, lng) {
    el["f-lat"].value = lat.toFixed(5);
    el["f-lng"].value = lng.toFixed(5);
    reverseGeocodeFill(lat, lng);
  }

  // Reverse-Geocoding teilt sich den Nominatim-Rate-Limiter mit der Suche.
  // Bei Rate-Limit wird der Aufruf kurz vertagt (leichte Warteschlange), statt
  // ihn zu verwerfen. Ein Token verhindert, dass eine veraltete Antwort neuere
  // Stadt/Land-Werte überschreibt.
  var revToken = 0;
  function reverseGeocodeFill(lat, lng) {
    if (el["f-city"].value.trim() && el["f-country"].value.trim()) return; // nicht überschreiben
    var myToken = ++revToken;
    scheduleReverse(lat, lng, myToken);
  }
  function scheduleReverse(lat, lng, myToken) {
    if (myToken !== revToken) return; // durch neuere Anfrage überholt
    if (!nominatimGate()) {
      setTimeout(function () { scheduleReverse(lat, lng, myToken); }, NOMINATIM_MIN_INTERVAL);
      return;
    }
    doReverse(lat, lng, myToken);
  }
  async function doReverse(lat, lng, myToken) {
    try {
      var url = NOMINATIM_BASE + "/reverse?format=json&accept-language=de&lat=" + lat + "&lon=" + lng;
      var res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok) return;
      var r = await res.json();
      if (myToken !== revToken) return; // veraltete Antwort verwerfen
      var a = r.address || {};
      var city = a.city || a.town || a.village || a.municipality || a.county || "";
      if (city && !el["f-city"].value.trim()) el["f-city"].value = city;
      if (a.country && !el["f-country"].value.trim()) el["f-country"].value = a.country;
    } catch (e) { /* optional */ }
  }

  // ============================================================================
  //  Auswahl / Sync
  // ============================================================================
  function setSelected(id) {
    state.selectedId = id;
    var prev = el.rows.querySelector(".row.is-selected");
    if (prev) prev.classList.remove("is-selected");
    var row = el.rows.querySelector('.row[data-id="' + cssEscape(id) + '"]');
    if (row) row.classList.add("is-selected");
    if (mapInited) {
      SO.map.select(id);
      // Auf Mobile ist die Karte in der Listenansicht display:none. Leaflet kann
      // in einem 0×0-Container keine gültige Projektion berechnen; der Detail-
      // Aufruf würde sonst vor dem Öffnen des Sheets abbrechen.
      if (el.map.offsetWidth > 0 && el.map.offsetHeight > 0) SO.map.flyTo(id);
    }
  }
  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  // ============================================================================
  //  Ansicht (Mobile-Tabs / Desktop)
  // ============================================================================
  function setView(view) {
    state.view = view;
    el.app.dataset.view = view;
    el.tabs.forEach(function (t) {
      var tv = t.dataset.tab;
      var on = (tv === "map" && view === "map") ||
        (tv === "list" && view === "list" && state.pool === "aktiv") ||
        (tv === "vorschlag" && view === "list" && state.pool === "vorschlag") ||
        (tv === "archiv" && view === "list" && state.pool === "archiv");
      t.setAttribute("aria-current", on ? "true" : "false");
    });
    var listMode = view === "list";
    el.btnListMode.setAttribute("aria-pressed", listMode ? "true" : "false");
    el.btnListMode.querySelector("span").textContent = listMode ? "Karte zeigen" : "Liste gross";
    if (view === "map" && mapInited) SO.map.invalidate();
  }

  function setPool(pool) {
    if (["aktiv", "vorschlag", "archiv"].indexOf(pool) === -1) return;
    state.pool = pool;
    el.segBtns.forEach(function (b) {
      var on = b.dataset.pool === pool;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (state.openSheet === "detail") closeSheet("detail");
    else clearSelection();
    render(); // Liste UND Karte auffrischen (gleiche Filterquelle)
    setView(state.view);
  }

  // ============================================================================
  //  Auth-UI
  // ============================================================================
  function applyAccountUI() {
    if (store.isDemo()) {
      el.demoBadge.hidden = false;
      el.userEmail.hidden = true;
      el.btnLogout.hidden = true;
    } else {
      el.demoBadge.hidden = true;
      if (store.user) {
        el.userEmail.hidden = false;
        el.userEmail.textContent = store.user.email;
        el.btnLogout.hidden = false;
      } else {
        el.userEmail.hidden = true;
        el.btnLogout.hidden = true;
      }
    }
  }

  function onAuthChange() {
    if (store.isDemo()) return;
    if (store.user) {
      el.auth.hidden = true;
      showApp();
    } else {
      el.auth.hidden = false;
      el.app.hidden = true;
      if (store.notAllowed) {
        // Nach Login als nicht freigeschaltet erkannt → zurück zur E-Mail-Eingabe.
        el["auth-step-code"].hidden = true;
        el["auth-step-email"].hidden = false;
        if (el["auth-code-fallback"]) el["auth-code-fallback"].hidden = true;
        if (el["auth-code-toggle"]) el["auth-code-toggle"].hidden = false;
        setAuthMsg("Diese E-Mail ist nicht freigeschaltet.", "error");
        store.notAllowed = false;
      }
    }
    applyAccountUI();
  }

  // Blockierender Fehlerbildschirm. Zwei Fälle, gleicher Bildschirm (#connError):
  //  - "config": config.js fehlt/unvollständig/ungültige URL → Hinweis auf config.js.
  //  - "connection" (Default): Zugangsdaten ok, aber Supabase nicht erreichbar.
  // In keinem Fall ein stiller Demo-Fallback.
  function showConnectionError(kind) {
    if (el.auth) el.auth.hidden = true;
    if (el.app) el.app.hidden = true;
    if (kind === "config") {
      if (el.connErrorTitle) el.connErrorTitle.textContent = "Konfiguration fehlerhaft";
      if (el.connErrorText) el.connErrorText.textContent =
        "Konfiguration unvollständig oder fehlerhaft — config.js prüfen.";
    } else {
      if (el.connErrorTitle) el.connErrorTitle.textContent = "Verbindung fehlgeschlagen";
      if (el.connErrorText) el.connErrorText.textContent =
        "Verbindung zum Server fehlgeschlagen. Bitte Internetverbindung prüfen und erneut versuchen.";
    }
    if (el.connError) el.connError.hidden = false;
  }

  // Magic-Link-Landung: Sobald die Session steht, die Auth-Tokens aus der
  // Adresszeile entfernen (#access_token…/#error…), damit die URL sauber bleibt.
  // Idempotent — falls supabase-js den Hash schon geräumt hat, passiert nichts.
  function stripAuthHash() {
    try {
      var h = window.location.hash || "";
      if (!h) return;
      if (/access_token=|refresh_token=|[#&]type=|error_description=|[#&]expires_in=/.test(h)) {
        window.history.replaceState(null, document.title,
          window.location.pathname + window.location.search);
      }
    } catch (e) { /* ignore */ }
  }

  function showApp() {
    stripAuthHash();
    el.app.hidden = false;
    if (!mapInited) {
      SO.map.init({ onSelect: function (id) { openDetail(id); } });
      mapInited = true;
    }
    applyAccountUI();
    setView(state.view);
    render();
    SO.map.invalidate();
  }

  // ============================================================================
  //  Event-Wiring
  // ============================================================================
  function wire() {
    // Suche
    el.search.addEventListener("input", function () {
      state.search = this.value.trim().toLowerCase();
      render();
    });
    // Shop-artige Facetten: Land, Art und Status lassen sich unabhängig und
    // jeweils mehrfach auswählen. Sortierung bleibt separat.
    el.countryOptions.addEventListener("change", function (ev) {
      var input = ev.target.closest('input[data-country]');
      if (!input) return;
      if (input.checked) state.countries.add(input.dataset.country);
      else state.countries.delete(input.dataset.country);
      render();
    });
    el.filterClear.addEventListener("click", function () {
      state.countries.clear();
      state.cats = new Set(SO.CATEGORIES);
      state.statuses = new Set(FILTER_STATUSES);
      render();
    });
    document.addEventListener("click", function (ev) {
      if (el.filterMenu.open && !el.filterMenu.contains(ev.target)) el.filterMenu.open = false;
    });
    // Sortierung
    el.sort.addEventListener("change", function () { state.sort = this.value; renderList(); });

    // Kategorie-Facette
    el.catFilters.addEventListener("change", function (ev) {
      var input = ev.target.closest("input[data-cat]"); if (!input) return;
      if (input.checked) state.cats.add(input.dataset.cat);
      else state.cats.delete(input.dataset.cat);
      render();
    });
    // Status-Facette (Mehrfachauswahl)
    el.statusFilters.addEventListener("change", function (ev) {
      var input = ev.target.closest("input[data-status]"); if (!input) return;
      if (input.checked) state.statuses.add(input.dataset.status);
      else state.statuses.delete(input.dataset.status);
      render();
    });
    // Pool-Umschalter (Desktop)
    el.archivToggle.addEventListener("click", function (ev) {
      var b = ev.target.closest(".seg-btn"); if (!b) return;
      setPool(b.dataset.pool);
    });
    // Add-Button (Desktop)
    el.btnAddDesktop.addEventListener("click", function () { openForm(null); });
    el.btnListMode.addEventListener("click", function () {
      setView(state.view === "list" ? "map" : "list");
    });

    // Deadline-Zeilen
    el.deadlineTags.addEventListener("click", function (ev) {
      var b = ev.target.closest(".deadline-row"); if (!b) return;
      openDetail(b.dataset.id);
    });

    // Listenzeilen
    el.rows.addEventListener("click", function (ev) {
      var r = ev.target.closest(".row"); if (!r) return;
      openDetail(r.dataset.id);
    });
    el.rows.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var r = ev.target.closest(".row"); if (!r) return;
      ev.preventDefault();
      openDetail(r.dataset.id);
    });

    // Mobile-Tabs
    el.tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        var tab = t.dataset.tab;
        if (tab === "add") { openForm(null); return; }
        if (tab === "map") { setView("map"); }
        else if (tab === "list") { setPool("aktiv"); setView("list"); }
        else if (tab === "vorschlag") { setPool("vorschlag"); setView("list"); }
        else if (tab === "archiv") { setPool("archiv"); setView("list"); }
      });
    });

    // Scrim + Schließen-Buttons
    el.scrim.addEventListener("click", function () { if (state.openSheet) closeSheet(state.openSheet); });
    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { closeSheet(b.dataset.close); });
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && state.openSheet) closeSheet(state.openSheet);
      else if (ev.key === "Escape" && el.filterMenu.open) el.filterMenu.open = false;
      if (ev.key === "Tab" && state.openSheet) {
        var activeSheet = state.openSheet === "form" ? el.form : el.detail;
        if (activeSheet.getAttribute("aria-modal") !== "true") return;
        var focusable = Array.prototype.slice.call(activeSheet.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(function (node) { return node.offsetWidth > 0 || node.offsetHeight > 0; });
        if (!focusable.length) return;
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    });

    // Detail-Aktionen (Delegation)
    el.detailBody.addEventListener("click", onDetailClick);
    el.detailBody.addEventListener("change", function (ev) {
      if (ev.target && ev.target.id === "attachInput") onUpload(ev.target);
    });

    // Formular
    el.entryForm.addEventListener("submit", saveForm);
    // Ortssuche: nur auf Enter (kein Formular-Submit) oder „Suchen"-Button.
    el["f-geosearch"].addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); triggerGeoSearch(); }
    });
    el["f-geosearchBtn"].addEventListener("click", function () { triggerGeoSearch(); });
    el["f-geosuggest"].addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-i]"); if (!b) return;
      pickGeoResult(parseInt(b.dataset.i, 10));
    });
    el["f-paste"].addEventListener("input", onPasteInput);
    el["f-pickmap"].addEventListener("click", startPick);
    el.pickDone.addEventListener("click", finishPick);

    // Formular-Konflikt-Leiste (nur geteilter Modus)
    if (el["f-conflict-reload"]) el["f-conflict-reload"].addEventListener("click", onConflictReload);
    if (el["f-conflict-overwrite"]) el["f-conflict-overwrite"].addEventListener("click", onConflictOverwrite);

    // Auth
    el["auth-form"].addEventListener("submit", onAuthSend);
    el["auth-verify"].addEventListener("click", onAuthVerify);
    // Sekundär: Code-Eingabe (Fallback) aufklappen.
    if (el["auth-code-toggle"]) el["auth-code-toggle"].addEventListener("click", function () {
      if (!el["auth-code-fallback"]) return;
      el["auth-code-fallback"].hidden = false;
      el["auth-code-toggle"].hidden = true;
      el["auth-code"].focus();
    });
    el["auth-back"].addEventListener("click", function () {
      el["auth-step-code"].hidden = true;
      el["auth-step-email"].hidden = false;
      if (el["auth-code-fallback"]) el["auth-code-fallback"].hidden = true;
      if (el["auth-code-toggle"]) el["auth-code-toggle"].hidden = false;
      el["auth-code"].value = "";
      setAuthMsg("");
    });
    el.btnLogout.addEventListener("click", async function () {
      try {
        await store.signOut();
        SO.toast("Abgemeldet.", "ok");
      } catch (e) {
        SO.toast(e.message || "Abmelden fehlgeschlagen.", "error");
      }
    });

    // Verbindungsfehler: „Erneut versuchen" lädt die Seite neu.
    if (el.connRetry) el.connRetry.addEventListener("click", function () { location.reload(); });
  }

  async function onDetailClick(ev) {
    var b = ev.target.closest("[data-act]"); if (!b) return;
    var act = b.dataset.act;
    var id = state.detailId;
    var e = store.getById(id);
    if (act === "status" && e) {
      if (b.disabled) return;
      // Statuswechsel-Buttons sperren, solange eine Statusänderung läuft.
      var switchBtns = el.detailBody.querySelectorAll('.status-switch [data-act="status"]');
      Array.prototype.forEach.call(switchBtns, function (x) { x.disabled = true; });
      try {
        // Auch dieser Schnellpfad gibt den aktuellen updated_at mit (Lost-Update-
        // Schutz). Bei Konflikt NICHT überschreiben: melden + neu laden.
        await store.update(id, { status: b.dataset.status }, e.updated_at || null);
        refreshDetailIfOpen(); // rendert die Buttons neu (wieder aktiv)
      } catch (err) {
        if (err && err.conflict) {
          SO.toast("Von der anderen Person geändert — aktualisiert", "error");
          try { await store.refetch(); } catch (_) {}
          refreshDetailIfOpen(); // rendert frische Werte + wieder aktive Buttons
        } else {
          SO.toast(err.message, "error");
          Array.prototype.forEach.call(switchBtns, function (x) { x.disabled = false; });
        }
      }
    } else if (act === "save-note" && e) {
      var noteField = $("quickNote");
      if (!noteField || b.disabled) return;
      b.disabled = true;
      try {
        await store.update(id, { note: noteField.value.trim() }, e.updated_at || null);
        SO.toast("Notiz gespeichert.", "ok");
        refreshDetailIfOpen();
      } catch (err) {
        if (err && err.conflict) {
          SO.toast("Von der anderen Person geändert — Notiz nicht gespeichert", "error");
          try { await store.refetch(); } catch (_) {}
          refreshDetailIfOpen();
        } else {
          SO.toast(err.message || "Notiz konnte nicht gespeichert werden.", "error");
          b.disabled = false;
        }
      }
    } else if (act === "adopt" && e && e.is_suggestion && !e.archived) {
      if (b.disabled) return;
      b.disabled = true;
      try {
        // Vorschläge sind normale Einträge mit einem Flag. Der Versionsstempel
        // verhindert, dass eine parallel bearbeitete Recherche still übernommen
        // wird. Nach Erfolg verschwindet sie aus der aktuellen Warteschlange.
        await store.update(id, { is_suggestion: false }, e.updated_at || null);
        SO.toast("Übernommen – jetzt unter Aktiv.", "ok");
        closeSheet("detail");
      } catch (err) {
        if (err && err.conflict) {
          SO.toast("Von der anderen Person geändert — aktualisiert", "error");
          try { await store.refetch(); } catch (_) {}
          refreshDetailIfOpen();
        } else {
          SO.toast(err.message || "Übernehmen fehlgeschlagen.", "error");
          b.disabled = false;
        }
      }
    } else if (act === "edit" && e) {
      openForm(e);
    } else if (act === "editpos" && e) {
      // Direkt in den Bearbeiten-Modus MIT aktivem Pick-Modus springen:
      // fillForm setzt Bearbeitungs-Zustand + Koordinaten (ohne das Sheet zu
      // öffnen — sonst würde ein noch ausstehender openSheet-rAF das Formular
      // gleich wieder über die Karte legen), das offene Detail-Sheet schließen,
      // dann direkt in den Karten-Pick-Modus. „Fertig" öffnet das Formular mit
      // der neuen Position zum Speichern.
      fillForm(e);
      closeSheet("detail");
      startPick();
    } else if (act === "archive" && e) {
      // wasArchived VOR dem await festhalten: im Demo-Modus mutiert setArchived
      // das Objekt in place, sonst wäre die Meldung invertiert.
      var wasArchived = e.archived;
      try {
        // setArchived gibt intern den aktuellen updated_at mit (Lost-Update-Schutz).
        await store.setArchived(id, !wasArchived);
        var archiveMessage = wasArchived ?
          (e.is_suggestion ? "Zurück zu den Vorschlägen." : "Wiederhergestellt.") :
          (e.is_suggestion ? "Vorschlag verworfen." : "Archiviert.");
        SO.toast(archiveMessage, "ok");
        closeSheet("detail");
      } catch (err) {
        if (err && err.conflict) {
          // Fremdänderung: nichts überschreiben, Ansicht auffrischen, offen lassen.
          SO.toast("Von der anderen Person geändert — aktualisiert", "error");
          try { await store.refetch(); } catch (_) {}
        } else {
          SO.toast(err.message, "error");
        }
      }
    } else if (act === "delete" && e) {
      if (!confirm("„" + e.name + "“ endgültig löschen?")) return;
      try {
        var removed = await store.remove(id, e.updated_at || null);
        closeSheet("detail");
        if (removed && removed.cleanupWarning) SO.toast("Eintrag gelöscht. " + removed.cleanupWarning, "error");
        else SO.toast("Gelöscht.", "ok");
      } catch (err) {
        if (err && err.conflict) {
          SO.toast("Von der anderen Person geändert — nicht gelöscht", "error");
          try { await store.refetch(); } catch (_) {}
          refreshDetailIfOpen();
        } else {
          SO.toast(err.message, "error");
        }
      }
    } else if (act === "att-open") {
      var att = detailAtts[b.dataset.id];
      if (att) {
        try { var url = await store.signedUrl(att.path); window.open(url, "_blank", "noopener"); }
        catch (err) { SO.toast(err.message, "error"); }
      }
    } else if (act === "att-del") {
      var a2 = detailAtts[b.dataset.id];
      if (a2 && confirm("Anhang löschen?")) {
        try { await store.removeAttachment(a2); loadAttachments(state.detailId); }
        catch (err) { SO.toast(err.message, "error"); }
      }
    }
  }

  async function onUpload(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { SO.toast("Datei zu groß (max. 10 MB).", "error"); input.value = ""; return; }
    try {
      await store.uploadAttachment(state.detailId, file);
      SO.toast("Hochgeladen.", "ok");
      loadAttachments(state.detailId);
    } catch (e) {
      SO.toast(e.message || "Upload fehlgeschlagen.", "error");
    } finally { input.value = ""; }
  }

  // ---------- Auth-Handler ----------
  function setAuthMsg(msg, kind) {
    el["auth-msg"].textContent = msg || "";
    el["auth-msg"].className = "auth-msg" + (kind ? " is-" + kind : "");
  }
  async function onAuthSend(ev) {
    ev.preventDefault();
    var email = el["auth-email"].value.trim().toLowerCase();
    if (!email) return;
    el["auth-send"].disabled = true;
    setAuthMsg("Anmelde-Link wird gesendet…");
    try {
      await store.sendOtp(email);
      el["auth-step-email"].hidden = true;
      el["auth-step-code"].hidden = false;
      // Code-Fallback beim (erneuten) Senden wieder einklappen.
      if (el["auth-code-fallback"]) el["auth-code-fallback"].hidden = true;
      if (el["auth-code-toggle"]) el["auth-code-toggle"].hidden = false;
      // textContent (kein innerHTML) — die E-Mail bleibt so unschädlich.
      el["auth-sent-text"].textContent =
        "Wir haben dir einen Anmelde-Link an " + email + " geschickt. " +
        "Öffne die Mail auf DIESEM Gerät und klicke den Link — du wirst automatisch angemeldet.";
      setAuthMsg("");
    } catch (e) {
      setAuthMsg(e.message || "Senden fehlgeschlagen.", "error");
    } finally { el["auth-send"].disabled = false; }
  }
  async function onAuthVerify() {
    var email = el["auth-email"].value.trim().toLowerCase();
    var code = el["auth-code"].value.trim();
    if (!code) return;
    el["auth-verify"].disabled = true;
    setAuthMsg("Wird geprüft…");
    try {
      await store.verifyOtp(email, code);
      setAuthMsg("");
      // onAuthChange übernimmt den Rest
    } catch (e) {
      setAuthMsg(e.message || "Anmeldung fehlgeschlagen.", "error");
    } finally { el["auth-verify"].disabled = false; }
  }

  // ============================================================================
  //  Reaktion auf Datenänderungen
  // ============================================================================
  function onDataChange() {
    if (!el.app.hidden) { render(); refreshDetailIfOpen(); }
  }

  // ============================================================================
  //  Start
  // ============================================================================
  async function init() {
    cacheDom();
    // Sheets/Scrim aus dem Fluss nehmen (Animation statt display:none)
    el.detail.hidden = true; el.form.hidden = true; el.scrim.hidden = true;
    el["f-pastehint"].textContent = defaultPasteHint;
    wire();
    store.subscribeChange(onDataChange);
    store.onAuthChange(onAuthChange);
    // Fatale Fehler nach Init (z.B. OTP-Login scheitert am Netz): blockieren,
    // gleiche Behandlung wie Init-Fehler.
    store.onFatal(function (e) {
      showConnectionError(e && e.kind === "config" ? "config" : "connection");
    });

    try {
      await store.init();
    } catch (e) {
      // Config-Fehler zeigen die Config-Variante; JEDER andere Init-Fehler ist
      // ein Verbindungsfehler und blockiert — niemals weiter in App/Login.
      if (e && e.kind === "config") { showConnectionError("config"); return; }
      showConnectionError("connection");
      return;
    }

    if (store.isDemo()) {
      el.auth.hidden = true;
      showApp();
    } else {
      onAuthChange();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(window.SO);
