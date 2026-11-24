begin;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now()
);
create index conversations_owner on public.conversations(owner_id, created_at desc);

create table public.compilations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id),
  status text not null default 'queued' check (status in ('queued','processing','complete','failed')),
  answer text,
  model text,
  usage jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, conversation_id),
  check ((status = 'complete') = (answer is not null and completed_at is not null)),
  check (answer is null or char_length(btrim(answer)) > 0),
  check ((status = 'processing') = (lease_token is not null and lease_expires_at is not null))
);
create index compilations_conversation on public.compilations(conversation_id, created_at);
create index compilations_queue on public.compilations(available_at, created_at) where status = 'queued';

create table public.prompts (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id),
  content text not null check (char_length(btrim(content)) between 1 and 20000),
  compilation_id uuid,
  created_at timestamptz not null default now(),
  foreign key (compilation_id, conversation_id) references public.compilations(id, conversation_id)
);
create index prompts_conversation on public.prompts(conversation_id, created_at, id);
create index prompts_compilation on public.prompts(compilation_id);

create table public.compilation_events (
  id bigint generated always as identity primary key,
  compilation_id uuid not null references public.compilations(id),
  status text not null,
  recorded_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.prompts enable row level security;
alter table public.compilations enable row level security;
alter table public.compilation_events enable row level security;

create policy conversations_read on public.conversations for select to authenticated
  using (owner_id = (select auth.uid()));
create policy prompts_read on public.prompts for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.owner_id = (select auth.uid())));
create policy compilations_read on public.compilations for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.owner_id = (select auth.uid())));
create policy compilation_events_read on public.compilation_events for select to authenticated
  using (exists (select 1 from public.compilations j join public.conversations c on c.id = j.conversation_id
    where j.id = compilation_id and c.owner_id = (select auth.uid())));

revoke all on public.conversations, public.prompts, public.compilations, public.compilation_events from anon, authenticated;
grant select on public.conversations, public.prompts, public.compilations, public.compilation_events to authenticated;
grant all on public.conversations, public.prompts, public.compilations, public.compilation_events to service_role;
grant usage, select on sequence public.compilation_events_id_seq to service_role;

-- All client writes go through ownership-checked functions. A per-conversation
-- lock serializes saving and compiling, including simultaneous browser tabs.
create function public.create_conversation(p_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.conversations;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  insert into public.conversations(id, owner_id, title) values (p_id, auth.uid(), p_title)
    on conflict (id) do nothing;
  select * into existing from public.conversations where id = p_id;
  if existing.owner_id <> auth.uid() or existing.title <> p_title then
    raise exception 'Conversation ID conflict' using errcode = '42501';
  end if;
  return p_id;
end;
$$;

create function public.save_prompt(p_id uuid, p_conversation_id uuid, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.prompts;
begin
  perform 1 from public.conversations where id = p_conversation_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Conversation unavailable' using errcode = '42501'; end if;
  insert into public.prompts(id, conversation_id, content) values(p_id, p_conversation_id, p_content)
    on conflict (id) do nothing;
  select * into existing from public.prompts where id = p_id;
  if existing.conversation_id <> p_conversation_id or existing.content <> p_content then
    raise exception 'Prompt ID conflict' using errcode = '42501';
  end if;
  return p_id;
end;
$$;

create function public.compile_prompts(p_id uuid, p_conversation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing_conversation uuid;
begin
  perform 1 from public.conversations where id = p_conversation_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Conversation unavailable' using errcode = '42501'; end if;
  select conversation_id into existing_conversation from public.compilations where id = p_id;
  if found then
    if existing_conversation <> p_conversation_id then
      raise exception 'Compilation ID conflict' using errcode = '42501';
    end if;
    return p_id;
  end if;
  if not exists(select 1 from public.prompts where conversation_id = p_conversation_id and compilation_id is null) then
    raise exception 'Add a prompt before compiling' using errcode = '22023';
  end if;
  insert into public.compilations(id, conversation_id) values(p_id, p_conversation_id);
  update public.prompts set compilation_id = p_id
    where conversation_id = p_conversation_id and compilation_id is null;
  return p_id;
end;
$$;

create function public.record_compilation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.compilation_events(compilation_id, status) values(new.id, new.status);
  elsif old.status is distinct from new.status then
    insert into public.compilation_events(compilation_id, status) values(new.id, new.status);
  end if;
  return new;
end;
$$;
create trigger compilation_history after insert or update of status on public.compilations
  for each row execute function public.record_compilation_event();

revoke all on function public.create_conversation(uuid,text) from public, anon;
revoke all on function public.save_prompt(uuid,uuid,text) from public, anon;
revoke all on function public.compile_prompts(uuid,uuid) from public, anon;
revoke all on function public.record_compilation_event() from public, anon, authenticated;
grant execute on function public.create_conversation(uuid,text) to authenticated;
grant execute on function public.save_prompt(uuid,uuid,text) to authenticated;
grant execute on function public.compile_prompts(uuid,uuid) to authenticated;

commit;
