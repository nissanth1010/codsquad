-- CODSQUAD core schema. Run in the Supabase SQL Editor on a fresh project.
-- This migration is designed for Supabase (auth, realtime, and storage schemas must exist).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- Profiles and trusted authorization helpers
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  bio text not null default '' check (length(bio) <= 240),
  avatar_path text,
  favorite_games text[] not null default '{}'::text[] check (cardinality(favorite_games) <= 12),
  gaming_status text not null default 'offline' check (gaming_status in ('offline','available','playing','busy')),
  role text not null default 'member' check (role in ('member','admin')),
  is_authorized boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_display text;
  v_base text;
  v_username text;
begin
  v_display := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'squadmember'), '@', 1));
  v_base := lower(regexp_replace(split_part(coalesce(new.email, 'squadmember'), '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
  v_base := left(coalesce(nullif(v_base, ''), 'player'), 15);
  v_username := v_base || '_' || substr(replace(new.id::text, '-', ''), 1, 8);
  insert into public.profiles (id, username, display_name, is_authorized, role)
  values (new.id, v_username, left(v_display, 60), false, 'member')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_codSquad on auth.users;
create trigger on_auth_user_created_codSquad
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.is_authorized_member()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_authorized from public.profiles p where p.id = auth.uid()), false);
$$;

-- Internal helper used only by privileged SECURITY DEFINER functions; not callable by browser users.
create or replace function public.is_authorized_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_authorized from public.profiles p where p.id = p_user_id), false);
$$;

create or replace function public.is_squad_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_authorized and p.role = 'admin' from public.profiles p where p.id = auth.uid()), false);
$$;

revoke all on function public.is_authorized_user(uuid) from public, anon, authenticated;
revoke all on function public.is_authorized_member() from public, anon;
revoke all on function public.is_squad_admin() from public, anon;
grant execute on function public.is_authorized_member() to authenticated;
grant execute on function public.is_squad_admin() to authenticated;

-- ---------------------------------------------------------
-- Conversations, memberships, and messages
-- ---------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('group','private')),
  title text,
  system_key text unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'group') or title is null)
);

create unique index if not exists conversations_single_codSquad_group
  on public.conversations (system_key) where system_key = 'codsquad-main';

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_by_user on public.conversation_members(user_id, joined_at desc);

create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.user_id = auth.uid()
  );
$$;
revoke all on function public.is_conversation_member(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;

create or replace function public.ensure_group_conversation()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null or not public.is_authorized_member() then
    raise exception 'Authorized CODSQUAD membership required';
  end if;

  insert into public.conversations (kind, title, system_key, created_by)
  values ('group', 'CODSQUAD', 'codsquad-main', v_user)
  on conflict (system_key) do nothing;

  select id into v_id from public.conversations where system_key = 'codsquad-main';
  insert into public.conversation_members (conversation_id, user_id)
  select v_id, p.id from public.profiles p where p.is_authorized = true
  on conflict (conversation_id, user_id) do nothing;
  return v_id;
end;
$$;

revoke all on function public.ensure_group_conversation() from public, anon;
grant execute on function public.ensure_group_conversation() to authenticated;

create or replace function public.create_private_conversation(target_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null or not public.is_authorized_member() then
    raise exception 'Authorized CODSQUAD membership required';
  end if;
  if target_user_id is null or target_user_id = v_user then
    raise exception 'Choose another squad member';
  end if;
  if not public.is_authorized_user(target_user_id) then
    raise exception 'The selected account is not an authorized squad member';
  end if;

  select c.id into v_id
  from public.conversations c
  where c.kind = 'private'
    and exists (select 1 from public.conversation_members a where a.conversation_id = c.id and a.user_id = v_user)
    and exists (select 1 from public.conversation_members b where b.conversation_id = c.id and b.user_id = target_user_id)
    and (select count(*) from public.conversation_members all_members where all_members.conversation_id = c.id) = 2
  limit 1;

  if v_id is null then
    insert into public.conversations (kind, title, created_by) values ('private', null, v_user) returning id into v_id;
    insert into public.conversation_members (conversation_id, user_id) values (v_id, v_user), (v_id, target_user_id)
    on conflict do nothing;
  end if;
  return v_id;
end;
$$;
revoke all on function public.create_private_conversation(uuid) from public, anon;
grant execute on function public.create_private_conversation(uuid) to authenticated;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null default '' check (length(body) <= 4000),
  attachment_path text,
  attachment_mime text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (length(btrim(body)) > 0 or attachment_path is not null or deleted_at is not null),
  check (attachment_mime is null or attachment_mime in ('image/jpeg','image/png','image/webp','image/gif'))
);
create index if not exists messages_conversation_created on public.messages(conversation_id, created_at desc);
create index if not exists messages_sender_created on public.messages(sender_id, created_at desc);

-- Lightweight database-side flood control: max 8 messages per sender in a rolling 10 seconds.
create or replace function public.enforce_message_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recent_count integer;
begin
  select count(*) into v_recent_count
  from public.messages m
  where m.sender_id = new.sender_id and m.created_at > now() - interval '10 seconds';
  if v_recent_count >= 8 then
    raise exception 'Message rate limit reached. Please wait a moment before sending again.';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit before insert on public.messages
for each row execute function public.enforce_message_rate_limit();

create or replace function public.touch_conversation_after_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages
for each row execute function public.touch_conversation_after_message();

-- ---------------------------------------------------------
-- Announcements, gaming sessions, activity, notifications
-- ---------------------------------------------------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  content text not null check (length(btrim(content)) between 1 and 5000),
  author_id uuid not null references public.profiles(id) on delete restrict,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_pinned_created on public.announcements(is_pinned desc, created_at desc);

create table if not exists public.gaming_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 90),
  game_name text not null check (length(btrim(game_name)) between 1 and 70),
  description text not null default '' check (length(description) <= 500),
  scheduled_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','open','completed','cancelled')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > scheduled_at)
);
create index if not exists gaming_sessions_schedule on public.gaming_sessions(scheduled_at, status);

