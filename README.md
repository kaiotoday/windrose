# Windrose

**Studio Arno · Märkte, Festivals & Messen**

Eine kleine, gemeinsam nutzbare Web-App, mit der Leandra und Arno mögliche
Verkaufs-Standorte in Europa sammeln: Festivals, Märkte und Messen — auf einer
**Karte** und in einer **Liste**, mit **Bewerbungsfristen** und **Bewerbungs-Status**.

Die App ist eine reine statische Seite (kein Build, kein Node-Projekt) und läuft
auf **GitHub Pages**. Als Datenspeicher dient **Supabase** (geteilt zwischen euch
beiden). Solange kein Supabase eingetragen ist, läuft alles im **Demo-Modus**
lokal im Browser mit Beispieldaten.

---

## Was kann die App?

- **Karte + Liste** mit Umschalten (unten die Tab-Leiste am Handy, nebeneinander am Laptop).
- **Marker nach Kategorie** eingefärbt (Festival, Markt, Messe, Sonstiges) mit
  Ring-Markierung für dringende Fristen (diesen Monat = orange, abgelaufen = rot).
- **Detail-Ansicht** je Eintrag mit allen Infos, Status ändern, Bearbeiten,
  Archivieren, Löschen sowie „In Google/Apple Maps öffnen".
- **Neuer Eintrag** mit drei Wegen, die Position zu setzen: Ort suchen,
  auf der Karte tippen oder einen Maps-Link / Koordinaten einfügen.
- **Filter** nach Kategorie, Status und freier Suche; Sortierung nach Deadline,
  Termin oder Name; ein Streifen „Nächste Deadlines" ganz oben.
- **Archiv** mit Wiederherstellen.
- **Geteilt in Echtzeit**: Änderungen der anderen Person erscheinen live (mit Supabase).
- **Anhänge**: PDFs/Bilder pro Eintrag (nur mit Supabase).
- **Zum Homescreen** hinzufügbar (eigener Name + Icon).

---

## Lokal ausprobieren

Die App braucht keinen Build. Am einfachsten mit Python (auf Mac vorinstalliert):

```bash
cd "Leandra - Map thingy"
python3 -m http.server 8123
```

Dann im Browser **http://localhost:8123** öffnen.

> Direkt per Doppelklick auf `index.html` (also `file://…`) funktioniert **nicht**
> zuverlässig — bitte immer über einen kleinen Server öffnen wie oben.

Ohne eingetragenes Supabase startet die App im **Demo-Modus**: Beispieldaten,
alles lokal im Browser gespeichert, kein Login. Ein kleiner Hinweis
„Demo-Modus · nicht geteilt" steht oben rechts.

---

## Änderungen mit GitHub Desktop (für Leandra & Arno)

So spielt ihr Änderungen ein, ohne die Kommandozeile:

1. **GitHub Desktop** öffnen und das Repository auswählen.
2. Vor dem Arbeiten oben auf **„Fetch origin" / „Pull"** klicken, damit ihr die
   neuesten Änderungen der anderen Person habt.
3. Dateien ändern (z.B. mit einem Editor) — oder einfach Inhalte in der laufenden
   App bearbeiten, wenn Supabase eingerichtet ist (dann braucht es dafür **kein** Git).
4. In GitHub Desktop erscheinen die Änderungen links. Unten eine kurze
   **Beschreibung** eintragen und **„Commit to main"** klicken.
5. Oben **„Push origin"** klicken. Nach ein bis zwei Minuten ist die Seite
   auf GitHub Pages aktualisiert.

> **Wichtig:** Vor dem Push kurz lokal testen (siehe oben), damit nichts
> Kaputtes online geht.

---

## GitHub Pages aktivieren (einmalig)

1. Im Repository auf **Settings → Pages**.
2. Bei **„Build and deployment"** als Source **„Deploy from a branch"** wählen.
3. Branch **`main`** und Ordner **`/ (root)`** auswählen, **Save**.
4. Nach kurzer Zeit erscheint oben die öffentliche Adresse
   (z.B. `https://euername.github.io/windrose/`).

---

## Supabase einrichten (damit ihr die Daten teilt)

Ohne diesen Schritt läuft die App im Demo-Modus. Für den geteilten Betrieb:

