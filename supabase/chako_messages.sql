create table if not exists chako_messages (
  id bigserial primary key,
  event_id text unique,
  received_at timestamptz default now(),
  event_type text,
  source_type text,
  source_id text,
  user_id text,
  message_type text,
  message_text text,
  message_id text,
  reply_token text,
  raw_event jsonb not null,
  processed boolean default false,
  replied boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_chako_messages_source_id on chako_messages (source_id);
create index if not exists idx_chako_messages_received_at on chako_messages (received_at desc);
create index if not exists idx_chako_messages_processed on chako_messages (processed) where processed = false;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chako_messages'
  ) then
    alter publication supabase_realtime add table chako_messages;
  end if;
end $$;
