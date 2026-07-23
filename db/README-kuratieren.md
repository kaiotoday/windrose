# Ansicht „Zu kuratieren" — Import und Bedienung

Stand 23.07.2026. Daten und App-Code sind vorbereitet; nur die beiden SQL-Dateien
müssen noch von Kaio im Supabase-SQL-Editor ausgeführt werden.

## 1. SQL ausführen (Kaio, im Supabase-SQL-Editor, in dieser Reihenfolge)

1. `db/patch-2026-07-23-kuratieren.sql` — legt die Spalten `is_suggestion`
   (boolean, default false) und `source` (text) an, plus einen Index. Idempotent.
2. `db/suggestions.sql` — 223 bereinigte, recherchierte Vorschläge, alle mit
   `is_suggestion = true`, `archived = false`, `status = 'offen'`.
   Feste UUIDs + `on conflict (id) do nothing` → mehrfach ausführbar,
   überschreibt keine Kuratier-Entscheidungen.

Übersicht zum Drüberschauen: `db/suggestions-review.md` (nach Ländern sortiert,
mit Fristen und Links; am Ende die 36 eindeutig verworfenen Kandidaten mit
Grund). 28 Dubletten wurden aus Claudes ursprünglichen 250 SQL-Zeilen entfernt;
der fälschlich als Dublette behandelte Weihnachtsmarkt Lugano wurde ergänzt.

## 2. Was in der App umgesetzt ist

Der Umschalter `#archivToggle` hat jetzt drei Arbeitsbereiche:

| Ansicht | Filter |
|---|---|
| Aktiv | `!is_suggestion && !archived` |
| Zu kuratieren | `is_suggestion && !archived` |
| Archiv | `archived` |

Zusätzlich umgesetzt:

- „Zu kuratieren" mit Anzahl, Vorschlags-Badge und eigener Marker-Darstellung.
- „Übernehmen" setzt `is_suggestion = false` mit Versionsstempel;
  „Verwerfen" archiviert den Vorschlag.
- Vorschläge erscheinen bewusst **nicht** im Deadline-Streifen der aktiven
  Arbeitsliste.
- `source` wird nur angezeigt, sicher escaped/verlinkt und bleibt im Browser
  nicht beschreibbar.
- Ein gemeinsames Shop-Filtermenü bietet aufklappbare Mehrfachauswahl für Land,
  Art und Status; „Nach Land" bleibt separat und sortiert nach Land, Stadt, Name.
- Die Liste kann auf Desktop grossgeschaltet werden; bei offenem Detail bleibt
  sie links sichtbar. Notizen sind direkt im Detail bearbeitbar.
- Kartenmarker zeigen zusätzlich ein Kategorie-Icon.

Achtung: `source` im Detail-Panel nur über `SO.esc` rendern, Links über
`SO.safeUrl` — es sind maschinell recherchierte Fremddaten.

## 3. Was die Daten hergeben

223 Vorschläge aus 20 Recherche-Segmenten, ganz Europa: CH, DE, AT, LI, FR, ES,
PT, IT, NL, BE, LU, UK, IE, DK, SE, NO, FI, IS, PL, HU, HR, RO, LV, SK.
18 haben eine echte, noch offene Bewerbungsfrist — die nächsten:

| Frist | Was | Wo |
|---|---|---|
| 26.07.2026 | Mercatino di Natale | Lugano |
| 31.07.2026 | Noël au Quai | Genf |
| 31.07.2026 | KunstWerkTage | Steinmaur ZH |
| 31.07.2026 | Feria Tricontinental de Artesanía | Teneriffa |
| 15.08.2026 | Kreativmarkt Kap.8 | Münster |
| 01.09.2026 | Vaduzer Weihnachtsmarkt | Vaduz |

Fristen, die zum Recherchezeitpunkt schon vorbei waren, stehen bewusst **nicht**
im Feld `deadline` (sonst rot als „abgelaufen"), sondern als Hinweistext in
`deadline_text` — inklusive Originaldatum. Unsichere Angaben sind im `note`-Feld
mit „Angaben teils unbestätigt" bzw. „Angaben unsicher" markiert.

`Artigiano in Fiera` ist bereits im aktiven Seed und wurde dort mit dem
Frühbucher-Stichtag 31.07.2026 sowie dem direkten Ausstellerkontakt ergänzt.