create table if not exists public.gaming_session_members (
  session_id uuid not null references public.gaming_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index if not exists gaming_session_members_by_user on public.gaming_session_members(user_id, joined_at desc);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in ('profile','status','session','announcement','message','member')),
  title text not null check (length(btrim(title)) between 1 and 180),
  detail text not null default '' check (length(detail) <= 500),
  entity_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_created on public.activity_logs(created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'system' check (type in ('message','announcement','session','system')),
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null default '' check (length(body) <= 500),
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_unread on public.notifications(recipient_id, read_at, created_at desc);

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  notifications_enabled boolean not null default true,
  presence_visible boolean not null default true,
  updated_at timestamptz not null default now()
);

-- New-message notifications are generated in the database so a sender cannot forge recipients.
create or replace function public.notify_conversation_members_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sender_name text;
  v_body text;
begin
  select display_name into v_sender_name from public.profiles where id = new.sender_id;
  v_body := case when new.attachment_path is not null and length(btrim(new.body)) = 0 then 'Shared an image' else left(new.body, 180) end;
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id)
  select cm.user_id, 'message', 'New message from ' || coalesce(v_sender_name, 'a squad member'), v_body, 'conversation', new.conversation_id
  from public.conversation_members cm
  join public.profiles p on p.id = cm.user_id and p.is_authorized = true
  left join public.user_settings us on us.user_id = cm.user_id
  where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id
    and coalesce(us.notifications_enabled, true) = true;
  return new;
end;
$$;
drop trigger if exists messages_notify_members on public.messages;
create trigger messages_notify_members after insert on public.messages
for each row execute function public.notify_conversation_members_on_message();

create or replace function public.notify_announcement_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id)
  select p.id, 'announcement', 'New squad announcement', left(new.title, 160), 'announcement', new.id
  from public.profiles p
  left join public.user_settings us on us.user_id = p.id
  where p.is_authorized = true and p.id <> new.author_id
    and coalesce(us.notifications_enabled, true) = true;
  return new;
end;
$$;
drop trigger if exists announcements_notify_members on public.announcements;
create trigger announcements_notify_members after insert on public.announcements
for each row execute function public.notify_announcement_members();

create or replace function public.notify_session_members()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_body text;
begin
  if tg_op = 'INSERT' then
    v_title := 'New gaming session planned';
    v_body := left(new.title || ' · ' || new.game_name, 500);
  elsif new.status is distinct from old.status then
    v_title := 'Gaming session updated';
    v_body := left(new.title || ' is now ' || new.status || '.', 500);
  else
    return new;
  end if;

  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id)
  select p.id, 'session', v_title, v_body, 'session', new.id
  from public.profiles p
  left join public.user_settings us on us.user_id = p.id
  where p.is_authorized = true and p.id <> new.created_by
    and coalesce(us.notifications_enabled, true) = true;
  return new;
