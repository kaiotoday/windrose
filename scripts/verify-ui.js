#!/usr/bin/env node
"use strict";

// Lokaler Smoke-/Interaktionstest. Benötigt Playwright im NODE_PATH und optional
// PLAYWRIGHT_CHROMIUM_EXECUTABLE, weil dieses statische Projekt bewusst keine
// npm-Abhängigkeiten eincheckt.
const { chromium } = require("playwright");
const path = require("path");

const baseUrl = process.env.WINDROSE_TEST_URL || "http://127.0.0.1:8123/";
const visualDir = process.env.WINDROSE_VISUAL_DIR || "/tmp";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

const configOverride = () => {
  Object.defineProperty(window, "STANDORT_CONFIG", {
    value: { supabaseUrl: "", supabaseAnonKey: "", shouldCreateUser: false },
    writable: false,
    configurable: false
  });
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const errors = [];
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await desktop.addInitScript(configOverride);
    const page = await desktop.newPage();
    page.on("pageerror", (error) => errors.push("Desktop pageerror: " + error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push("Desktop console: " + message.text());
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#app:not([hidden])", { timeout: 30000 });
    await page.waitForTimeout(800);

    const base = await page.evaluate(() => ({
      rows: document.querySelectorAll("#rows .row").length,
      stored: JSON.parse(localStorage.getItem("standort-demo-v1") || "[]").length,
      zoomControl: document.querySelectorAll(".leaflet-control-zoom").length,
      legend: document.querySelectorAll(".legend").length,
      markersWithoutIcon: document.querySelectorAll(".map-marker:not(:has(svg))").length,
      markerTypes: [...new Set([...document.querySelectorAll(".map-marker")]
        .map((node) => [...node.classList].find((name) => name.startsWith("marker-"))))]
    }));
    assert(base.rows === 83 && base.stored === 83, "83 aktive Seed-Einträge erwartet.");
    assert(base.zoomControl === 0, "Leaflet-Zoomknöpfe sind noch sichtbar.");
    assert(base.legend === 0, "Die alte Kartenlegende ist noch sichtbar.");
    assert(base.markerTypes.length >= 3 && base.markersWithoutIcon === 0,
      "Vorhandene Kategorien werden nicht durchgehend als Icons gerendert.");

    await page.evaluate(() => {
      const key = "standort-demo-v1";
      const list = JSON.parse(localStorage.getItem(key) || "[]");
      list.push({
        id: "11111111-2222-4333-8444-555555555555",
        name: "Test Weihnachtsmarkt Lugano",
        category: "markt",
        city: "Lugano",
        country: "Schweiz",
        lat: 46.0037,
        lng: 8.9511,
        dates_text: "26. November 2026 – 6. Januar 2027",
        event_start: "2026-11-26",
        event_end: "2027-01-06",
        deadline: "2026-07-26",
        deadline_text: "Bewerbung bis 26. Juli",
        status: "offen",
        link: "https://luganoeventi.ch/it/partecipare-mercati-lugano/",
        contact: "",
        note: "Recherchetest",
        cost: "",
        archived: false,
        is_suggestion: true,
        source: "Offizielle Quelle · https://luganoeventi.ch/it/partecipare-mercati-lugano/",
        updated_at: "2026-07-23T09:00:00.000Z"
      });
      localStorage.setItem(key, JSON.stringify(list));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#app:not([hidden])");
    await page.locator('[data-pool="vorschlag"]').click();
    await page.waitForTimeout(200);
    const proposal = await page.evaluate(() => ({
      count: document.querySelector("#suggestionCount").textContent.trim(),
      rows: document.querySelectorAll("#rows .row").length,
      deadlineHidden: document.querySelector("#deadlineStrip").hidden,
      marker: document.querySelectorAll(".map-marker.is-suggestion.marker-markt svg").length,
      badge: document.querySelector(".suggestion-badge")?.textContent.trim()
    }));
    assert(proposal.count === "1" && proposal.rows === 1, "Vorschlagspool/-zähler stimmt nicht.");
    assert(proposal.deadlineHidden, "Vorschläge erscheinen im aktiven Deadline-Streifen.");
    assert(proposal.marker === 1 && proposal.badge === "Vorschlag", "Vorschlagsdarstellung fehlt.");

    await page.locator("#btnListMode").click();
    await page.locator("#rows .row").click();
    await page.waitForTimeout(500);
    const listDetail = await page.evaluate(() => ({
      mapDisplay: getComputedStyle(document.querySelector(".panel-map")).display,
      listWidth: Math.round(document.querySelector(".panel-list").getBoundingClientRect().width),
      detailWidth: Math.round(document.querySelector("#detail").getBoundingClientRect().width),
      workspacePaddingRight: getComputedStyle(document.querySelector(".workspace")).paddingRight,
      scrimBackground: getComputedStyle(document.querySelector("#scrim")).backgroundColor,
      noteEditable: !!document.querySelector("#quickNote"),
      sourceLinked: document.querySelectorAll(".kv-row a[href^='https://luganoeventi.ch']").length
    }));
    assert(listDetail.mapDisplay === "none", "Karte bleibt in der grossen Liste sichtbar.");
    assert(listDetail.listWidth > 900 && listDetail.detailWidth === 440, "Liste/Detail-Aufteilung stimmt nicht.");
    assert(listDetail.workspacePaddingRight === "440px", "Detail reserviert rechts keinen Platz.");
    assert(listDetail.scrimBackground === "rgba(0, 0, 0, 0)", "Desktop-Detail dunkelt die App ab.");
    assert(listDetail.noteEditable && listDetail.sourceLinked >= 1,
      "Direkte Notiz oder sichere Quelle fehlt: " + JSON.stringify(listDetail));
    await page.screenshot({ path: path.join(visualDir, "windrose-list-detail.png") });

    await page.locator("#quickNote").fill("Direkte Notiz funktioniert");
    await page.locator('[data-act="save-note"]').click();
    await page.waitForTimeout(200);
    const savedNote = await page.evaluate(() => JSON.parse(localStorage.getItem("standort-demo-v1"))
      .find((item) => item.id === "11111111-2222-4333-8444-555555555555").note);
    assert(savedNote === "Direkte Notiz funktioniert", "Direkte Notiz wurde nicht gespeichert.");

    await page.locator('[data-act="adopt"]').click();
    await page.waitForTimeout(500);
    const adopted = await page.evaluate(() => {
      const item = JSON.parse(localStorage.getItem("standort-demo-v1"))
        .find((entry) => entry.id === "11111111-2222-4333-8444-555555555555");
      return { isSuggestion: item.is_suggestion, count: document.querySelector("#suggestionCount").textContent.trim() };
    });
    assert(adopted.isSuggestion === false && adopted.count === "0", "Übernehmen verschiebt den Vorschlag nicht.");

    await page.locator('[data-pool="aktiv"]').click();
    await page.locator("#filterMenu > summary").click();
    await page.locator("#countryOptions .country-option", { hasText: "Schweiz" }).locator("input").check();
    await page.locator("#countryOptions .country-option", { hasText: "Frankreich" }).locator("input").check();
    await page.locator(".filter-facet").nth(1).locator("summary").click();
    await page.locator("#catFilters").locator('input[data-cat="festival"]').uncheck();
    await page.locator("#catFilters").locator('input[data-cat="messe"]').uncheck();
    await page.locator("#catFilters").locator('input[data-cat="sonstiges"]').uncheck();
    await page.locator(".filter-facet").nth(2).locator("summary").click();
    await page.locator("#statusFilters").locator('input[data-status="beworben"]').uncheck();
    await page.locator("#statusFilters").locator('input[data-status="wartet"]').uncheck();
    await page.locator("#statusFilters").locator('input[data-status="zugesagt"]').uncheck();
    await page.locator("#statusFilters").locator('input[data-status="abgesagt"]').uncheck();
    await page.locator("#sort").selectOption("country");
    await page.waitForTimeout(200);
    const facet = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#rows .row")];
      return {
        summary: document.querySelector("#countrySummary").textContent.trim(),
        selected: document.querySelectorAll("#countryOptions input:checked").length,
        categories: document.querySelectorAll("#catFilters input:checked").length,
        statuses: document.querySelectorAll("#statusFilters input:checked").length,
        activeGroups: document.querySelector("#activeFilterCount").textContent.trim(),
        rows: rows.length,
        onlySelected: rows.every((row) => /Schweiz|Frankreich/.test(row.querySelector(".row-meta")?.innerText || "")),
        onlyMarkets: rows.every((row) => row.classList.contains("row-markt")),
        onlyOpenOrMissed: rows.every((row) => /Offen|Verpasst/.test(row.querySelector(".status-badge")?.textContent || "")),
        sort: document.querySelector("#sort").value
      };
    });
    assert(facet.summary === "2 Länder" && facet.selected === 2 && facet.rows > 1 && facet.onlySelected,
      "Länder-Mehrfachfilter stimmt nicht.");
    assert(facet.categories === 1 && facet.statuses === 2 && facet.activeGroups === "3" &&
      facet.onlyMarkets && facet.onlyOpenOrMissed, "Art-/Status-Mehrfachfilter stimmt nicht.");
    assert(facet.sort === "country", "Sortierung nach Land wurde nicht gesetzt.");
    await page.screenshot({ path: path.join(visualDir, "windrose-filter-menu.png") });

    await page.locator("#filterClear").click();
    await page.locator("#filterMenu > summary").click();
    if ((await page.locator("#btnListMode").getAttribute("aria-pressed")) === "true") {
      await page.locator("#btnListMode").click();
    }
    await page.waitForTimeout(350);
    await page.locator("#rows .row").first().click();
    await page.waitForTimeout(750);
    const mapDetail = await page.evaluate(() => ({
      zoom: window.SO.map.getMap().getZoom(),
      detailOpen: document.querySelector("#detail").classList.contains("is-open"),
      listVisible: getComputedStyle(document.querySelector(".panel-list")).display !== "none"
    }));
    assert(mapDetail.zoom >= 11 && mapDetail.detailOpen && mapDetail.listVisible,
      "Marker-Zoom oder Desktop-Detailansicht stimmt nicht.");
    await page.screenshot({ path: path.join(visualDir, "windrose-desktop.png") });
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await mobile.addInitScript(configOverride);
    const mpage = await mobile.newPage();
    mpage.on("pageerror", (error) => errors.push("Mobile pageerror: " + error.message));
    mpage.on("console", (message) => {
      if (message.type() === "error") errors.push("Mobile console: " + message.text());
    });
    await mpage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await mpage.waitForSelector("#app:not([hidden])");
    await mpage.locator('[data-tab="list"]').click();
    await mpage.locator("#filterMenu > summary").click();
    await mpage.locator("#countryOptions .country-option", { hasText: "Schweiz" }).locator("input").check();
    await mpage.locator("#filterMenu > summary").click();
    await mpage.locator("#rows .row").first().click();
    await mpage.waitForTimeout(350);
    const mobileState = await mpage.evaluate(() => ({
      current: document.querySelector('[data-tab="list"]').getAttribute("aria-current"),
      country: document.querySelector("#countrySummary").textContent.trim(),
      detailModal: document.querySelector("#detail").getAttribute("aria-modal"),
      noteEditable: !!document.querySelector("#quickNote"),
      mapDisplay: getComputedStyle(document.querySelector(".panel-map")).display
    }));
    assert(mobileState.current === "true" && mobileState.country === "Schweiz",
      "Mobile Listen-/Länderansicht stimmt nicht.");
    assert(mobileState.detailModal === "true" && mobileState.noteEditable && mobileState.mapDisplay === "none",
      "Mobiles Detail-Sheet stimmt nicht.");
    await mpage.screenshot({ path: path.join(visualDir, "windrose-mobile.png") });
    await mobile.close();

    // Browser dürfen externe Font-/Tile-Ressourcen blockieren; echte JS-Fehler
    // und App-Console-Fehler bleiben aber ein harter Testfehler.
    assert(errors.length === 0, errors.join("\n"));
    console.log(JSON.stringify({ ok: true, base, proposal, listDetail, facet, mapDetail, mobileState }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
