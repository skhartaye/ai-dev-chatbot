begin;

-- Provider pacing is shared across workers and survives process restarts.
create table public.queue_control (
  id boolean primary key default true check(id),
  available_at timestamptz not null default now()
);
insert into public.queue_control(id) values(true);
alter table public.queue_control enable row level security;
revoke all on public.queue_control from public, anon, authenticated;
grant all on public.queue_control to service_role;

drop function public.compile_prompts(uuid,uuid);
create function public.compile_prompts(p_id uuid, p_conversation_id uuid, p_prompt_ids uuid[] default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing_conversation uuid; prompt_count bigint; content_size bigint;
begin
  perform 1 from public.conversations where id = p_conversation_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Conversation unavailable' using errcode = '42501'; end if;
  select conversation_id into existing_conversation from public.compilations where id = p_id;
  if found then
    if existing_conversation <> p_conversation_id then raise exception 'Compilation ID conflict' using errcode = '42501'; end if;
    return p_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
  if p_prompt_ids is not null and (cardinality(p_prompt_ids)=0 or exists(
    select 1 from unnest(p_prompt_ids) wanted(id) where not exists(
      select 1 from public.prompts p where p.id=wanted.id and p.conversation_id=p_conversation_id and p.compilation_id is null))) then
    raise exception 'Some prompts are already compiled or unavailable. Refresh this conversation.' using errcode='22023';
  end if;
  select count(*), coalesce(sum(char_length(content)),0) into prompt_count, content_size
    from public.prompts where conversation_id = p_conversation_id and compilation_id is null and (p_prompt_ids is null or id=any(p_prompt_ids));
  if prompt_count = 0 then raise exception 'Save a prompt before compiling' using errcode = '22023'; end if;
  if prompt_count > 100 or content_size > 60000 then
    raise exception 'A compilation supports up to 100 prompts and 60000 characters. Start a new conversation for additional context.' using errcode = '22023';
  end if;
  if (select count(*) from public.compilations j join public.conversations c on c.id=j.conversation_id
      where c.owner_id=auth.uid() and j.status in ('queued','processing')) >= 20 then
    raise exception 'Your queue has 20 active compilations. Wait for an answer before compiling more.' using errcode = '22023';
  end if;
  insert into public.compilations(id,conversation_id) values(p_id,p_conversation_id);
  update public.prompts set compilation_id=p_id where conversation_id=p_conversation_id and compilation_id is null and (p_prompt_ids is null or id=any(p_prompt_ids));
  return p_id;
end;
$$;

-- Claim, lease recovery, ordering and pacing are one database transaction.
create function public.claim_compilation()
returns setof public.compilations language plpgsql security definer set search_path = '' as $$
declare chosen uuid;
begin
  perform 1 from public.queue_control where id=true for update;
  update public.compilations set status=case when attempts>=8 then 'failed' else 'queued' end,
    lease_token=null, lease_expires_at=null, error_code='worker_interrupted', available_at=now()
    where status='processing' and lease_expires_at<now();
  if (select available_at>now() from public.queue_control where id=true)
    or exists(select 1 from public.compilations where status='processing') then return; end if;
  select j.id into chosen from public.compilations j
    where j.status='queued' and j.available_at<=now()
      and not exists(select 1 from public.compilations earlier
        where earlier.conversation_id=j.conversation_id and earlier.status in ('queued','processing')
        and (earlier.created_at,earlier.id)<(j.created_at,j.id))
    order by j.created_at,j.id limit 1 for update skip locked;
  if chosen is null then return; end if;
  update public.queue_control set available_at=now()+interval '6 seconds' where id=true;
  return query update public.compilations set status='processing', attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '4 minutes',error_code=null
    where id=chosen returning *;
end;
$$;

create function public.finish_compilation(p_id uuid,p_lease uuid,p_answer text,p_model text,p_usage jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.compilations set status='complete',answer=p_answer,model=p_model,usage=p_usage,
    completed_at=now(),lease_token=null,lease_expires_at=null,error_code=null
    where id=p_id and status='processing' and lease_token=p_lease and lease_expires_at>now();
  return found;
end;
$$;

create function public.defer_compilation(p_id uuid,p_lease uuid,p_code text,p_delay integer,p_retry boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed boolean;
begin
  perform 1 from public.queue_control where id=true for update;
  update public.compilations set status=case when p_retry and attempts<8 then 'queued' else 'failed' end,
    available_at=now()+make_interval(secs=>greatest(6,least(p_delay,86400))),error_code=p_code,
    lease_token=null,lease_expires_at=null
    where id=p_id and status='processing' and lease_token=p_lease and lease_expires_at>now();
  changed=found;
  if changed and p_code='rate_limit' then
    update public.queue_control set available_at=greatest(available_at,now()+make_interval(secs=>greatest(60,least(p_delay,86400)))) where id=true;
  end if;
  return changed;
end;
$$;

create function public.retry_compilation(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.conversations c join public.compilations j on j.conversation_id=c.id
    where j.id=p_id and c.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Compilation unavailable' using errcode='42501'; end if;
  update public.compilations set status='queued',attempts=0,available_at=now(),error_code=null
    where id=p_id and status='failed';
  return p_id;
end;
$$;

revoke all on function public.compile_prompts(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.compile_prompts(uuid,uuid,uuid[]) to authenticated;
revoke all on function public.claim_compilation() from public,anon,authenticated;
revoke all on function public.finish_compilation(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.defer_compilation(uuid,uuid,text,integer,boolean) from public,anon,authenticated;
revoke all on function public.retry_compilation(uuid) from public,anon;
grant execute on function public.claim_compilation() to service_role;
grant execute on function public.finish_compilation(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.defer_compilation(uuid,uuid,text,integer,boolean) to service_role;
grant execute on function public.retry_compilation(uuid) to authenticated;
commit;
