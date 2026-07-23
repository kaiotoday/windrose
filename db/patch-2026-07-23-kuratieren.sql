-- ============================================================================
-- Windrose — Patch 2026-07-23: Ansicht „Zu kuratieren"
-- ----------------------------------------------------------------------------
-- Im Supabase SQL-Editor ausführen. Idempotent — mehrfaches Ausführen ist
-- gefahrlos. Ändert KEINE bestehenden Daten.
--
-- Was der Patch macht:
--   1. Neue Spalte `is_suggestion` — markiert recherchierte Vorschläge, die noch
--      niemand geprüft hat. Bestehende Einträge bleiben false (= Aktiv).
--   2. Neue Spalte `source` — woher der Vorschlag stammt (Quell-URL / Recherche).
--   3. Index auf die drei Ansichts-Spalten.
--
-- Ansichten in der App danach:
--   Aktiv          → is_suggestion = false und archived = false
--   Zu kuratieren  → is_suggestion = true  und archived = false
--   Archiv         → archived = true
--
-- Danach db/suggestions.sql laufen lassen (die eigentlichen Vorschläge).
-- ============================================================================

alter table public.entries
  add column if not exists is_suggestion boolean not null default false;

alter table public.entries
  add column if not exists source text;

comment on column public.entries.is_suggestion is
  'true = recherchierter Vorschlag, wartet auf Kuratierung. Übernehmen = auf false setzen.';
comment on column public.entries.source is
  'Herkunft des Eintrags (Quell-URL bzw. Recherche-Segment). Nur bei Vorschlägen gefüllt.';

-- Die Liste filtert immer über diese drei Spalten — ein gemeinsamer Index hilft,
-- sobald ein paar hundert Vorschläge drin liegen.
create index if not exists entries_view_idx
  on public.entries (is_suggestion, archived, deadline);

-- RLS: keine neue Policy nötig. `entries_all` aus db/setup.sql deckt alle
-- Spalten der Tabelle ab (for all to authenticated using public.is_allowed()).

-- `source` bleibt admin-seitig: Der Browser darf das Rechercheflag übernehmen,
-- aber weder Quellen noch Auditfelder über die Data API manipulieren. Bestehende
-- breite Grants zuerst entziehen, dann nur die App-Felder freigeben.
revoke insert, update on public.entries from authenticated;
grant insert (
  name, category, city, country, lat, lng, dates_text, event_start, event_end,
  deadline, deadline_text, status, link, contact, note, cost, archived,
  is_suggestion
) on public.entries to authenticated;
grant update (
  name, category, city, country, lat, lng, dates_text, event_start, event_end,
  deadline, deadline_text, status, link, contact, note, cost, archived,
  is_suggestion
) on public.entries to authenticated;