end;
$$;
drop trigger if exists gaming_sessions_notify_insert on public.gaming_sessions;
create trigger gaming_sessions_notify_insert after insert on public.gaming_sessions
for each row execute function public.notify_session_members();
drop trigger if exists gaming_sessions_notify_status on public.gaming_sessions;
create trigger gaming_sessions_notify_status after update of status on public.gaming_sessions
for each row execute function public.notify_session_members();

-- Generic updated_at triggers.
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists conversations_updated_at on public.conversations;
create trigger conversations_updated_at before update on public.conversations for each row execute function public.set_updated_at();
drop trigger if exists announcements_updated_at on public.announcements;
create trigger announcements_updated_at before update on public.announcements for each row execute function public.set_updated_at();
drop trigger if exists gaming_sessions_updated_at on public.gaming_sessions;
create trigger gaming_sessions_updated_at before update on public.gaming_sessions for each row execute function public.set_updated_at();
drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at before update on public.user_settings for each row execute function public.set_updated_at();

-- ---------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.announcements enable row level security;
alter table public.gaming_sessions enable row level security;
alter table public.gaming_session_members enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.user_settings enable row level security;

-- Profiles: account can read its own not-yet-authorized profile; authorized members see the roster.
drop policy if exists profiles_select_private on public.profiles;
create policy profiles_select_private on public.profiles for select to authenticated
using (id = auth.uid() or (public.is_authorized_member() and is_authorized = true));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid() and public.is_authorized_member())
with check (id = auth.uid() and public.is_authorized_member() and (avatar_path is null or left(avatar_path, length(auth.uid()::text) + 1) = (auth.uid()::text || '/')));
revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (username, display_name, bio, avatar_path, favorite_games, gaming_status) on public.profiles to authenticated;

-- Conversations: private items are visible only to their participants.
drop policy if exists conversations_select_members on public.conversations;
create policy conversations_select_members on public.conversations for select to authenticated
using (public.is_authorized_member() and public.is_conversation_member(id));
revoke all on public.conversations from anon;
grant select on public.conversations to authenticated;

-- Membership rows may be read by participants; creation goes through trusted RPC functions.
drop policy if exists conversation_members_select_members on public.conversation_members;
create policy conversation_members_select_members on public.conversation_members for select to authenticated
using (public.is_authorized_member() and public.is_conversation_member(conversation_id));
drop policy if exists conversation_members_update_read_marker on public.conversation_members;
create policy conversation_members_update_read_marker on public.conversation_members for update to authenticated
using (user_id = auth.uid() and public.is_authorized_member() and public.is_conversation_member(conversation_id))
with check (user_id = auth.uid() and public.is_authorized_member() and public.is_conversation_member(conversation_id));
revoke all on public.conversation_members from anon;
grant select on public.conversation_members to authenticated;
revoke update on public.conversation_members from authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;

-- Messages: all read/write operations require membership in that conversation.
drop policy if exists messages_select_participants on public.messages;
create policy messages_select_participants on public.messages for select to authenticated
using (public.is_authorized_member() and public.is_conversation_member(conversation_id));
drop policy if exists messages_insert_sender on public.messages;
create policy messages_insert_sender on public.messages for insert to authenticated
with check (sender_id = auth.uid() and public.is_authorized_member() and public.is_conversation_member(conversation_id) and (attachment_path is null or (split_part(attachment_path, '/', 1) = auth.uid()::text and split_part(attachment_path, '/', 2) = conversation_id::text)));
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages for update to authenticated
using (sender_id = auth.uid() and deleted_at is null and public.is_authorized_member() and public.is_conversation_member(conversation_id))
with check (sender_id = auth.uid() and public.is_authorized_member() and public.is_conversation_member(conversation_id) and (attachment_path is null or (split_part(attachment_path, '/', 1) = auth.uid()::text and split_part(attachment_path, '/', 2) = conversation_id::text)));
drop policy if exists messages_delete_own on public.messages; -- UI uses soft delete; hard delete is not granted to ordinary members.
revoke all on public.messages from anon;
grant select, insert, delete on public.messages to authenticated;
revoke update on public.messages from authenticated;
grant update (body, edited_at, deleted_at) on public.messages to authenticated;

