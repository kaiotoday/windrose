-- ============================================================================
-- Windrose — Supabase Setup (idempotent)
-- ----------------------------------------------------------------------------
-- Im Supabase SQL-Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.
-- Danach db/seed.sql laufen lassen und unten die erlaubten E-Mails eintragen.
-- ----------------------------------------------------------------------------
-- WARNUNG bei NICHT frischem Projekt: RLS-Policies OR-verknüpfen sich. Bereits
-- vorhandene, freizügige Policies (z.B. „for all to public using (true)")
-- öffnen die Daten AUCH DANN, wenn dieses Skript restriktive Policies anlegt.
-- Auf einer bestehenden Datenbank daher zuerst prüfen und ggf. entfernen:
--   select * from pg_policies where schemaname = 'public'
--     and tablename in ('entries','attachments','allowed_users');
-- Ebenso alte, zu weite GRANTs an anon/public auditieren (siehe REVOKE unten).
-- Auf einem frischen Projekt gibt es nichts zu tun.
-- ============================================================================

-- gen_random_uuid()
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.allowed_users (
  email text primary key
);

create table if not exists public.entries (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'sonstiges'
                  check (category in ('festival','markt','messe','sonstiges')),
  city          text,
  country       text,
  lat           double precision not null,
  lng           double precision not null,
  dates_text    text,
  event_start   date,
  event_end     date,
  deadline      date,
  deadline_text text,
  status        text not null default 'offen'
                  check (status in ('offen','beworben','wartet','zugesagt','abgesagt')),
  link          text,
  contact       text,
  note          text,
  cost          text,
  archived      boolean not null default false,
  created_by    text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint entries_lat_range    check (lat between -90 and 90),
  constraint entries_lng_range    check (lng between -180 and 180),
  constraint entries_event_order  check (event_end is null or event_start is null or event_end >= event_start)
);

-- Falls die Tabelle aus einer früheren Version ohne diese CHECKs stammt:
-- Constraints idempotent nachrüsten (nur anlegen, wenn noch nicht vorhanden).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'entries_lat_range') then
    alter table public.entries add constraint entries_lat_range check (lat between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entries_lng_range') then
    alter table public.entries add constraint entries_lng_range check (lng between -180 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entries_event_order') then
    alter table public.entries add constraint entries_event_order
      check (event_end is null or event_start is null or event_end >= event_start);
  end if;
end $$;

-- Falls die Tabelle aus einer früheren Version stammt: fehlende Spalten ergänzen.
alter table public.entries add column if not exists category      text not null default 'sonstiges';
alter table public.entries add column if not exists city          text;
alter table public.entries add column if not exists country       text;
alter table public.entries add column if not exists dates_text    text;
alter table public.entries add column if not exists event_start   date;
alter table public.entries add column if not exists event_end     date;
alter table public.entries add column if not exists deadline      date;
alter table public.entries add column if not exists deadline_text text;
alter table public.entries add column if not exists status        text not null default 'offen';
alter table public.entries add column if not exists link          text;
alter table public.entries add column if not exists contact       text;
alter table public.entries add column if not exists note          text;
alter table public.entries add column if not exists cost          text;
alter table public.entries add column if not exists archived      boolean not null default false;
alter table public.entries add column if not exists created_by    text;
alter table public.entries add column if not exists updated_by    text;
alter table public.entries add column if not exists created_at    timestamptz not null default now();
alter table public.entries add column if not exists updated_at    timestamptz not null default now();

-- status/category CHECK-Constraints idempotent nachrüsten. Auf upgradeten DBs
-- wurden diese Spalten evtl. per "add column" OHNE Check ergänzt — dann könnten
-- beliebige Werte in status/category landen, die im Frontend in Klassennamen
-- fließen. Drop-if-exists + Add erzwingt die kanonische Whitelist serverseitig.
-- (Auf einer frischen DB ersetzt dies die gleichnamigen Inline-Constraints 1:1.)
do $$
begin
  alter table public.entries drop constraint if exists entries_category_check;
  alter table public.entries add constraint entries_category_check
    check (category in ('festival','markt','messe','sonstiges'));

  alter table public.entries drop constraint if exists entries_status_check;
  alter table public.entries add constraint entries_status_check
    check (status in ('offen','beworben','wartet','zugesagt','abgesagt'));
end $$;

create table if not exists public.attachments (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.entries(id) on delete cascade,
  path       text not null,
  filename   text,
  created_at timestamptz not null default now()
);
create index if not exists attachments_entry_id_idx on public.attachments(entry_id);

-- ---------------------------------------------------------------------------
-- updated_at automatisch pflegen
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists entries_set_updated_at on public.entries;
create trigger entries_set_updated_at
  before update on public.entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- created_by / updated_by serverseitig aus der JWT-E-Mail setzen (nicht
-- fälschbar). Der Client sendet diese Felder im geteilten Modus nicht mehr;
-- Client-Werte dienen nur im Demo-Modus (ohne DB) als Fallback.
-- created_by ist unveränderlich; updated_by wird bei jedem Update gesetzt.
-- ---------------------------------------------------------------------------

create or replace function public.set_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_email text := nullif(auth.jwt() ->> 'email', '');
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(jwt_email, new.created_by);
    new.updated_by := coalesce(jwt_email, new.updated_by);
  else
    new.updated_by := coalesce(jwt_email, new.updated_by);
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists entries_set_actor on public.entries;
create trigger entries_set_actor
  before insert or update on public.entries
  for each row execute function public.set_actor();

-- ---------------------------------------------------------------------------
-- Zugriffsprüfung: ist die eingeloggte E-Mail freigeschaltet?
-- security definer, damit die Funktion allowed_users lesen darf (RLS umgehen),
-- ohne dass Nutzer die Tabelle direkt lesen müssen.
-- ---------------------------------------------------------------------------

create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowed_users au
    where lower(au.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Kein öffentlicher Zugriff. Nur eingeloggte, freigeschaltete Nutzer.
-- ---------------------------------------------------------------------------

alter table public.allowed_users enable row level security;
alter table public.entries       enable row level security;
alter table public.attachments   enable row level security;

-- ALLE bestehenden Policies auf diesen drei Tabellen restlos entfernen, BEVOR
-- unsere restriktiven neu angelegt werden. RLS-Policies OR-verknüpfen sich —
-- eine übrig gebliebene freizügige Policy (z.B. „for all to public using (true)")
-- würde die restriktiven aushebeln. Der Loop erwischt auch fremd benannte Policies.
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('entries','attachments','allowed_users')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- allowed_users: freigeschaltete Nutzer dürfen die Liste sehen (mehr nicht).
drop policy if exists allowed_users_select on public.allowed_users;
create policy allowed_users_select on public.allowed_users
  for select to authenticated
  using (public.is_allowed());

-- entries: volle CRUD-Rechte für freigeschaltete Nutzer.
drop policy if exists entries_all on public.entries;
create policy entries_all on public.entries
  for all to authenticated
  using (public.is_allowed())
  with check (public.is_allowed());

-- attachments: volle CRUD-Rechte für freigeschaltete Nutzer.
drop policy if exists attachments_all on public.attachments;
create policy attachments_all on public.attachments
  for all to authenticated
  using (public.is_allowed())
  with check (public.is_allowed());

-- Rollen-Grants (RLS bleibt die eigentliche Absicherung).
grant usage on schema public to anon, authenticated;
grant select on public.allowed_users to authenticated;
grant select, insert, update, delete on public.entries to authenticated;
grant select, insert, update, delete on public.attachments to authenticated;

-- anon (öffentlich, ohne Login) UND die PUBLIC-Pseudorolle bekommen KEINERLEI
-- Tabellenzugriff. Explizit entziehen — falls in einer früheren Version oder per
-- Supabase-/Postgres-Default etwas an anon oder public ging. Die authenticated-
-- Grants oben bleiben davon unberührt. Es wird bewusst NICHTS zurückgegeben.
revoke all on public.allowed_users from anon, public;
revoke all on public.entries       from anon, public;
revoke all on public.attachments   from anon, public;

-- ---------------------------------------------------------------------------
-- Storage: Bucket "attachments" (privat) + Policies
-- ---------------------------------------------------------------------------

-- Privater Bucket mit Größen- und Typ-Begrenzung: max. 10 MB, nur PDF + gängige
-- Bildformate. Bei erneutem Lauf werden die Limits auch auf einen bestehenden
-- Bucket angewendet (do update), damit die Beschränkung sicher greift.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false,
  10485760,
  array['application/pdf','image/png','image/jpeg','image/gif','image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists attachments_storage_select on storage.objects;
create policy attachments_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.is_allowed());

drop policy if exists attachments_storage_insert on storage.objects;
create policy attachments_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_allowed());

drop policy if exists attachments_storage_update on storage.objects;
create policy attachments_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and public.is_allowed())
  with check (bucket_id = 'attachments' and public.is_allowed());

drop policy if exists attachments_storage_delete on storage.objects;
create policy attachments_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and public.is_allowed());

-- ---------------------------------------------------------------------------
-- Realtime: Änderungen an entries live an alle Clients senden
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Freigeschaltete E-Mail-Adressen (WICHTIG: hier eintragen!)
-- Zeilen einkommentieren und echte Adressen (kleingeschrieben) eintragen.
-- ---------------------------------------------------------------------------

-- insert into public.allowed_users (email) values ('leandra@example.com') on conflict (email) do nothing;
-- insert into public.allowed_users (email) values ('arno@example.com')     on conflict (email) do nothing;
-- insert into public.allowed_users (email) values ('dritte@example.com')   on conflict (email) do nothing;
