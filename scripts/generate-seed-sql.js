#!/usr/bin/env node
"use strict";

// Hält db/seed.sql mechanisch mit seed.js synchron. Keine Abhängigkeiten nötig:
//   node scripts/generate-seed-sql.js

var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "..");
var entries = require(path.join(root, "seed.js"));

var columns = [
  "id", "name", "category", "city", "country", "lat", "lng", "dates_text",
  "event_start", "event_end", "deadline", "deadline_text", "status", "link",
  "contact", "note", "cost", "archived", "created_by", "updated_by"
];

function sqlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Ungültige Zahl im Seed: " + value);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

var seenIds = new Set();
var seenSlugs = new Set();
var categories = new Set(["festival", "markt", "messe", "sonstiges"]);
var statuses = new Set(["offen", "beworben", "wartet", "zugesagt", "abgesagt"]);

function validDate(value) {
  if (value === null || value === undefined) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var date = new Date(value + "T00:00:00");
  var parts = value.split("-").map(Number);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === parts[0] &&
    date.getMonth() === parts[1] - 1 && date.getDate() === parts[2];
}

entries.forEach(function (entry) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.id)) {
    throw new Error("Ungültige UUID: " + entry.id);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)) throw new Error("Ungültiger Slug: " + entry.slug);
  if (seenIds.has(entry.id)) throw new Error("Doppelte Seed-ID: " + entry.id);
  if (seenSlugs.has(entry.slug)) throw new Error("Doppelter Seed-Slug: " + entry.slug);
  if (!entry.name || !entry.country) throw new Error("Name/Land fehlt bei: " + entry.slug);
  if (!categories.has(entry.category)) throw new Error("Ungültige Kategorie bei: " + entry.slug);
  if (!statuses.has(entry.status)) throw new Error("Ungültiger Status bei: " + entry.slug);
  if (!Number.isFinite(entry.lat) || entry.lat < -90 || entry.lat > 90 ||
      !Number.isFinite(entry.lng) || entry.lng < -180 || entry.lng > 180) {
    throw new Error("Ungültige Koordinaten bei: " + entry.slug);
  }
  ["event_start", "event_end", "deadline"].forEach(function (field) {
    if (!validDate(entry[field])) throw new Error("Ungültiges " + field + " bei: " + entry.slug);
  });
  if (entry.event_start && entry.event_end && entry.event_end < entry.event_start) {
    throw new Error("Terminende vor Terminbeginn bei: " + entry.slug);
  }
  if (entry.link && !/^https?:\/\//i.test(entry.link)) throw new Error("Ungültiger Link bei: " + entry.slug);
  seenIds.add(entry.id);
  seenSlugs.add(entry.slug);
});

var rows = entries.map(function (entry) {
  var row = Object.assign({ created_by: "seed", updated_by: "seed" }, entry);
  return "  (" + columns.map(function (column) { return sqlValue(row[column]); }).join(", ") + ")";
});

var sql = [
  "-- Windrose — Seed-Daten (idempotent)",
  "-- Generiert aus seed.js mit: node scripts/generate-seed-sql.js",
  "-- Nach db/setup.sql im Supabase SQL-Editor ausführen.",
  "-- Erneutes Ausführen ist gefahrlos: bestehende Zeilen (gleiche id) bleiben",
  "-- unverändert, deine eigenen Bearbeitungen werden NICHT überschrieben.",
  "",
  "insert into public.entries (",
  "  " + columns.join(", "),
  ") values",
  rows.join(",\n"),
  "on conflict (id) do nothing;",
  "",
  "-- ---------------------------------------------------------------------------",
  "-- Reparatur bereits geseedeter Zeilen: Bei sechs Einträgen war ein",
  "-- Bewerbungs-START fälschlich als deadline gespeichert. Nur korrigieren, wenn",
  "-- die deadline noch exakt dem falschen Wert entspricht (eigene Bearbeitungen",
  "-- bleiben unangetastet). Idempotent, mehrfach ausführbar.",
  "-- ---------------------------------------------------------------------------",
  "update public.entries set deadline = null where id = '8df2cb08-cfb8-5dca-b479-13729230e2f8' and deadline = '2027-03-01'; -- One Love Festival",
  "update public.entries set deadline = null where id = '4fd33ca8-8331-5637-a9b0-5915753bdebf' and deadline = '2027-04-01'; -- Weihnachtsmarkt Strasbourg",
  "update public.entries set deadline = null where id = '69e317e9-0674-52c9-9b8b-08ae2b422ad0' and deadline = '2027-03-15'; -- Weihnachtsmärkte Colmar",
  "update public.entries set deadline = null where id = 'faa7184f-791b-5157-ab45-d26f156d69ee' and deadline = '2027-01-15'; -- VooV Festival",
  "update public.entries set deadline = null where id = '822a3c02-b3eb-5e57-9e9f-b09e1e7e9894' and deadline = '2026-11-01'; -- Feel Festival",
  "update public.entries set deadline = null where id = '570bb13a-3db6-5e8b-b75c-39fcce19a33b' and deadline = '2026-09-01'; -- Festivalet Markt",
  ""
].join("\n");

fs.writeFileSync(path.join(root, "db", "seed.sql"), sql, "utf8");
console.log("db/seed.sql mit " + entries.length + " Einträgen erzeugt.");
