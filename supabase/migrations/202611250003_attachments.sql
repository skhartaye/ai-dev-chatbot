begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-attachments','chat-attachments',false,10485760,array['application/pdf','image/png','image/jpeg','image/webp','text/plain'])
on conflict(id) do nothing;

create table public.attachments (
  id uuid primary key,
  prompt_id uuid not null references public.prompts(id),
  name text not null check(char_length(name) between 1 and 255),
  mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg','image/webp','text/plain')),
  size integer not null check(size between 1 and 10485760),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index attachments_prompt on public.attachments(prompt_id);
alter table public.attachments enable row level security;
create policy attachments_read on public.attachments for select to authenticated using(exists(
  select 1 from public.prompts p join public.conversations c on c.id=p.conversation_id
  where p.id=prompt_id and c.owner_id=auth.uid()));
revoke all on public.attachments from public,anon,authenticated;
grant select on public.attachments to authenticated;
grant all on public.attachments to service_role;

create policy chat_files_insert on storage.objects for insert to authenticated with check(
  bucket_id='chat-attachments' and (storage.foldername(name))[1]=auth.uid()::text and exists(
    select 1 from public.prompts p join public.conversations c on c.id=p.conversation_id
    where p.id::text=(storage.foldername(name))[2] and c.owner_id=auth.uid() and p.compilation_id is null));
create policy chat_files_read on storage.objects for select to authenticated using(
  bucket_id='chat-attachments' and (storage.foldername(name))[1]=auth.uid()::text);

create function public.register_attachment(p_id uuid,p_prompt_id uuid,p_name text,p_mime_type text,p_size integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.attachments; target public.prompts; object_path text;
begin
  select p.* into target from public.prompts p join public.conversations c on c.id=p.conversation_id
    where p.id=p_prompt_id and c.owner_id=auth.uid() for update of p,c;
  if not found then raise exception 'Prompt unavailable' using errcode='42501'; end if;
  object_path:=auth.uid()::text||'/'||p_prompt_id::text||'/'||p_id::text;
  select * into existing from public.attachments where id=p_id;
  if found then
    if (existing.prompt_id,existing.name,existing.mime_type,existing.size,existing.storage_path)
       is distinct from (p_prompt_id,p_name,p_mime_type,p_size,object_path) then
      raise exception 'Attachment ID conflict' using errcode='42501';
    end if;
    return p_id;
  end if;
  if target.compilation_id is not null then raise exception 'This prompt is already queued'; end if;
  if not exists(select 1 from storage.objects where bucket_id='chat-attachments' and name=object_path
    and (metadata->>'size')::bigint=p_size and metadata->>'mimetype'=p_mime_type) then
    raise exception 'Upload the complete attachment before queueing';
  end if;
  if (select count(*) from public.attachments where prompt_id=p_prompt_id)>=5 then raise exception 'Maximum 5 attachments per prompt'; end if;
  if coalesce((select sum(a.size) from public.attachments a join public.prompts p on p.id=a.prompt_id
    where p.conversation_id=target.conversation_id),0)+p_size>10485760 then
    raise exception 'Attachments in this conversation exceed 10 MB. Start a new conversation.';
  end if;
  insert into public.attachments values(p_id,p_prompt_id,p_name,p_mime_type,p_size,object_path,now());
  return p_id;
end;
$$;
revoke all on function public.register_attachment(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.register_attachment(uuid,uuid,text,text,integer) to authenticated;
commit;
