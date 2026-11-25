begin;
alter table public.conversations add column title_is_manual boolean not null default false;
create function public.rename_conversation(p_id uuid,p_title text)
returns text language plpgsql security definer set search_path='' as $$
declare cleaned text:=regexp_replace(btrim(p_title),'[[:space:]]+',' ','g');
begin
  if cleaned is null or char_length(cleaned) not between 1 and 120 then raise exception 'Use a title between 1 and 120 characters' using errcode='22023'; end if;
  update public.conversations set title=cleaned,title_is_manual=true where id=p_id and owner_id=auth.uid();
  if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  return cleaned;
end;
$$;
revoke all on function public.rename_conversation(uuid,text) from public,anon;
grant execute on function public.rename_conversation(uuid,text) to authenticated;
create or replace function public.finish_compilation(p_id uuid,p_lease uuid,p_answer text,p_model text,p_usage jsonb,p_title text)
returns boolean language plpgsql security definer set search_path='' as $$
declare completed boolean;
begin
  completed:=public.finish_compilation(p_id,p_lease,p_answer,p_model,p_usage);
  if not completed then return false; end if;
  if p_title is not null and char_length(btrim(p_title)) between 1 and 60 then
    update public.conversations c set title=btrim(p_title) from public.compilations j
      where j.id=p_id and c.id=j.conversation_id and not c.title_is_manual;
  end if;
  return true;
end;
$$;
commit;
