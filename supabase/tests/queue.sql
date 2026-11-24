begin;
-- Keep the test isolated from real jobs. No fixture survives rollback.
lock table public.compilations in share row exclusive mode;
insert into auth.users(id) values('10000000-0000-4000-8000-000000000011');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',true);
set local role authenticated;
select public.create_conversation('20000000-0000-4000-8000-000000000011','Queue test');
select public.save_prompt('30000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000011','First');
select public.save_prompt('30000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000011','Second');
select public.compile_prompts('40000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000011',array['30000000-0000-4000-8000-000000000011']::uuid[]);
do $$ begin
  if (select count(*) from public.prompts where compilation_id='40000000-0000-4000-8000-000000000011')<>1 then raise exception 'Snapshot boundary failed'; end if;
  begin perform public.claim_compilation();raise exception 'Client claimed work';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Isolate the fixture queue without deleting existing data.
update public.compilations set available_at=now()+interval '1 day' where id<>'40000000-0000-4000-8000-000000000011' and status='queued';
update public.queue_control set available_at=now()-interval '1 second';
do $$ declare j public.compilations; reclaimed public.compilations; ok boolean;begin
  if exists(select 1 from public.compilations where status='processing') then raise exception 'Run queue test while no real job is processing'; end if;
  select * into j from public.claim_compilation();
  if j.id is distinct from '40000000-0000-4000-8000-000000000011'::uuid or j.attempts<>1 then raise exception 'Claim failed';end if;
  if exists(select 1 from public.claim_compilation()) then raise exception 'Duplicate claim';end if;
  ok=public.finish_compilation(j.id,gen_random_uuid(),'Wrong','test',null);
  if ok then raise exception 'Stale lease completed work';end if;
  update public.compilations set lease_expires_at=now()-interval '1 second' where id=j.id;
  update public.queue_control set available_at=now()-interval '1 second';
  select * into reclaimed from public.claim_compilation();
  if reclaimed.id is distinct from j.id or reclaimed.lease_token=j.lease_token or reclaimed.attempts<>2 then raise exception 'Lease recovery failed';end if;
  ok=public.finish_compilation(j.id,j.lease_token,'Stale','test',null);
  if ok then raise exception 'Old worker overwrote result';end if;
  perform public.defer_compilation(reclaimed.id,reclaimed.lease_token,'rate_limit',90,true);
  if (select status<>'queued' or available_at<=now() from public.compilations where id=j.id) then raise exception 'Retry not durable';end if;
  if (select available_at<=now() from public.queue_control) then raise exception 'Global quota cooldown absent';end if;
  update public.compilations set available_at=now()-interval '1 second' where id=j.id;
  update public.queue_control set available_at=now()-interval '1 second';
  select * into reclaimed from public.claim_compilation();
  if not public.finish_compilation(reclaimed.id,reclaimed.lease_token,'Complete answer','test',null) then raise exception 'Completion failed';end if;
  if (select count(*) from public.compilation_events where compilation_id=j.id)<5 then raise exception 'Audit missing';end if;
end $$;
rollback;
select 'PASS: snapshot, claim denial, single claim, lease recovery, stale-worker denial, durable backoff, completion, audit' as verification;
