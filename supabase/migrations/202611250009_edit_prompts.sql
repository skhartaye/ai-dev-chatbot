begin;
alter table public.prompts add column revision_of uuid;
alter table public.prompts add constraint prompts_id_conversation unique(id,conversation_id);
alter table public.prompts add constraint revision_same_conversation foreign key(revision_of,conversation_id) references public.prompts(id,conversation_id);
create function public.revise_prompt(p_id uuid,p_prompt_id uuid,p_source_id uuid,p_content text)
returns uuid language plpgsql security definer set search_path='' as $$
declare source public.prompts; existing public.prompts; job public.compilations;
begin
  select p.* into source from public.prompts p join public.conversations c on c.id=p.conversation_id
    where p.id=p_source_id and c.owner_id=auth.uid() for update of c;
  if not found or source.compilation_id is null then raise exception 'Sent prompt unavailable. Reconnect and refresh.' using errcode='42501'; end if;
  if p_content is null or char_length(btrim(p_content)) not between 1 and 20000 then
    raise exception 'Use a question between 1 and 20000 characters' using errcode='22023'; end if;
  select * into existing from public.prompts where id=p_prompt_id;
  select * into job from public.compilations where id=p_id;
  if existing.id is not null or job.id is not null then
    if existing.id is null or job.id is null or existing.compilation_id<>p_id or existing.conversation_id<>source.conversation_id
      or existing.content<>btrim(p_content) or existing.revision_of is distinct from coalesce(source.revision_of,source.id)
      or job.conversation_id<>source.conversation_id then raise exception 'Request ID conflict' using errcode='42501'; end if;
    return p_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
  if (select count(*) from public.compilations j join public.conversations c on c.id=j.conversation_id
    where c.owner_id=auth.uid() and j.status in ('queued','processing'))>=20 then
    raise exception 'Your queue has 20 active requests. Wait for an answer.' using errcode='22023'; end if;
  insert into public.compilations(id,conversation_id) values(p_id,source.conversation_id);
  insert into public.prompts(id,conversation_id,content,compilation_id,revision_of)
    values(p_prompt_id,source.conversation_id,btrim(p_content),p_id,coalesce(source.revision_of,source.id));
  return p_id;
end;
$$;
revoke all on function public.revise_prompt(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.revise_prompt(uuid,uuid,uuid,text) to authenticated;
commit;
