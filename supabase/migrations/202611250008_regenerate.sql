begin;
-- A new attempt references immutable input instead of duplicating prompts/files.
alter table public.compilations add column regeneration_of uuid;
alter table public.compilations add constraint regeneration_same_conversation
  foreign key (regeneration_of,conversation_id) references public.compilations(id,conversation_id);
create function public.regenerate_answer(p_id uuid,p_source_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare source public.compilations; existing public.compilations; active uuid;
begin
  select j.* into source from public.compilations j join public.conversations c on c.id=j.conversation_id
    where j.id=p_source_id and c.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Answer unavailable' using errcode='42501'; end if;
  if source.status<>'complete' then raise exception 'Wait for this answer to finish' using errcode='22023'; end if;
  -- All attempts use the original turn and its original context boundary.
  if source.regeneration_of is not null then select * into source from public.compilations where id=source.regeneration_of; end if;
  select * into existing from public.compilations where id=p_id;
  if found then
    if existing.conversation_id<>source.conversation_id or existing.regeneration_of is distinct from source.id then
      raise exception 'Request ID conflict' using errcode='42501';
    end if;
    return p_id;
  end if;
  select id into active from public.compilations where regeneration_of=source.id and status in ('queued','processing') limit 1;
  if found then return active; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
  if (select count(*) from public.compilations j join public.conversations c on c.id=j.conversation_id
    where c.owner_id=auth.uid() and j.status in ('queued','processing'))>=20 then
    raise exception 'Your queue has 20 active requests. Wait for an answer.' using errcode='22023';
  end if;
  insert into public.compilations(id,conversation_id,regeneration_of) values(p_id,source.conversation_id,source.id);
  return p_id;
end;
$$;
revoke all on function public.regenerate_answer(uuid,uuid) from public,anon;
grant execute on function public.regenerate_answer(uuid,uuid) to authenticated;
commit;
