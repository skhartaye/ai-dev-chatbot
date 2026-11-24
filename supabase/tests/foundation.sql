-- Run as postgres in a test session. All fixtures are rolled back.
begin;
insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare c uuid := '20000000-0000-4000-8000-000000000001';
  p uuid := '30000000-0000-4000-8000-000000000001';
  j uuid := '40000000-0000-4000-8000-000000000001';
begin
  perform public.create_conversation(c, 'Test');
  perform public.save_prompt(p,c,'First prompt');
  perform public.save_prompt(p,c,'First prompt');
  if (select count(*) from public.prompts where id=p) <> 1 then raise exception 'Duplicate prompt'; end if;
  perform public.compile_prompts(j,c);
  perform public.save_prompt('30000000-0000-4000-8000-000000000002',c,'Next batch');
  perform public.compile_prompts(j,c);
  if (select count(*) from public.prompts where compilation_id=j) <> 1 then raise exception 'Batch changed on retry'; end if;
  if (select count(*) from public.prompts where conversation_id=c and compilation_id is null) <> 1 then raise exception 'New prompt lost'; end if;
  if (select count(*) from public.compilation_events where compilation_id=j and status='queued') <> 1 then raise exception 'Missing audit event'; end if;
  begin
    update public.compilations set status='complete' where id=j;
    raise exception 'Direct job writes allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.conversations) or exists(select 1 from public.prompts)
    or exists(select 1 from public.compilations) or exists(select 1 from public.compilation_events) then
    raise exception 'Cross-user read allowed';
  end if;
  begin
    perform public.save_prompt('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Unauthorized');
    raise exception 'Cross-user write allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.create_conversation(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous execution allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
select 'PASS: ownership, anonymous denial, write restrictions, idempotency, compilation boundaries, audit history' as verification;
