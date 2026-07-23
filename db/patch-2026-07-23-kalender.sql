-- Windrose — Besuchsplanung für die Kalenderansicht
-- Im Supabase SQL Editor einmal ausführen. Idempotent.

alter table public.entries add column if not exists visit_start date;
alter table public.entries add column if not exists visit_end   date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entries_visit_order'
  ) then
    alter table public.entries add constraint entries_visit_order
      check (visit_end is null or visit_start is null or visit_end >= visit_start);
  end if;
end $$;

create index if not exists entries_visit_idx
  on public.entries(visit_start)
  where visit_start is not null;

-- Bestehende breite Grants zuerst entfernen; RLS bleibt weiterhin aktiv.
revoke insert, update on public.entries from authenticated;

grant insert (
  name, category, city, country, lat, lng, dates_text, event_start, event_end,
  deadline, deadline_text, status, link, contact, note, cost, visit_start,
  visit_end, archived, is_suggestion
) on public.entries to authenticated;

grant update (
  name, category, city, country, lat, lng, dates_text, event_start, event_end,
  deadline, deadline_text, status, link, contact, note, cost, visit_start,
  visit_end, archived, is_suggestion
) on public.entries to authenticated;
