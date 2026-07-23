/* ============================================================================
   Windrose — Datenschicht
   Store-Abstraktion: Demo-Modus (localStorage + Seed) ODER Supabase (geteilt).
   Dazu Helfer für Escaping, Datum und Status.
   ========================================================================== */
window.SO = window.SO || {};
(function (SO) {
  "use strict";

  // ---------- Konstanten ----------
  var DEMO_KEY = "standort-demo-v1";
  var DEMO_SEED_VERSION_KEY = "standort-demo-seed-version";
  var DEMO_DELETED_SEED_KEY = "standort-demo-deleted-seeds";
  var DEMO_SEED_VERSION = "europa-2026-07";

  SO.CATEGORIES = ["festival", "markt", "messe", "sonstiges"];
  SO.CAT_LABEL = { festival: "Festival", markt: "Markt", messe: "Messe", sonstiges: "Sonstiges" };
  SO.CAT_COLOR = { festival: "#7c5aa0", markt: "#37897a", messe: "#b07f36", sonstiges: "#c25c82" };

  SO.STATUSES = ["offen", "beworben", "wartet", "zugesagt", "abgesagt"];
  SO.STATUS_LABEL = {
    offen: "Offen", beworben: "Beworben", wartet: "Wartet",
    zugesagt: "Zugesagt", abgesagt: "Abgesagt", verpasst: "Verpasst"
  };

  // ---------- Kanonische Whitelists (XSS-Härtung) ----------
  // status/category fließen in Klassennamen (z.B. status-<x>, cat-<x>) und dürfen
  // deshalb NIEMALS beliebige DB-Werte enthalten. normStatus/normCat zwingen jeden
  // Wert auf einen der erlaubten Bezeichner; alles andere wird auf den Default
  // gemappt. An JEDER Render-Stelle, die diese Werte in Klassen/Text schreibt,
  // werden die Normalizer benutzt — selbst manipulierte DB-Werte können so nicht
  // aus dem Attribut ausbrechen. 'verpasst' entsteht nur abgeleitet (derivedStatus).
  var STATUS_SET = { offen: true, beworben: true, wartet: true, zugesagt: true, abgesagt: true };
  var CAT_SET = { festival: true, markt: true, messe: true, sonstiges: true };
  function normStatus(entry) {
    var s = entry && entry.status;
    return STATUS_SET[s] ? s : "offen";
  }
  function normCat(entry) {
    var c = entry && entry.category;
    return CAT_SET[c] ? c : "sonstiges";
  }
  SO.normStatus = normStatus;
  SO.normCat = normCat;

  // ---------- XSS-sicheres Escaping ----------
  var ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }
  SO.esc = esc;

  // ---------- URL-Validierung (XSS-Schutz für gespeicherte Links) ----------
  // Erlaubt ausschließlich http:/https: und liefert die normalisierte href.
  // Alles andere (javascript:, data:, mailto:, Müll) → null.
  function safeUrl(u) {
    if (!u) return null;
    var s = String(u).trim();
    if (!s) return null;
    try {
      var url = new URL(s);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.href;
    } catch (e) {
      return null;
    }
  }
  SO.safeUrl = safeUrl;

  // ---------- Datumshelfer (zeitzonensicher) ----------
  function parseDate(iso) {
    if (!iso) return null;
    var value = String(iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var d = new Date(value + "T00:00:00");
    var parts = value.split("-").map(Number);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== parts[0] ||
        d.getMonth() !== parts[1] - 1 || d.getDate() !== parts[2]) return null;
    return d;
  }
  function todayStart() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function fmtDate(iso) {
    var d = parseDate(iso); if (!d) return "";
    return d.toLocaleDateString("de-CH", { day: "2-digit", month: "short", year: "numeric" });
  }
  function fmtDateShort(iso) {
    var d = parseDate(iso); if (!d) return "";
    return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  SO.parseDate = parseDate;
  SO.todayStart = todayStart;
  SO.fmtDate = fmtDate;
  SO.fmtDateShort = fmtDateShort;

  // deadlineState: 'none' | 'passed' | 'thismonth' | 'upcoming'
  function deadlineState(entry) {
    if (!entry.deadline) return "none";
    var d = parseDate(entry.deadline);
    if (!d) return "none";
    var now = todayStart();
    if (d < now) return "passed";
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return "thismonth";
    return "upcoming";
  }
  SO.deadlineState = deadlineState;

  // Abgeleiteter Status inkl. "verpasst" (Frist vorbei UND noch 'offen').
  // Basiert auf dem normalisierten Status, damit das Ergebnis garantiert einer
  // der bekannten (klassensicheren) Bezeichner ist.
  function derivedStatus(entry) {
    var s = normStatus(entry);
    if (s === "offen" && deadlineState(entry) === "passed") return "verpasst";
    return s;
  }
  SO.derivedStatus = derivedStatus;

  // Dringlichkeits-Styling (Ringe, Deadline-Streifen, „diesen Monat/abgelaufen")
  // gilt nur für aktiv verfolgte Einträge. Zugesagte/abgesagte werden nie als
  // dringend markiert und tauchen nicht im Deadline-Streifen auf.
  var URGENCY_STATUSES = { offen: true, beworben: true, wartet: true };
  function showUrgency(entry) {
    return !!URGENCY_STATUSES[normStatus(entry)];
  }
  SO.showUrgency = showUrgency;

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  SO.uid = uid;

  // Whitelist der Felder, die geschrieben werden dürfen (Schutz vor Fremdfeldern).
  var WRITABLE = [
    "name", "category", "city", "country", "lat", "lng", "dates_text",
    "event_start", "event_end", "deadline", "deadline_text", "status",
    "link", "contact", "note", "cost", "archived", "is_suggestion"
  ];
  function cleanPayload(obj) {
    var out = {};
    WRITABLE.forEach(function (k) { if (k in obj) out[k] = obj[k]; });
    // Links werden auf http(s) normalisiert; alles andere wird verworfen (null),
    // damit kein javascript:/data:-URL gespeichert und später gerendert wird.
    if ("link" in out) out.link = safeUrl(out.link);
    // status/category gegen die Whitelist absichern, BEVOR sie in die DB gehen:
    // ungültige Werte werden auf den Default gezwungen (offen/sonstiges).
    if ("status" in out) out.status = STATUS_SET[out.status] ? out.status : "offen";
    if ("category" in out) out.category = CAT_SET[out.category] ? out.category : "sonstiges";
    if ("archived" in out) out.archived = !!out.archived;
    if ("is_suggestion" in out) out.is_suggestion = !!out.is_suggestion;
    return out;
  }

  // ============================================================================
  //  Store
  // ============================================================================
  var listeners = [];   // Daten-Änderungen
  var authListeners = []; // Auth-Änderungen
  var fatalListeners = []; // Fatale Fehler nach Init (z.B. Login auf totem Netz)
  var entries = [];

  function emitChange() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function emitAuth() { authListeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function emitFatal(err) { fatalListeners.forEach(function (fn) { try { fn(err); } catch (e) {} }); }

  var store = {
    mode: "demo",
    user: null,       // { email }
    supabase: null,

    isDemo: function () { return this.mode === "demo"; },
    list: function () { return entries; },
    getById: function (id) { return entries.find(function (e) { return e.id === id; }) || null; },
    subscribeChange: function (fn) { listeners.push(fn); },
    onAuthChange: function (fn) { authListeners.push(fn); },
    onFatal: function (fn) { fatalListeners.push(fn); }
  };
  SO.store = store;

  // ---------- Demo-Persistenz ----------
  // Sechs Einträge hatten in einer frühen Version fälschlich einen Bewerbungs-
  // START als deadline gespeichert. Alte localStorage-Datensätze tragen diese
  // falschen Werte weiter. Beim Laden gezielt migrieren: nur wenn die gespeicherte
  // deadline noch EXAKT dem alten falschen Wert entspricht → auf null setzen
  // (eigene Bearbeitungen bleiben unangetastet). Werte 1:1 aus db/seed.sql.
  var DEMO_DEADLINE_FIXES = {
    "8df2cb08-cfb8-5dca-b479-13729230e2f8": "2027-03-01", // One Love Festival
    "4fd33ca8-8331-5637-a9b0-5915753bdebf": "2027-04-01", // Weihnachtsmarkt Strasbourg
    "69e317e9-0674-52c9-9b8b-08ae2b422ad0": "2027-03-15", // Weihnachtsmärkte Colmar
    "faa7184f-791b-5157-ab45-d26f156d69ee": "2027-01-15", // VooV Festival
    "822a3c02-b3eb-5e57-9e9f-b09e1e7e9894": "2026-11-01", // Feel Festival
    "570bb13a-3db6-5e8b-b75c-39fcce19a33b": "2026-09-01"  // Festivalet Markt
  };
  function migrateDemoDeadlines(list) {
    if (!Array.isArray(list)) return false;
    var changed = false;
    list.forEach(function (e) {
      if (e && Object.prototype.hasOwnProperty.call(DEMO_DEADLINE_FIXES, e.id) &&
          e.deadline === DEMO_DEADLINE_FIXES[e.id]) {
        e.deadline = null;
        changed = true;
      }
    });
    return changed;
  }

  // Neue, redaktionell recherchierte Seed-Einträge einmalig in bereits
  // bestehende Demo-Datensätze übernehmen. Vorhandene Einträge werden nie
  // überschrieben; bewusst gelöschte Seeds erscheinen innerhalb derselben
  // Version nicht erneut.
  function mergeDemoSeedAdditions(list) {
    if (!Array.isArray(list)) return false;
    try {
      if (localStorage.getItem(DEMO_SEED_VERSION_KEY) === DEMO_SEED_VERSION) return false;
    } catch (e) { /* Merge trotzdem versuchen */ }

    var known = {}, deleted = {};
    try {
      (JSON.parse(localStorage.getItem(DEMO_DELETED_SEED_KEY) || "[]") || []).forEach(function (id) { deleted[id] = true; });
    } catch (e) { deleted = {}; }
    list.forEach(function (e) { if (e && e.id) known[e.id] = true; });
    // Die ersten 30 IDs sind der ursprüngliche Demo-Datensatz. Nur die später
    // recherchierten Ergänzungen übernehmen, damit früher bewusst gelöschte
    // Originalbeispiele nicht wieder auftauchen.
    (window.STANDORT_SEED || []).slice(30).forEach(function (seedEntry) {
      if (!known[seedEntry.id] && !deleted[seedEntry.id]) list.push(Object.assign({}, seedEntry));
    });
    return true;
  }

  function markDemoSeedVersion() {
    try { localStorage.setItem(DEMO_SEED_VERSION_KEY, DEMO_SEED_VERSION); } catch (e) {}
  }

  function demoLoad() {
    try {
      var raw = localStorage.getItem(DEMO_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("Ungültiger Demo-Datensatz");
        entries = parsed;
        // Einmalige gezielte Reparatur der sechs falschen Fristen; nur bei
        // tatsächlicher Änderung zurückschreiben.
        var repaired = migrateDemoDeadlines(entries);
        var expanded = mergeDemoSeedAdditions(entries);
        if (repaired || expanded) {
          if (demoPersist() && expanded) markDemoSeedVersion();
        }
        return;
      }
    } catch (e) { /* ignore */ }
    // Seed tief kopieren, damit Bearbeitungen den Seed nicht verändern
    entries = (window.STANDORT_SEED || []).map(function (e) {
      return Object.assign({}, e);
    });
    if (demoPersist()) markDemoSeedVersion();
  }
  function demoPersist() {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(entries)); return true; }
    catch (e) { return false; }
  }

  // ============================================================================
  //  Init
  // ============================================================================
  function configError() {
    var e = new Error("Konfiguration unvollständig oder fehlerhaft — config.js prüfen.");
    e.kind = "config";
    return e;
  }

  function connectionError(original) {
    var e = new Error("Verbindung zum Server fehlgeschlagen");
    e.kind = "connection";
    e.original = original;
    return e;
  }

  // Aktiver Erreichbarkeits-Check für den Fall „keine gespeicherte Session":
  // GENAU EIN REST-Request gegen <url>/rest/v1/ mit Anon-Headern, hart nach ~5s
  // via AbortController abgebrochen. 2xx oder 4xx-mit-gültigem-JSON = Server
  // erreichbar (echte PostgREST-Antwort); Netzwerkfehler, Timeout oder 5xx =
  // Verbindungsfehler. Kein Retry-Loop. Wirft im Fehlerfall (der Aufrufer
  // verpackt das in einen connection-Error).
  async function healthcheck(urlStr, keyStr) {
    var base = urlStr.replace(/\/+$/, "");
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 5000) : null;
    try {
      var resp = await fetch(base + "/rest/v1/", {
        method: "GET",
        headers: { apikey: keyStr, Authorization: "Bearer " + keyStr },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (resp.status >= 500) throw new Error("Server-Fehler " + resp.status);
      if (resp.status >= 200 && resp.status < 300) return; // erreichbar
      if (resp.status >= 400 && resp.status < 500) {
        // 4xx nur als erreichbar werten, wenn valides JSON zurückkommt (echte
        // PostgREST-Fehlerantwort, nicht z.B. eine fremde HTML-Fehlerseite).
        try { await resp.json(); return; }
        catch (jsonErr) { throw new Error("Ungültige Antwort (" + resp.status + ")"); }
      }
      throw new Error("Unerwartete Antwort (" + resp.status + ")");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  store.init = async function () {
    var cfg = window.STANDORT_CONFIG;

    // Demo-Modus AUSSCHLIESSLICH, wenn das Config-Objekt existiert UND beide
    // Felder exakt leere Strings sind (der ausgelieferte Default). Jeder andere
    // Zustand ist ein Konfigurationsfehler und blockiert die App — es gibt
    // keinen stillen Demo-Fallback bei kaputter/teilweiser Konfiguration.
    if (cfg && typeof cfg === "object" &&
        cfg.supabaseUrl === "" && cfg.supabaseAnonKey === "") {
      this.mode = "demo";
      demoLoad();
      return;
    }

    // Objekt fehlt ganz (config.js nicht geladen / Syntaxfehler) → Konfig-Fehler.
    if (!cfg || typeof cfg !== "object") {
      this.mode = "error";
      throw configError();
    }

    // Nur eines der beiden Felder gesetzt / kein String → Konfig-Fehler.
    var urlStr = typeof cfg.supabaseUrl === "string" ? cfg.supabaseUrl.trim() : "";
    var keyStr = typeof cfg.supabaseAnonKey === "string" ? cfg.supabaseAnonKey.trim() : "";
    if (!urlStr || !keyStr) {
      this.mode = "error";
      throw configError();
    }

    // URL muss eine gültige https-URL sein (mit new URL validiert).
    try {
      var parsed = new URL(urlStr);
      if (parsed.protocol !== "https:") throw new Error("kein https");
    } catch (e) {
      this.mode = "error";
      throw configError();
    }

    // Supabase-Modus. Bei konfigurierten Zugangsdaten NIEMALS still in den
    // Demo-Modus zurückfallen — sonst würden Bearbeitungen lokal statt geteilt
    // landen. Schlägt der Verbindungsaufbau fehl, blockiert die App mit Fehler.
    this.mode = "supabase";
    var self = this;
    // Der gesamte Verbindungsaufbau liegt in EINER Fehlergrenze: Client-Erstellung,
    // getSession (inkl. res.error — nicht schlucken), Erreichbarkeits-Check bzw.
    // initialer Datenabgleich. Jeder Netzwerk-/Server-/Vendor-Fehler wird als
    // err.kind = "connection" re-geworfen und blockiert die App; ein reiner
    // Konfig-Fehler bleibt Konfig-Fehler. NIEMALS stiller Demo-Fallback.
    try {
      // supabase-js wird lokal aus vendor/ als <script> geladen (kein CDN zur
      // Laufzeit). Fehlt der Global, ist etwas mit dem Vendor-Bundle nicht in
      // Ordnung → als Verbindungsfehler behandeln (blockierender Bildschirm).
      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        throw new Error("supabase-js (vendor) nicht geladen");
      }
      this.supabase = window.supabase.createClient(urlStr, keyStr, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });

      // Session wiederherstellen. getSession-Fehler NICHT schlucken: res.error
      // prüfen, sonst rutscht ein kaputter/unerreichbarer Server als „kein
      // Login" durch und die App zeigt fälschlich den Login-Screen.
      var res = await this.supabase.auth.getSession();
      if (res && res.error) throw res.error;
      var session = res && res.data ? res.data.session : null;
      this.user = session && session.user ? { email: session.user.email } : null;

      // Auf Auth-Wechsel reagieren
      this.supabase.auth.onAuthStateChange(function (_event, sess) {
        var wasLoggedIn = !!self.user;
        self.user = sess && sess.user ? { email: sess.user.email } : null;
        emitAuth();
        if (self.user && !wasLoggedIn) {
          // Läuft ausserhalb der Init-Fehlergrenze (Login nach dem Start):
          // Verbindungsfehler hier als fatal melden statt unbehandelt verpuffen.
          self._afterLogin().catch(function (err) {
            self.mode = "error";
            emitFatal(err && err.kind ? err : connectionError(err));
          });
        }
      });

      if (this.user) {
        // Bestehende Session: der initiale Datenabgleich deckt zugleich die
        // Server-Erreichbarkeit ab — schlägt refetch fehl, wird der Fehler
        // unten als Verbindungsfehler re-geworfen (statt App mit leerer Liste).
        await this._afterLogin();
      } else {
        // Keine Session: getSession macht dann keinen Netzwerk-Request, ein
        // falscher/unerreichbarer Server bliebe unbemerkt. Deshalb ein einzelner
        // aktiver REST-Healthcheck mit Timeout, bevor der Login-Screen erscheint.
        await healthcheck(urlStr, keyStr);
      }
    } catch (e) {
      this.mode = "error";
      // Konfig-Fehler bleiben Konfig-Fehler; alles andere (Netzwerk, Server,
      // Vendor-Bundle, getSession/refetch/Healthcheck) → Verbindungsfehler.
      if (e && e.kind === "config") throw e;
      throw connectionError(e);
    }
  };

  store._afterLogin = async function () {
    // Nach dem Login explizit prüfen, ob die E-Mail freigeschaltet ist.
    // Nicht freigeschaltete Nutzer werden sofort wieder abgemeldet.
    var allowed = await this._checkAllowed();
    if (!allowed) {
      this.notAllowed = true;
      try { await this.supabase.auth.signOut(); } catch (e) {}
      this.user = null;
      entries = [];
      emitAuth();
      emitChange();
      return;
    }
    this.notAllowed = false;
    await this.refetch();
    this._subscribeRealtime();
  };

  // Allowlist-Mitgliedschaft prüfen (RLS-gesichert via rpc is_allowed(),
  // Fallback: Lesezugriff auf allowed_users, den nur Freigeschaltete haben).
  // WICHTIG: „konnte nicht prüfen" (Netzwerk/Server, supabase-js liefert das
  // als aufgelöstes { error, status: 0 } bzw. 5xx) darf NICHT als „nicht
  // freigeschaltet" gewertet werden — sonst wird ein legitimer User auf
  // wackligem Netz still abgemeldet. Solche Fehler werfen in die Init-Grenze.
  function isNetFailure(res) {
    var s = res && typeof res.status === "number" ? res.status : 0;
    return s === 0 || s >= 500;
  }
  store._checkAllowed = async function () {
    var res;
    try {
      res = await this.supabase.rpc("is_allowed");
    } catch (e) {
      throw connectionError(e);
    }
    if (!res.error) return !!res.data;
    if (isNetFailure(res)) throw connectionError(res.error);
    // rpc existiert nicht o.ä. (z.B. 404) → Fallback über allowed_users
    var q;
    try {
      q = await this.supabase.from("allowed_users").select("email").limit(1);
    } catch (e) {
      throw connectionError(e);
    }
    if (q.error) {
      if (isNetFailure(q)) throw connectionError(q.error);
      return false; // definitive Ablehnung (z.B. fehlende Berechtigung)
    }
    return !!q.data && q.data.length > 0;
  };

  // ---------- Supabase: Fehlerbehandlung ----------
  function sbFail(error, fallbackMsg) {
    var msg = fallbackMsg || "Etwas ist schiefgelaufen.";
    if (error && error.message) {
      if (/row-level security|not allowed|permission/i.test(error.message)) {
        msg = "Kein Zugriff — diese E-Mail ist nicht freigeschaltet.";
      } else {
        msg = fallbackMsg + " (" + error.message + ")";
      }
    }
    var e = new Error(msg);
    e.original = error;
    return e;
  }

  var fetchSeq = 0;
  store.refetch = async function () {
    if (this.mode !== "supabase") { emitChange(); return; }
    var my = ++fetchSeq;
    var res = await this.supabase.from("entries").select("*");
    if (res.error) throw sbFail(res.error, "Einträge konnten nicht geladen werden.");
    // Nur das jüngste Refetch-Ergebnis darf die Liste ersetzen (Race-Schutz).
    if (my !== fetchSeq) return;
    entries = res.data || [];
    emitChange();
  };

  var refetchTimer = null;
  store._debouncedRefetch = function () {
    var self = this;
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(function () {
      self.refetch().catch(function (e) {
        if (SO.toast) SO.toast(e.message || "Aktualisierung fehlgeschlagen.", "error");
      });
    }, 250);
  };

  store._subscribeRealtime = function () {
    if (this._channel || this.mode !== "supabase") return;
    var self = this;
    try {
      this._channel = this.supabase
        .channel("entries-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, function () {
          self._debouncedRefetch();
        })
        .subscribe();
    } catch (e) { /* Realtime optional */ }
  };

  // ============================================================================
  //  CRUD
  // ============================================================================
  store.create = async function (input) {
    var payload = cleanPayload(input);
    if (this.mode === "demo") {
      var now = new Date().toISOString();
      var row = Object.assign({
        id: uid(), status: "offen", archived: false, is_suggestion: false,
        created_by: "demo", updated_by: "demo",
        created_at: now, updated_at: now
      }, payload);
      entries.push(row);
      if (!demoPersist()) {
        entries.pop();
        throw new Error("Konnte nicht lokal speichern (Speicher voll?).");
      }
      emitChange();
      return row;
    }
    // created_by/updated_by werden serverseitig per Trigger aus der JWT-E-Mail
    // gesetzt (nicht fälschbar). Client-Werte nur als Demo-Fallback (siehe oben).
    var res = await this.supabase.from("entries").insert(payload).select().single();
    if (res.error) throw sbFail(res.error, "Eintrag konnte nicht gespeichert werden.");
    await this.refetch();
    return res.data;
  };

  // expectedUpdatedAt: Schutz vor "lost update" bei gleichzeitiger Bearbeitung.
  // Im Supabase-Modus ist der Parameter PFLICHT — JEDER Schreibpfad (Formular,
  // Statuswechsel, Archivieren) muss den zuletzt gesehenen updated_at-Wert
  // mitgeben. Passt er nicht mehr, wird ein Konflikt-Fehler (err.conflict === true)
  // geworfen, statt fremde Änderungen zu überschreiben.
  store.update = async function (id, patch, expectedUpdatedAt) {
    var payload = cleanPayload(patch);
    if (this.mode === "demo") {
      var e = this.getById(id);
      if (!e) return null;
      var before = Object.assign({}, e);
      Object.assign(e, payload, { updated_at: new Date().toISOString(), updated_by: "demo" });
      if (!demoPersist()) {
        var idx = entries.indexOf(e);
        if (idx !== -1) entries[idx] = before;
        throw new Error("Konnte nicht lokal speichern (Speicher voll?).");
      }
      emitChange();
      return e;
    }
    // Ohne Versionsstempel im geteilten Modus grundsätzlich ablehnen — sonst
    // könnte ein Teilupdate stillschweigend fremde Änderungen überschreiben.
    if (!expectedUpdatedAt) {
      throw new Error("Interner Fehler: Änderung ohne Versionsstempel abgelehnt.");
    }
    // updated_by wird serverseitig per Trigger gesetzt (nicht fälschbar).
    var res = await this.supabase.from("entries")
      .update(payload).eq("id", id).eq("updated_at", expectedUpdatedAt).select();
    if (res.error) throw sbFail(res.error, "Änderung konnte nicht gespeichert werden.");
    if (!res.data || res.data.length === 0) {
      var conflict = new Error("Von der anderen Person geändert.");
      conflict.conflict = true;
      throw conflict;
    }
    await this.refetch();
    return res.data[0];
  };

  // Archivieren/Wiederherstellen ist ebenfalls ein Teilupdate und muss daher den
  // aktuellen updated_at des Eintrags mitgeben (Lost-Update-Schutz).
  store.setArchived = function (id, val) {
    var e = this.getById(id);
    var expected = e ? (e.updated_at || null) : null;
    return this.update(id, { archived: !!val }, expected);
  };

  store.remove = async function (id, expectedUpdatedAt) {
    if (this.mode === "demo") {
      var before = entries;
      entries = entries.filter(function (e) { return e.id !== id; });
      if (!demoPersist()) {
        entries = before;
        throw new Error("Konnte nicht lokal speichern (Speicher voll?).");
      } else {
        var isSeed = (window.STANDORT_SEED || []).some(function (seedEntry) { return seedEntry.id === id; });
        if (isSeed) {
          try {
            var deleted = JSON.parse(localStorage.getItem(DEMO_DELETED_SEED_KEY) || "[]");
            if (!Array.isArray(deleted)) deleted = [];
            if (deleted.indexOf(id) === -1) deleted.push(id);
            localStorage.setItem(DEMO_DELETED_SEED_KEY, JSON.stringify(deleted));
          } catch (err) {}
        }
      }
      emitChange();
      return;
    }
    if (!expectedUpdatedAt) {
      throw new Error("Interner Fehler: Löschen ohne Versionsstempel abgelehnt.");
    }
    // Pfade vor dem Löschen merken. Zuerst die DB-Zeile mit Versionsschutz
    // löschen; die Metadaten verschwinden per FK-Cascade. So bleiben bei einem
    // DB-Fehler keine Anhang-Datensätze zurück, die auf gelöschte Dateien zeigen.
    var listRes = await this.supabase.from("attachments").select("path").eq("entry_id", id);
    if (listRes.error) throw sbFail(listRes.error, "Anhänge konnten nicht ermittelt werden.");
    var paths = (listRes.data || []).map(function (a) { return a.path; });
    var res = await this.supabase.from("entries").delete()
      .eq("id", id).eq("updated_at", expectedUpdatedAt).select("id");
    if (res.error) throw sbFail(res.error, "Eintrag konnte nicht gelöscht werden.");
    if (!res.data || res.data.length === 0) {
      var conflict = new Error("Von der anderen Person geändert.");
      conflict.conflict = true;
      throw conflict;
    }
    var cleanupWarning = "";
    if (paths.length) {
      try {
        var rm = await this.supabase.storage.from("attachments").remove(paths);
        if (rm.error) cleanupWarning = "Anhang-Dateien konnten nicht vollständig bereinigt werden.";
      } catch (e) {
        cleanupWarning = "Anhang-Dateien konnten nicht vollständig bereinigt werden.";
      }
    }
    await this.refetch();
    return { cleanupWarning: cleanupWarning };
  };

  // ============================================================================
  //  Auth (nur Supabase)
  // ============================================================================
  store.sendOtp = async function (email) {
    var cfg = window.STANDORT_CONFIG || {};
    // shouldCreateUser standardmäßig true; nach erstem Login beider Nutzer in
    // config.js auf false setzen, damit keine neuen Konten mehr entstehen.
    var res = await this.supabase.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: cfg.shouldCreateUser !== false,
        emailRedirectTo: location.origin + location.pathname
      }
    });
    if (res.error) throw sbFail(res.error, "Code konnte nicht gesendet werden.");
  };
  store.verifyOtp = async function (email, token) {
    var res = await this.supabase.auth.verifyOtp({ email: email, token: token, type: "email" });
    if (res.error) throw sbFail(res.error, "Code ist ungültig oder abgelaufen.");
    return res.data;
  };
  store.signOut = async function () {
    if (this.mode !== "supabase") return;
    var res = await this.supabase.auth.signOut();
    if (res && res.error) throw sbFail(res.error, "Abmelden fehlgeschlagen.");
    entries = [];
    emitChange();
  };

  // ============================================================================
  //  Anhänge (nur Supabase)
  // ============================================================================
  store.listAttachments = async function (entryId) {
    if (this.mode !== "supabase") return [];
    var res = await this.supabase.from("attachments")
      .select("*").eq("entry_id", entryId).order("created_at", { ascending: true });
    if (res.error) throw sbFail(res.error, "Anhänge konnten nicht geladen werden.");
    return res.data || [];
  };
  store.uploadAttachment = async function (entryId, file) {
    if (this.mode !== "supabase") throw new Error("Anhänge sind nur im geteilten Modus verfügbar.");
    var safe = file.name.replace(/[^\w.\-]+/g, "_");
    var path = entryId + "/" + Date.now() + "-" + safe;
    var up = await this.supabase.storage.from("attachments").upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || undefined
    });
    if (up.error) throw sbFail(up.error, "Datei konnte nicht hochgeladen werden.");
    var ins = await this.supabase.from("attachments")
      .insert({ entry_id: entryId, path: path, filename: file.name }).select().single();
    if (ins.error) {
      // Aufräumen, falls DB-Eintrag scheitert. Auch das Ergebnis des Aufräumens
      // prüfen: bleibt die Datei zurück (rm.error oder Ausnahme), verwaist sie im
      // Storage → das explizit melden, inkl. Pfad, damit sie manuell entfernt
      // werden kann.
      try {
        var rm = await this.supabase.storage.from("attachments").remove([path]);
        if (rm && rm.error && SO.toast) {
          SO.toast("Hochgeladene Datei blieb verwaist im Speicher: " + path, "error");
        }
      } catch (cleanupErr) {
        if (SO.toast) SO.toast("Hochgeladene Datei blieb verwaist im Speicher: " + path, "error");
      }
      throw sbFail(ins.error, "Anhang konnte nicht gespeichert werden.");
    }
    return ins.data;
  };
  store.signedUrl = async function (path) {
    var res = await this.supabase.storage.from("attachments").createSignedUrl(path, 3600);
    if (res.error) throw sbFail(res.error, "Link konnte nicht erstellt werden.");
    return res.data.signedUrl;
  };
  store.removeAttachment = async function (att) {
    // Erst die Datei aus dem Storage entfernen; scheitert das, bleibt der
    // DB-Eintrag erhalten (kein verwaister Datensatz) und der Fehler wird gemeldet.
    var rm = await this.supabase.storage.from("attachments").remove([att.path]);
    if (rm.error) throw sbFail(rm.error, "Anhang-Datei konnte nicht gelöscht werden.");
    var del = await this.supabase.from("attachments").delete().eq("id", att.id);
    if (del.error) throw sbFail(del.error, "Anhang konnte nicht gelöscht werden.");
  };

})(window.SO);
