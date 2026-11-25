begin;
-- Replayed prompt deliveries must remain valid after an automatic rename.
create or replace function public.create_conversation(p_id uuid,p_title text)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.conversations;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  insert into public.conversations(id,owner_id,title) values(p_id,auth.uid(),p_title) on conflict(id) do nothing;
  select * into existing from public.conversations where id=p_id;
  if existing.owner_id <> auth.uid() then raise exception 'Conversation ID conflict' using errcode='42501'; end if;
  return p_id;
end;
$$;
-- Keep the old five-argument function for workers running during deployment.
create function public.finish_compilation(p_id uuid,p_lease uuid,p_answer text,p_model text,p_usage jsonb,p_title text)
returns boolean language plpgsql security definer set search_path='' as $$
declare completed boolean;
begin
  completed:=public.finish_compilation(p_id,p_lease,p_answer,p_model,p_usage);
  if not completed then return false; end if;
  if p_title is not null and char_length(btrim(p_title)) between 1 and 60 then
    update public.conversations c set title=btrim(p_title)
      from public.compilations j where j.id=p_id and c.id=j.conversation_id;
  end if;
  return true;
end;
$$;
revoke all on function public.finish_compilation(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_compilation(uuid,uuid,text,text,jsonb,text) to service_role;
comment on function public.finish_compilation(uuid,uuid,text,text,jsonb,text) is 'Atomically finish a valid leased answer and store its generated conversation topic; stale leases cannot rename conversations.';
commit;
