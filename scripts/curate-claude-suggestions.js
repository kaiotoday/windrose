#!/usr/bin/env node
"use strict";

/*
 * Einmalige, aber idempotente Bereinigung des Claude-Imports vom 23.07.2026.
 * Entfernt Vorschläge, die bereits in seed.js vorhanden sind, löst zwei
 * Dubletten innerhalb des Imports auf und nimmt den fälschlich verworfenen
 * Weihnachtsmarkt Lugano wieder auf. Hält SQL und Review-Datei synchron.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sqlPath = path.join(root, "db", "suggestions.sql");
const reviewPath = path.join(root, "db", "suggestions-review.md");

const REMOVE_IDS = new Set([
  "4fc0f0d4-5d73-5e0d-9b49-4b09860efa6d", // Ambiente Frankfurt
  "e1f6c3a7-0387-5530-aaf7-f9c31496ff72", // Kunst- und Designmarkt Konstanz
  "34fc246d-358d-5979-87f4-a6941a7b9dc1", // GRASSIMESSE Leipzig
  "c6c1382d-1f80-5669-9f34-83e13eca7c3f", // INHORGENTA München
  "49792735-4a42-5271-9515-e2ccdedd2e98", // Formland Herning
  "3d3e078c-68a4-5fee-8252-7cc2f888cdb6", // Tuomaan Markkinat
  "2c55ef71-53b1-55d0-bf83-b6d07001ebdf", // Salon Résonances
  "2e26558a-b22e-5e9c-8830-4da1e860014f", // Maison&Objet Paris
  "3b2c378e-3d6d-5d4e-be2a-92cacf42bb9c", // Handmade Chelsea
  "e13a79ec-836e-58fd-a3b0-469133778c49", // GNCCF Manchester
  "7825ab1d-d8fd-5fe7-a473-76c9a54795a5", // Boomtown
  "5b18f53e-7cba-5529-b68c-54673ac274c2", // Artigiano in Fiera
  "3f04e461-f1dc-5246-824f-b36b8c429174", // VICENZAORO
  "ffe7aa5f-6305-5149-aba0-f8b1a656ca06", // Zagreb Design Week
  "88f282aa-c537-590e-859d-b260c10c95b9", // Sunday Market Amsterdam
  "cdaf0d90-4aa9-53ef-9d36-2f3681ebccbe", // Castlefest
  "5b9fd134-3797-5bfa-a406-2cf70d0b9a50", // Formex Design Talents
  "6a27369c-08d4-5699-988e-ea9f270fba81", // Formex Stockholm
  "33354c00-690d-5aad-b314-3786c6264c69", // Luzerner Handwerksmarkt
  "7ff66ed5-7f18-53a3-b7b9-e57ec8e94f15", // Rudolfs Weihnacht
  "d13c5f33-8e19-5eb1-acad-d0f2a953cbb8", // ARTish Ljubljana
  "8f398e2e-eb94-54f9-95f8-2302792c9425", // MadridJoya
  "a2679db7-8111-5754-8cbf-30eeccd095d8", // Designblok
  "3c3a18db-eb03-5d45-ba19-b8d1ccbcc529", // Dyzajn Praha
  "72a3d882-50ae-5d3b-8384-90f036ad1138", // Kunst- & Designmarkt Innsbruck
  "3438377f-8870-512a-a1c1-203e7875e427", // Edelstoff
  "4d78b901-bd92-5bc8-a446-fa23eddf6051", // O.Z.O.R.A. intern doppelt
  "9092bb3e-d3e7-5a7d-907f-234d07760888"  // Meraner Weihnacht intern doppelt
]);

const INTERNAL_DUPLICATES = new Set([
  "4d78b901-bd92-5bc8-a446-fa23eddf6051",
  "9092bb3e-d3e7-5a7d-907f-234d07760888"
]);

const LUGANO_ID = "7eced5fb-3fa6-4fa2-b2af-8a274d927117";
const LUGANO_ROW =
  "  ('" + LUGANO_ID + "', 'Mercatino di Natale in Piazza Lugano', 'markt', 'Lugano', 'Schweiz', 46.0037, 8.9511, '26. November 2026 – 6. Januar 2027', '2026-11-26', '2027-01-06', '2026-07-26', 'Bewerbung spätestens 26. Juli 2026 (einschliesslich) über das offizielle Online-Formular oder per Papierformular', 'offen', 'https://luganoeventi.ch/it/partecipare-mercati-lugano/', null, 'Offizieller Weihnachtsmarkt im Stadtzentrum von Lugano. Die Ausschreibung ist nicht dieselbe Veranstaltung wie der wöchentliche Antiquitäten- und Kunsthandwerksmarkt, obwohl beide auf derselben städtischen Informationsseite stehen.', null, false, true, 'Recherche geprüft 23.07.2026 · offizielle Stadtseite · https://luganoeventi.ch/it/partecipare-mercati-lugano/'),";

function parseTuple(line) {
  let text = line.trim().replace(/,$/, "");
  if (!text.startsWith("(") || !text.endsWith(")")) return null;
  text = text.slice(1, -1);
  const values = [];
  let token = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === "'" && text[i + 1] === "'") {
        token += "'";
        i++;
      } else if (ch === "'") {
        quoted = false;
      } else {
        token += ch;
      }
    } else if (ch === "'") {
      quoted = true;
    } else if (ch === ",") {
      values.push(coerce(token.trim()));
      token = "";
    } else {
      token += ch;
    }
  }
  values.push(coerce(token.trim()));
  return values;
}

function coerce(value) {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function tupleLines(sql) {
  return sql.split("\n").filter((line) => /^\s*\('/.test(line));
}

function entriesFrom(sql) {
  return tupleLines(sql).map(parseTuple).filter(Boolean).map((v) => ({
    id: v[0], name: v[1], category: v[2], city: v[3], country: v[4],
    deadline: v[10], deadlineText: v[11], link: v[13], source: v[19]
  }));
}

function sourceSegment(source) {
  const match = String(source || "").match(/·\s*([^·]+?)(?:\s*·|$)/);
  return match ? match[1].trim() : "claude-import";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let sql = fs.readFileSync(sqlPath, "utf8");
const beforeEntries = entriesFrom(sql);
const removedEntries = beforeEntries.filter((entry) => REMOVE_IDS.has(entry.id));

let lines = sql.split("\n");
lines = lines.filter((line) => {
  const tuple = /^\s*\('/.test(line) ? parseTuple(line) : null;
  return !tuple || !REMOVE_IDS.has(tuple[0]);
});

if (!lines.some((line) => line.includes(LUGANO_ID))) {
  const firstSwiss = lines.findIndex((line) => {
    const tuple = /^\s*\('/.test(line) ? parseTuple(line) : null;
    return tuple && tuple[4] === "Schweiz";
  });
  if (firstSwiss < 0) throw new Error("Schweiz-Block im SQL nicht gefunden.");
  lines.splice(firstSwiss, 0, LUGANO_ROW);
}
sql = lines.join("\n");
fs.writeFileSync(sqlPath, sql);

const entries = entriesFrom(sql);
if (entries.length !== 223) throw new Error(`223 Vorschläge erwartet, gefunden: ${entries.length}`);
if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error("Doppelte UUID im Vorschlags-SQL.");
if (entries.some((entry) => REMOVE_IDS.has(entry.id))) throw new Error("Zu entfernende Dublette ist noch im SQL.");

const countryCounts = new Map();
for (const entry of entries) countryCounts.set(entry.country, (countryCounts.get(entry.country) || 0) + 1);
if (countryCounts.size !== 24) throw new Error(`24 Länder erwartet, gefunden: ${countryCounts.size}`);

let review = fs.readFileSync(reviewPath, "utf8");
for (const entry of removedEntries) {
  const pattern = new RegExp("^[-] \\*\\*" + escapeRegExp(entry.name) + "\\*\\*.*(?:\\n|$)", "m");
  review = review.replace(pattern, "");
}

// Der Weihnachtsmarkt war wegen der gemeinsamen städtischen Übersichts-URL
// fälschlich als Dublette des Wochenmarkts verworfen worden.
review = review.replace(/^[-] `ch-romandie-tessin` — Mercatino di Natale di Lugano.*(?:\n|$)/m, "");
if (!review.includes("**Mercatino di Natale in Piazza Lugano**")) {
  const anchor = /^- \*\*Mercato dell'artigianato e dell'usato\/antiquariato di Lugano\*\*.*$/m;
  const luganoBullet = "- **Mercatino di Natale in Piazza Lugano** (markt) · Lugano · Frist: 2026-07-26 · [Link](https://luganoeventi.ch/it/partecipare-mercati-lugano/)";
  review = review.replace(anchor, (line) => line + "\n" + luganoBullet);
}

// Nach dem Abgleich sind die einzigen leeren Länderabschnitte Slowenien und
// Tschechien; ihre Veranstaltungen liegen bereits im aktiven Seed.
review = review.replace(/\n## (Slowenien|Tschechien)\n\n(?=## )/g, "\n");

const sortedCountries = [...countryCounts.entries()].sort((a, b) =>
  b[1] - a[1] || a[0].localeCompare(b[0], "de")
);
const table = ["| Land | Anzahl |", "|---|---|", ...sortedCountries.map(([country, count]) => `| ${country} | ${count} |`)].join("\n");
review = review.replace(
  /Recherche vom 23\.07\.2026 · \*\*\d+ Vorschläge\*\* aus 20 Segmenten\.\n\n\| Land \| Anzahl \|[\s\S]*?\n\n(?=## )/,
  `Recherche vom 23.07.2026 · **223 Vorschläge** aus 20 Segmenten und 24 Ländern.\n\n${table}\n\n`
);

const rejectLines = [];
for (const entry of removedEntries) {
  const reason = INTERNAL_DUPLICATES.has(entry.id)
    ? "Dublette innerhalb des Imports; vollständigeren Vorschlag behalten"
    : "bereits als aktiver Eintrag in seed.js vorhanden";
  rejectLines.push(`- \`${sourceSegment(entry.source)}\` — ${entry.name}${entry.city ? " · " + entry.city : ""} — ${reason}`);
}
const existingRejects = review.match(/## Verworfen \(\d+\)\n\n([\s\S]*)$/);
if (!existingRejects) throw new Error("Verworfen-Abschnitt im Review nicht gefunden.");
let rejectedBody = existingRejects[1].trimEnd();
for (const line of rejectLines) {
  const eventName = line.replace(/^- `[^`]+` — /, "").split(" · ")[0].split(" — ")[0];
  if (!rejectedBody.includes("— " + eventName)) rejectedBody += "\n" + line;
}
const rejectedCount = rejectedBody.split("\n").filter((line) => line.startsWith("- ")).length;
review = review.replace(/## Verworfen \(\d+\)\n\n[\s\S]*$/, `## Verworfen (${rejectedCount})\n\n${rejectedBody}\n`);

fs.writeFileSync(reviewPath, review);

const reviewMain = review.split(/\n## Verworfen \(/)[0];
const reviewEntryCount = (reviewMain.match(/^- \*\*/gm) || []).length;
if (reviewEntryCount !== 223) throw new Error(`Review enthält ${reviewEntryCount} statt 223 Vorschläge.`);
// GRASSIMESSE und Artigiano standen bereits im ursprünglichen Verworfen-Block
// und zugleich nochmals in den 250 SQL-Zeilen. Deshalb sind es 36 eindeutige
// verworfene Kandidaten, obwohl 28 SQL-Zeilen entfernt wurden.
if (rejectedCount !== 36) throw new Error(`Review enthält ${rejectedCount} statt 36 verworfene Vorschläge.`);

const futureDeadlineCount = entries.filter((entry) => entry.deadline && entry.deadline >= "2026-07-23").length;
if (futureDeadlineCount !== 18) throw new Error(`18 offene Fristen erwartet, gefunden: ${futureDeadlineCount}`);

console.log(`OK: ${entries.length} Vorschläge, ${countryCounts.size} Länder, ${futureDeadlineCount} offene Fristen, ${rejectedCount} verworfen.`);
