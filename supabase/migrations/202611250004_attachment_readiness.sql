begin;
-- Save the intended file membership atomically with the prompt. Storage object
-- existence determines readiness; no duplicate "uploaded" status is stored.
create function public.save_prompt_with_attachments(p_id uuid,p_conversation_id uuid,p_content text,p_files jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare file jsonb; object_path text; existing public.attachments;
begin
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 5 then
    raise exception 'Attach between 1 and 5 files';
  end if;
  perform public.save_prompt(p_id,p_conversation_id,p_content);
  if exists(select 1 from public.prompts where id=p_id and compilation_id is not null) then
    -- A response can be lost after a completed delivery. Verify the same immutable manifest below.
    if (select count(*) from public.attachments where prompt_id=p_id)<>jsonb_array_length(p_files) then
      raise exception 'This prompt is already queued';
    end if;
  end if;
  for file in select value from jsonb_array_elements(p_files) loop
    object_path:=auth.uid()::text||'/'||p_id::text||'/'||(file->>'id')::uuid::text;
    select * into existing from public.attachments where id=(file->>'id')::uuid;
    if found then
      if (existing.prompt_id,existing.name,existing.mime_type,existing.size,existing.storage_path)
        is distinct from (p_id,file->>'name',file->>'mimeType',(file->>'size')::integer,object_path) then
        raise exception 'Attachment ID conflict' using errcode='42501';
      end if;
    else
      if exists(select 1 from public.prompts where id=p_id and compilation_id is not null) then raise exception 'This prompt is already queued'; end if;
      insert into public.attachments(id,prompt_id,name,mime_type,size,storage_path)
        values((file->>'id')::uuid,p_id,file->>'name',file->>'mimeType',(file->>'size')::integer,object_path);
    end if;
  end loop;
  if (select count(*) from public.attachments where prompt_id=p_id)<>jsonb_array_length(p_files) then raise exception 'Attachment manifest conflict'; end if;
  if (select coalesce(sum(a.size),0) from public.attachments a join public.prompts p on p.id=a.prompt_id
    where p.conversation_id=p_conversation_id)>10485760 then raise exception 'Conversation attachments exceed 10 MB'; end if;
  return p_id;
end;
$$;
revoke all on function public.save_prompt_with_attachments(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.save_prompt_with_attachments(uuid,uuid,text,jsonb) to authenticated;

create function public.require_complete_attachments()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.compilation_id is not null and old.compilation_id is null and exists(
    select 1 from public.attachments a where a.prompt_id=new.id and not exists(
      select 1 from storage.objects o where o.bucket_id='chat-attachments' and o.name=a.storage_path
        and (o.metadata->>'size')::bigint=a.size and o.metadata->>'mimetype'=a.mime_type)) then
    raise exception 'Attachments are still uploading. Keep the original tab open and retry.';
  end if;
  return new;
end;
$$;
revoke all on function public.require_complete_attachments() from public,anon,authenticated;
create trigger complete_attachments_before_queue before update of compilation_id on public.prompts
  for each row execute function public.require_complete_attachments();
commit;
