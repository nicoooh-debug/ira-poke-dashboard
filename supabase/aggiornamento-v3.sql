-- =====================================================================
--  IRA POKÈ — Aggiornamento v3: pulizia del vecchio canale "Locale"
--  Da eseguire UNA volta in Supabase → SQL Editor → Run.
-- =====================================================================

-- 1) Se per quel giorno/servizio non c'è ancora "Contanti", il vecchio "Locale" diventa "Contanti"
update public.entrate e
set canale = 'contanti'
where e.canale = 'locale'
  and not exists (
    select 1 from public.entrate x
    where x.giorno = e.giorno and x.servizio = e.servizio and x.canale = 'contanti'
  );

-- 2) Le righe "Locale" rimaste sono doppioni scritti dalla versione vecchia: vengono rimosse
--    (il loro valore resta comunque visibile nello storico modifiche)
delete from public.entrate where canale = 'locale';

-- 3) Da ora in poi "Locale" non è più accettato (solo contanti, pos, glovo, alfonsino, avvoolo)
alter table public.entrate drop constraint if exists entrate_canale_check;
alter table public.entrate add constraint entrate_canale_check
  check (canale in ('contanti','pos','glovo','alfonsino','avvoolo'));