-- Announcements: squad can read, only administrators can publish/change them.
drop policy if exists announcements_select_authorized on public.announcements;
create policy announcements_select_authorized on public.announcements for select to authenticated
using (public.is_authorized_member());
drop policy if exists announcements_admin_insert on public.announcements;
create policy announcements_admin_insert on public.announcements for insert to authenticated
with check (author_id = auth.uid() and public.is_squad_admin());
drop policy if exists announcements_admin_update on public.announcements;
create policy announcements_admin_update on public.announcements for update to authenticated
using (public.is_squad_admin()) with check (public.is_squad_admin());
drop policy if exists announcements_admin_delete on public.announcements;
create policy announcements_admin_delete on public.announcements for delete to authenticated
using (public.is_squad_admin());
revoke all on public.announcements from anon;
grant select, insert, update, delete on public.announcements to authenticated;

-- Gaming sessions.
drop policy if exists gaming_sessions_select_authorized on public.gaming_sessions;
create policy gaming_sessions_select_authorized on public.gaming_sessions for select to authenticated
using (public.is_authorized_member());
drop policy if exists gaming_sessions_insert_creator on public.gaming_sessions;
create policy gaming_sessions_insert_creator on public.gaming_sessions for insert to authenticated
with check (created_by = auth.uid() and public.is_authorized_member());
drop policy if exists gaming_sessions_update_owner_or_admin on public.gaming_sessions;
create policy gaming_sessions_update_owner_or_admin on public.gaming_sessions for update to authenticated
using (created_by = auth.uid() or public.is_squad_admin())
with check (created_by = auth.uid() or public.is_squad_admin());
drop policy if exists gaming_sessions_delete_owner_or_admin on public.gaming_sessions;
create policy gaming_sessions_delete_owner_or_admin on public.gaming_sessions for delete to authenticated
using (created_by = auth.uid() or public.is_squad_admin());
revoke all on public.gaming_sessions from anon;
grant select, insert, update, delete on public.gaming_sessions to authenticated;

-- Session roster: a member can join or leave themselves; creator/admin can remove any entry.
drop policy if exists gaming_session_members_select_authorized on public.gaming_session_members;
create policy gaming_session_members_select_authorized on public.gaming_session_members for select to authenticated
using (public.is_authorized_member());
drop policy if exists gaming_session_members_join_self on public.gaming_session_members;
create policy gaming_session_members_join_self on public.gaming_session_members for insert to authenticated
with check (user_id = auth.uid() and public.is_authorized_member() and exists (select 1 from public.gaming_sessions gs where gs.id = session_id and gs.status in ('scheduled','open')));
drop policy if exists gaming_session_members_leave_self_or_admin on public.gaming_session_members;
create policy gaming_session_members_leave_self_or_admin on public.gaming_session_members for delete to authenticated
using (public.is_authorized_member() and (user_id = auth.uid() or public.is_squad_admin() or exists (select 1 from public.gaming_sessions gs where gs.id = session_id and gs.created_by = auth.uid())));
revoke all on public.gaming_session_members from anon;
grant select, insert, delete on public.gaming_session_members to authenticated;

-- Activity feed: members can read; own safe events can be inserted by the app.
drop policy if exists activity_logs_select_authorized on public.activity_logs;
create policy activity_logs_select_authorized on public.activity_logs for select to authenticated
using (public.is_authorized_member());
drop policy if exists activity_logs_insert_own on public.activity_logs;
create policy activity_logs_insert_own on public.activity_logs for insert to authenticated
with check (actor_id = auth.uid() and public.is_authorized_member());
revoke all on public.activity_logs from anon;
grant select, insert on public.activity_logs to authenticated;

-- Notifications are per-recipient; the message trigger writes them as a trusted database owner.
drop policy if exists notifications_select_self on public.notifications;
create policy notifications_select_self on public.notifications for select to authenticated
using (recipient_id = auth.uid() and public.is_authorized_member());
drop policy if exists notifications_update_self on public.notifications;
create policy notifications_update_self on public.notifications for update to authenticated
using (recipient_id = auth.uid() and public.is_authorized_member())
with check (recipient_id = auth.uid() and public.is_authorized_member());
revoke all on public.notifications from anon;
grant select on public.notifications to authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Personal preferences.
drop policy if exists user_settings_select_self on public.user_settings;
create policy user_settings_select_self on public.user_settings for select to authenticated
using (user_id = auth.uid() and public.is_authorized_member());
drop policy if exists user_settings_insert_self on public.user_settings;
create policy user_settings_insert_self on public.user_settings for insert to authenticated
with check (user_id = auth.uid() and public.is_authorized_member());
drop policy if exists user_settings_update_self on public.user_settings;
create policy user_settings_update_self on public.user_settings for update to authenticated
using (user_id = auth.uid() and public.is_authorized_member())
with check (user_id = auth.uid() and public.is_authorized_member());
revoke all on public.user_settings from anon;
grant select, insert, update on public.user_settings to authenticated;

