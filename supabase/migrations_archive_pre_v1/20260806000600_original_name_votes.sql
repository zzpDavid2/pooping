-- Make each toilet's imported/original name a normal voteable proposal.
-- Users can then vote the original name back up instead of only voting new nicknames.

insert into toilet_name_proposals (toilet_id, name, created_by, created_at)
select
  t.id,
  btrim(t.name),
  null,
  coalesce(t.created_at, now())
from toilets t
where btrim(coalesce(t.name, '')) <> ''
on conflict (toilet_id, name) do nothing;

create or replace function ensure_original_toilet_name_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if btrim(coalesce(new.name, '')) <> '' then
    insert into toilet_name_proposals (toilet_id, name, created_by, created_at)
    values (new.id, btrim(new.name), null, coalesce(new.created_at, now()))
    on conflict (toilet_id, name) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists toilets_original_name_proposal on toilets;
create trigger toilets_original_name_proposal
  after insert on toilets
  for each row execute function ensure_original_toilet_name_proposal();

select refresh_voted_name(id)
from toilets;
