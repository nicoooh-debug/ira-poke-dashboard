-- =====================================================================
--  IRA POKÈ — Schema database (Supabase / PostgreSQL)
--  Incolla tutto questo file in Supabase → SQL Editor → Run.
--  Può essere eseguito più volte senza perdere dati.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ENTRATE: una riga per giorno + servizio + canale (valore attuale)
-- ---------------------------------------------------------------------
create table if not exists public.entrate (
  giorno      date          not null,
  servizio    text          not null check (servizio in ('pranzo','cena')),
  canale      text          not null check (canale in ('locale','glovo','alfonsino','avvoolo')),
  importo     numeric(10,2) not null default 0 check (importo >= 0),
  updated_at  timestamptz   not null default now(),
  updated_by  uuid          default auth.uid(),
  primary key (giorno, servizio, canale)
);

-- ---------------------------------------------------------------------
-- 2) STORICO ENTRATE: ogni modifica viene registrata, nulla si perde
-- ---------------------------------------------------------------------
create table if not exists public.entrate_storico (
  id                  bigint generated always as identity primary key,
  giorno              date          not null,
  servizio            text          not null,
  canale              text          not null,
  importo_precedente  numeric(10,2),
  importo_nuovo       numeric(10,2) not null,
  modificato_at       timestamptz   not null default now(),
  modificato_da       uuid          default auth.uid()
);
create index if not exists entrate_storico_giorno_idx on public.entrate_storico (giorno, modificato_at desc);

create or replace function public.entrate_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    insert into entrate_storico (giorno, servizio, canale, importo_precedente, importo_nuovo)
    values (new.giorno, new.servizio, new.canale, null, new.importo);
  elsif new.importo is distinct from old.importo then
    insert into entrate_storico (giorno, servizio, canale, importo_precedente, importo_nuovo)
    values (new.giorno, new.servizio, new.canale, old.importo, new.importo);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_entrate_before_write on public.entrate;
create trigger trg_entrate_before_write
before insert or update on public.entrate
for each row execute function public.entrate_before_write();

-- ---------------------------------------------------------------------
-- 3) USCITE (spese del giorno). Eliminazione "morbida": deleted_at
-- ---------------------------------------------------------------------
create table if not exists public.uscite (
  id           uuid          primary key default gen_random_uuid(),
  giorno       date          not null,
  descrizione  text          not null,
  categoria    text          not null default 'altro',
  metodo       text          not null default 'cassa' check (metodo in ('cassa','banca')),
  importo      numeric(10,2) not null check (importo > 0),
  created_at   timestamptz   not null default now(),
  created_by   uuid          default auth.uid(),
  deleted_at   timestamptz
);
create index if not exists uscite_giorno_idx on public.uscite (giorno);

-- ---------------------------------------------------------------------
-- 4) ACCREDITI DELIVERY: soldi EFFETTIVAMENTE ricevuti dalle piattaforme
--    (separati dalle vendite registrate)
-- ---------------------------------------------------------------------
create table if not exists public.accrediti (
  id           uuid          primary key default gen_random_uuid(),
  data         date          not null,
  piattaforma  text          not null check (piattaforma in ('glovo','alfonsino','avvoolo')),
  importo      numeric(10,2) not null check (importo > 0),
  destinazione text          not null default 'banca' check (destinazione in ('banca','cassaforte')),
  note         text,
  created_at   timestamptz   not null default now(),
  created_by   uuid          default auth.uid(),
  deleted_at   timestamptz
);

-- ---------------------------------------------------------------------
-- 5) VISTA: vendite delivery registrate vs denaro ricevuto
-- ---------------------------------------------------------------------
create or replace view public.delivery_saldo
with (security_invoker = true) as
select p.piattaforma,
       coalesce((select sum(e.importo) from public.entrate e where e.canale = p.piattaforma), 0)                         as vendite,
       coalesce((select sum(a.importo) from public.accrediti a where a.piattaforma = p.piattaforma and a.deleted_at is null), 0) as ricevuto
from (values ('glovo'), ('alfonsino'), ('avvoolo')) as p(piattaforma);

-- ---------------------------------------------------------------------
-- 6) SICUREZZA: solo utenti autenticati. Nessuno può cancellare righe.
-- ---------------------------------------------------------------------
alter table public.entrate          enable row level security;
alter table public.entrate_storico  enable row level security;
alter table public.uscite           enable row level security;
alter table public.accrediti        enable row level security;

revoke all on public.entrate, public.entrate_storico, public.uscite, public.accrediti, public.delivery_saldo from anon;
grant select, insert, update on public.entrate, public.uscite, public.accrediti to authenticated;
grant select on public.entrate_storico, public.delivery_saldo to authenticated;

drop policy if exists "auth legge entrate"     on public.entrate;
drop policy if exists "auth inserisce entrate" on public.entrate;
drop policy if exists "auth modifica entrate"  on public.entrate;
create policy "auth legge entrate"     on public.entrate for select to authenticated using (true);
create policy "auth inserisce entrate" on public.entrate for insert to authenticated with check (true);
create policy "auth modifica entrate"  on public.entrate for update to authenticated using (true) with check (true);

drop policy if exists "auth legge storico" on public.entrate_storico;
create policy "auth legge storico" on public.entrate_storico for select to authenticated using (true);

drop policy if exists "auth legge uscite"     on public.uscite;
drop policy if exists "auth inserisce uscite" on public.uscite;
drop policy if exists "auth modifica uscite"  on public.uscite;
create policy "auth legge uscite"     on public.uscite for select to authenticated using (true);
create policy "auth inserisce uscite" on public.uscite for insert to authenticated with check (true);
create policy "auth modifica uscite"  on public.uscite for update to authenticated using (true) with check (true);

drop policy if exists "auth legge accrediti"     on public.accrediti;
drop policy if exists "auth inserisce accrediti" on public.accrediti;
drop policy if exists "auth modifica accrediti"  on public.accrediti;
create policy "auth legge accrediti"     on public.accrediti for select to authenticated using (true);
create policy "auth inserisce accrediti" on public.accrediti for insert to authenticated with check (true);
create policy "auth modifica accrediti"  on public.accrediti for update to authenticated using (true) with check (true);