1. **Projekt anlegen** auf [supabase.com](https://supabase.com) (kostenloser Plan reicht).
2. Im Supabase-Dashboard **SQL Editor** öffnen und den Inhalt von
   **`db/setup.sql`** einfügen und ausführen. Das legt Tabellen, Sicherheits-Regeln
   (RLS), den Storage-Bucket und Realtime an. (Kann gefahrlos mehrfach laufen.)
3. Danach **`db/seed.sql`** ausführen — das füllt die ~30 Beispiel-Standorte ein.
   (Auch mehrfach ausführbar; bestehende Einträge werden nicht überschrieben.)
4. **E-Mails freischalten:** Ganz unten in `db/setup.sql` stehen drei
   auskommentierte Zeilen. Tragt dort eure echten E-Mail-Adressen ein
   (klein geschrieben), Kommentarzeichen `--` entfernen und diese Zeilen im
   SQL Editor ausführen. Nur freigeschaltete Adressen haben Zugriff.
5. **Zugangsdaten holen:** In Supabase unter **Project Settings → API**:
   - **Project URL** (z.B. `https://abcxyz.supabase.co`)
   - **anon public** Key
6. Diese beiden Werte in **`config.js`** eintragen:

   ```js
   window.STANDORT_CONFIG = {
     supabaseUrl: "https://abcxyz.supabase.co",
     supabaseAnonKey: "eyJhbGciOi…"   // der 'anon public' Key
   };
   ```

7. `config.js` committen und pushen (GitHub Desktop). Fertig — beim nächsten
   Öffnen erscheint ein **Login** (E-Mail eingeben → **Anmelde-Link** in der Mail
   auf demselben Gerät anklicken). Danach seht ihr beide dieselben, live geteilten Daten.

> **Sicherheit:** Der `anon`-Key **darf** öffentlich im Repo stehen. Er allein
> gibt keinen Datenzugriff — die RLS-Regeln lassen nur eure freigeschalteten
> E-Mails an die Daten. **Niemals** den `service_role`-Key oder Passwörter ins
> Repo legen.

### E-Mail-Login (Anmelde-Link)

Der Login läuft über einen **Anmelde-Link (Magic Link)**: E-Mail eingeben →
Supabase schickt eine Mail mit einem Link → diesen Link **auf demselben Gerät**
öffnen, und die App meldet einen automatisch an (supabase-js liest die Session
aus der zurückkehrenden URL und räumt die Adresszeile danach auf).

Der Versand läuft über einen **eigenen SMTP-Absender (Resend)** — eingerichtet
unter **Authentication → Emails → Enable custom SMTP** (Host `smtp.resend.com`,
Port `465`, Username `resend`, Passwort = Resend-API-Key). Damit sind eigene
Mail-Vorlagen möglich: In **Authentication → Email Templates** steckt in
**„Confirm signup"** UND **„Magic Link"** dieselbe Vorlage aus
[`db/email-template.html`](db/email-template.html) (Windrose-Look, nur
Anmelde-Button, kein Code), Betreff `Anmelden bei Windrose`.

**Einzige nötige Einstellung:** Unter **Authentication → URL Configuration** die
**Site URL** auf eure GitHub-Pages-Adresse setzen
(z.B. `https://euername.github.io/windrose/`). Sonst zeigen die Anmelde-Links ins
Leere. Die App gibt beim Anmelden zusätzlich die aktuelle Seiten-URL als
`emailRedirectTo` mit.

> Der **Code-Weg ist bewusst deaktiviert** — es gibt nur den Magic-Link. Die
> Code-Logik liegt noch versteckt im Code (`#auth-code-fallback` in
> `index.html`), falls sie je wieder gebraucht wird: Toggle-Button wieder
> einbauen und `{{ .Token }}` in die Mail-Vorlage aufnehmen, mehr braucht es
> nicht.

**Neue Konten sperren (empfohlen):** In `config.js` steht `shouldCreateUser: true`,
damit sich Leandra und Arno **das erste Mal** anmelden (und ihr Konto entsteht)
können. Sobald sich **beide einmal eingeloggt** haben, den Wert auf
`shouldCreateUser: false` setzen und committen — dann kann sich keine fremde
Adresse mehr ein Konto anlegen. Unabhängig davon lässt die App ohnehin nur in
`allowed_users` freigeschaltete Adressen an die Daten (nicht freigeschaltete
werden nach dem Login sofort wieder abgemeldet).

---

## Keepalive (Free-Tier nicht einschlafen lassen)

Supabase pausiert Projekte im kostenlosen Plan nach längerer Inaktivität.
Die Datei **`.github/workflows/keepalive.yml`** pingt darum einmal täglich
automatisch die Supabase-REST-Schnittstelle an (Erfolg nur bei HTTP 2xx, mit
einem zweiten Versuch bei Fehlern).

Damit das funktioniert, im GitHub-Repo unter
**Settings → Secrets and variables → Actions** hinterlegen:

- **Variable** (Reiter „Variables"): `SUPABASE_URL` = eure Project URL
- **Secret** (Reiter „Secrets"): `SUPABASE_ANON_KEY` = euer anon-Key

Fehlen beide, überspringt sich der Job ohne Fehler. Der Ablauf lässt sich unter
**Actions → Supabase Keepalive → Run workflow** auch manuell testen.

---

## Projektstruktur

```
index.html                     App-Gerüst (HTML)
styles.css                     Design (Papier/Tinte, Fraunces + IBM Plex)
config.js                      Supabase-Zugang — leer = Demo-Modus
seed.js                        Beispieldaten (Demo + Quelle für seed.sql)
data.js                        Datenschicht (Demo/localStorage bzw. Supabase)
map.js                         Karte (Leaflet)
app.js                         UI, Filter, Detail, Formular, Login
manifest.json + icon.svg       „Zum Homescreen"-Icon & -Name
db/setup.sql                   Supabase-Schema, RLS, Storage, Realtime
db/seed.sql                    Beispieldaten fürs SQL-Setup
.github/workflows/keepalive.yml Wöchentlicher Supabase-Ping
studio_arno_vertrieb-7.html    Ursprünglicher Prototyp (nur Referenz)
```

Der Prototyp `studio_arno_vertrieb-7.html` bleibt als Referenz liegen und wird
von der App nicht verwendet.
