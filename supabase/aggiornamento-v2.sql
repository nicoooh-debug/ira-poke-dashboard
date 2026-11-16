-- =====================================================================
--  IRA POKÈ — Aggiornamento v2 (Contanti / POS)
--  Da eseguire UNA volta in Supabase → SQL Editor → Run.
--  Non cancella nessun dato.
-- =====================================================================

-- 1) Accetta i nuovi canali "contanti" e "pos"
alter table public.entrate drop constraint if exists entrate_canale_check;
alter table public.entrate add constraint entrate_canale_check
  check (canale in ('contanti','pos','glovo','alfonsino','avvoolo','locale'));

-- 2) Gli importi inseriti finora come "Locale" diventano "Contanti"
--    (poi puoi spostarne una parte su POS direttamente dalla dashboard)
update public.entrate e
set canale = 'contanti'
where e.canale = 'locale'
  and not exists (
    select 1 from public.entrate x
    where x.giorno = e.giorno and x.servizio = e.servizio and x.canale = 'contanti'
  );

update public.entrate_storico set canale = 'contanti' where canale = 'locale';
