# StandOrt — Hinweise für Claude Code

Kurze Orientierung für künftige Sessions an dieser App (Leandra & Arno,
Studio Arno). Antworten bitte auf Deutsch, knapp.

## Was das ist
Statische Web-App (kein Build, kein npm, keine node_modules) für GitHub Pages.
Standorte (Festivals, Märkte, Messen) auf **Karte + Liste** mit Fristen und
Status. Datenspeicher: **Supabase**. Ohne Zugangsdaten in `config.js` läuft
alles im **Demo-Modus** (localStorage + `seed.js`).

## Dateien
- `index.html` — Gerüst · `styles.css` — Design
- `app.js` — UI/Logik · `map.js` — Leaflet · `data.js` — Store (Demo/Supabase)
- `config.js` — Supabase-URL + anon-Key (leer = Demo)
- `seed.js` — Beispieldaten (auch Quelle für `db/seed.sql`)
- `db/setup.sql`, `db/seed.sql` — Supabase-Setup (idempotent)
- `studio_arno_vertrieb-7.html` — alter Prototyp, **nicht anfassen**, nur Referenz

## Änderungen ansehen / testen
```bash
python3 -m http.server 8123   # dann http://localhost:8123 öffnen
```
Immer über diesen kleinen Server öffnen, nicht per `file://`.
Vor jedem Push kurz testen: lädt die Seite, keine Fehler in der Browser-Konsole?

## Regeln
- **Keine Geheimnisse ins Repo** — Ausnahme: der öffentliche `anon`-Key in
  `config.js` ist erlaubt (RLS schützt die Daten). Niemals `service_role`-Key
  oder Passwörter committen.
- Alle vom Nutzer eingegebenen Texte beim Rendern **escapen** (Helfer `SO.esc`
  in `data.js`). Kein rohes `innerHTML` mit ungeprüften Strings.
- Nullwerte bei Daten (deadline/event_start …) überall berücksichtigen;
  Datumsparsing zeitzonensicher (`+"T00:00:00"`).
- Supabase-Aufrufe immer mit Fehlerbehandlung → deutsche Meldung via `SO.toast`.
- Schema-Änderungen: `db/setup.sql` **idempotent** halten (mehrfach ausführbar).
  Migrationen nicht automatisch anwenden — als SQL-Datei bereitstellen.
- `seed.js` und `db/seed.sql` müssen zusammenpassen (gleiche IDs). Wird
  `seed.js` geändert, `db/seed.sql` entsprechend nachziehen.

## Vor dem Veröffentlichen
Über **GitHub Desktop** committen und pushen. Erst testen, dann pushen — die
öffentliche Seite (GitHub Pages, `main` / root) aktualisiert sich danach selbst.

## Betrieb & Rollen (wichtig für Sessions mit Leandra oder Arno)
- **Live-App:** https://kaiotoday.github.io/standort/ — Login mit der eigenen
  E-Mail, der 6-stellige Code kommt per Mail. Einträge, Status, PDFs: alles
  direkt in der App, dafür braucht es weder GitHub noch Supabase.
- **Admin ist Kaio.** GitHub-Repo (`kaiotoday/standort`) und das
  Supabase-Projekt gehören ihm. Diese Dinge in Sessions mit Leandra/Arno
  **nie** anfassen oder zu ändern versuchen — stattdessen sagen:
  «Das macht Kaio, schreib ihm kurz.» Konkret betrifft das:
  - neue E-Mail-Adresse für den Login freischalten
  - alles im Supabase-Dashboard (Datenbank, Auth-Einstellungen, Storage)
  - GitHub-Einstellungen (Pages, Secrets, Collaborators)
- **Code-Änderungen** (neue Funktionen, Design, Texte) dürfen Leandra & Arno
  mit Claude Code machen: ändern → lokal testen (siehe oben) → über GitHub
  Desktop committen und pushen. Die Live-Seite aktualisiert sich von selbst.
- Die Datenbank wird von einem automatischen wöchentlichen Ping wachgehalten
  (GitHub Action `keepalive.yml`) — nichts zu tun.
- Wenn die App «Verbindung zum Server fehlgeschlagen» zeigt: zuerst eigenes
  Internet prüfen, dann Kaio Bescheid geben (Supabase-Projekt könnte pausiert
  sein).