-- ---------------------------------------------------------
-- Private media bucket and object policies
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('codsquad-media', 'codsquad-media', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

create or replace function public.can_read_private_media(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_authorized_member() then return false; end if;
  if exists (select 1 from public.profiles p where p.avatar_path = p_path and p.is_authorized = true) then return true; end if;
  return exists (
    select 1 from public.messages m
    where m.attachment_path = p_path and m.deleted_at is null
      and public.is_conversation_member(m.conversation_id)
  );
end;
$$;
revoke all on function public.can_read_private_media(text) from public, anon;
grant execute on function public.can_read_private_media(text) to authenticated;

drop policy if exists codsquad_media_read_members on storage.objects;
create policy codsquad_media_read_members on storage.objects for select to authenticated
using (bucket_id = 'codsquad-media' and public.can_read_private_media(name));
drop policy if exists codsquad_media_insert_own on storage.objects;
create policy codsquad_media_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'codsquad-media' and public.is_authorized_member() and (storage.foldername(name))[1] = auth.uid()::text and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','gif'));
drop policy if exists codsquad_media_delete_own on storage.objects;
create policy codsquad_media_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'codsquad-media' and public.is_authorized_member() and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------
-- Realtime authorization + publication
-- ---------------------------------------------------------
-- Restrict private presence channel access to authorized CODSQUAD members.
drop policy if exists codsquad_presence_select on realtime.messages;
create policy codsquad_presence_select on realtime.messages for select to authenticated
using (realtime.topic() = 'codsquad-presence' and public.is_authorized_member());
drop policy if exists codsquad_presence_send on realtime.messages;
create policy codsquad_presence_send on realtime.messages for insert to authenticated
with check (realtime.topic() = 'codsquad-presence' and public.is_authorized_member());
drop policy if exists codsquad_presence_update on realtime.messages;
create policy codsquad_presence_update on realtime.messages for update to authenticated
using (realtime.topic() = 'codsquad-presence' and public.is_authorized_member())
with check (realtime.topic() = 'codsquad-presence' and public.is_authorized_member());
drop policy if exists codsquad_presence_delete on realtime.messages;
create policy codsquad_presence_delete on realtime.messages for delete to authenticated
using (realtime.topic() = 'codsquad-presence' and public.is_authorized_member());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      execute 'alter publication supabase_realtime add table public.messages';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members') then
      execute 'alter publication supabase_realtime add table public.conversation_members';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      execute 'alter publication supabase_realtime add table public.notifications';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements') then
      execute 'alter publication supabase_realtime add table public.announcements';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gaming_sessions') then
      execute 'alter publication supabase_realtime add table public.gaming_sessions';
    end if;
  end if;
end;
$$;

-- Explicit table grants: do not rely on project-wide default privileges.
revoke all on public.profiles, public.conversations, public.conversation_members, public.messages,
  public.announcements, public.gaming_sessions, public.gaming_session_members, public.activity_logs,
  public.notifications, public.user_settings from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (username, display_name, bio, avatar_path, favorite_games, gaming_status) on public.profiles to authenticated;
grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_id, body, attachment_path, attachment_mime) on public.messages to authenticated;
grant update (body, edited_at, deleted_at) on public.messages to authenticated;
grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert, update, delete on public.gaming_sessions to authenticated;
grant select, delete on public.gaming_session_members to authenticated;
grant insert (session_id, user_id) on public.gaming_session_members to authenticated;
grant select on public.activity_logs to authenticated;
grant insert (actor_id, event_type, title, detail, entity_id) on public.activity_logs to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update on public.user_settings to authenticated;

-- Trigger-only helpers and privileged functions are not public API endpoints.
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_message_rate_limit() from public, anon, authenticated;
revoke all on function public.touch_conversation_after_message() from public, anon, authenticated;
revoke all on function public.notify_conversation_members_on_message() from public, anon, authenticated;
revoke all on function public.notify_announcement_members() from public, anon, authenticated;
revoke all on function public.notify_session_members() from public, anon, authenticated;
