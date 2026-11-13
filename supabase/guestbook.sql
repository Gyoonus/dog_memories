-- 방명록 (guestbook.js) 의 Supabase 설정 — 저장소용 사본 (비밀번호 없음)
-- 실제로 실행하는 파일은 식구 비밀번호가 들어 있어서 저장소에 두지 않아요. 이 사본은 표 · 함수 구조를 남겨 두는 용도예요.
-- 이 사본만 실행하면 식구가 없어서 아무도 들어올 수 없어요 (맨 아래 안내 참고).

-- ----------------------------------------------------------------
-- 준비: 비밀번호 암호화(pgcrypto)와, 바깥에서 보이지 않는 칸(gb_private)
-- ----------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create schema if not exists gb_private;
revoke all on schema gb_private from public, anon, authenticated;

-- 식구 (이름 · 비밀번호 해시 · 관리자)
create table if not exists gb_private.members (
  id           int generated always as identity primary key,
  name         text not null unique check (char_length(name) between 1 and 20),
  pass_hash    text not null,
  is_admin     boolean not null default false,
  locked_until timestamptz,             -- 비밀번호를 너무 많이 틀리면 이때까지 잠김
  last_ok_at   timestamptz,             -- 마지막으로 들어온 때
  created_at   timestamptz not null default now()
);

-- 들어와 있는 기기 (토큰 자체가 아니라 토큰의 sha256만 저장)
create table if not exists gb_private.sessions (
  token_hash bytea primary key,
  member_id  int not null references gb_private.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_member_idx on gb_private.sessions (member_id);
create index if not exists sessions_expires_idx on gb_private.sessions (expires_at);

-- 틀린 비밀번호 기록 (잠금 계산용)
create table if not exists gb_private.login_fails (
  id        bigint generated always as identity primary key,
  member_id int not null references gb_private.members(id) on delete cascade,
  at        timestamptz not null default now()
);
create index if not exists login_fails_member_at_idx on gb_private.login_fails (member_id, at);

-- 방명록 글 (지운 글은 deleted_at만 채워 둔다: 실수로 지워도 되살릴 수 있게)
create table if not exists gb_private.notes (
  id         bigint generated always as identity primary key,
  member_id  int not null references gb_private.members(id),
  dog        text not null check (dog in ('all', 'pinky', 'dami', 'pupu', 'jaerong', 'alpang')),
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,
  deleted_by int references gb_private.members(id)
);
create index if not exists notes_live_idx on gb_private.notes (id desc) where deleted_at is null;
create index if not exists notes_dog_idx on gb_private.notes (dog, id desc) where deleted_at is null;
create index if not exists notes_member_time_idx on gb_private.notes (member_id, created_at);

-- 표는 함수로만 다룬다: 행 보안을 켜고 정책은 두지 않는다 (API 역할은 아무것도 못 읽고 못 쓴다)
alter table gb_private.members     enable row level security;
alter table gb_private.sessions    enable row level security;
alter table gb_private.login_fails enable row level security;
alter table gb_private.notes       enable row level security;
revoke all on all tables    in schema gb_private from public, anon, authenticated;
revoke all on all sequences in schema gb_private from public, anon, authenticated;

-- ----------------------------------------------------------------
-- 안쪽 도우미 (gb_private: 바깥에서 부를 수 없음)
-- ----------------------------------------------------------------
-- 토큰 → 식구 id (없거나 만료면 null)
create or replace function gb_private.session_member(p_token text)
returns int
language sql stable
set search_path = ''
as $$
  select s.member_id
    from gb_private.sessions s
   where p_token is not null
     and pg_catalog.char_length(p_token) = 36
     and s.token_hash = extensions.digest(pg_catalog.lower(p_token), 'sha256')
     and s.expires_at > pg_catalog.now()
$$;

-- 글 본문 다듬기: 줄바꿈은 \n 으로, 앞뒤 빈칸·빈 줄은 잘라낸다
create or replace function gb_private.clean_body(p_body text)
returns text
language sql immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
           pg_catalog.replace(pg_catalog.replace(coalesce(p_body, ''), E'\r\n', E'\n'), E'\r', E'\n'),
           '^[\s 　﻿]+|[\s 　﻿]+$', '', 'g')
$$;

-- 글 하나를 화면에 보낼 모양으로
create or replace function gb_private.note_json(p_id bigint, p_me int, p_admin boolean)
returns jsonb
language sql stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', n.id, 'author', m.name, 'admin_author', m.is_admin, 'dog', n.dog, 'body', n.body,
           'created_at', n.created_at, 'edited_at', n.edited_at,
           'mine', n.member_id = p_me, 'can_edit', n.member_id = p_me, 'can_delete', (n.member_id = p_me or p_admin))
    from gb_private.notes n
    join gb_private.members m on m.id = n.member_id
   where n.id = p_id
$$;

revoke all on function gb_private.session_member(text) from public, anon, authenticated;
revoke all on function gb_private.clean_body(text) from public, anon, authenticated;
revoke all on function gb_private.note_json(bigint, int, boolean) from public, anon, authenticated;

-- ----------------------------------------------------------------
-- 바깥에서 부르는 함수 (public · security definer)
-- 실패는 예외를 던지지 않고 {ok:false, error:'...'} 로 돌려준다.
-- (예외를 던지면 그 함수가 쓴 기록까지 되돌려져서, 틀린 횟수가 쌓이지 않는다)
-- ----------------------------------------------------------------

-- 들어가기: {ok, token, name, admin} | {ok:false, error:'wrong', left} | {ok:false, error:'locked', minutes} | {ok:false, error:'unknown'}
create or replace function public.gb_login(p_name text, p_pass text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       gb_private.members;
  v_fails int;
  v_token uuid;
begin
  select * into m from gb_private.members where name = pg_catalog.btrim(coalesce(p_name, '')) for update;
  if not found then
    return pg_catalog.json_build_object('ok', false, 'error', 'unknown');
  end if;

  if m.locked_until is not null and m.locked_until > pg_catalog.now() then
    return pg_catalog.json_build_object('ok', false, 'error', 'locked',
      'minutes', greatest(1, pg_catalog.ceil(extract(epoch from (m.locked_until - pg_catalog.now())) / 60))::int);
  end if;

  if p_pass is not null and pg_catalog.octet_length(p_pass) <= 72
     and m.pass_hash = extensions.crypt(p_pass, m.pass_hash) then
    delete from gb_private.login_fails where member_id = m.id;
    delete from gb_private.sessions where expires_at <= pg_catalog.now();
    update gb_private.members set last_ok_at = pg_catalog.now(), locked_until = null where id = m.id;
    v_token := pg_catalog.gen_random_uuid();
    insert into gb_private.sessions (token_hash, member_id, expires_at)
      values (extensions.digest(v_token::text, 'sha256'), m.id, pg_catalog.now() + interval '60 days');
    return pg_catalog.json_build_object('ok', true, 'token', v_token, 'name', m.name, 'admin', m.is_admin);
  end if;

  -- 틀렸다: 기록하고 (15분 안에 8번이면 15분 잠금)
  insert into gb_private.login_fails (member_id) values (m.id);
  delete from gb_private.login_fails where member_id = m.id and at < pg_catalog.now() - interval '1 day';
  select pg_catalog.count(*) into v_fails
    from gb_private.login_fails
   where member_id = m.id and at > pg_catalog.now() - interval '15 minutes';
  if v_fails >= 8 then
    update gb_private.members set locked_until = pg_catalog.now() + interval '15 minutes' where id = m.id;
    delete from gb_private.login_fails where member_id = m.id;
    return pg_catalog.json_build_object('ok', false, 'error', 'locked', 'minutes', 15);
  end if;
  return pg_catalog.json_build_object('ok', false, 'error', 'wrong', 'left', 8 - v_fails);
end
$$;

-- 지금 누구인지 (열 때마다 기한을 60일로 다시 늘린다): {ok, name, admin} | {ok:false, error:'auth'}
create or replace function public.gb_me(p_token text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mid int := gb_private.session_member(p_token);
  m     gb_private.members;
begin
  if v_mid is null then
    return pg_catalog.json_build_object('ok', false, 'error', 'auth');
  end if;
  update gb_private.sessions set expires_at = pg_catalog.now() + interval '60 days'
   where token_hash = extensions.digest(pg_catalog.lower(p_token), 'sha256')
     and expires_at < pg_catalog.now() + interval '59 days';
  select * into m from gb_private.members where id = v_mid;
  return pg_catalog.json_build_object('ok', true, 'name', m.name, 'admin', m.is_admin);
end
$$;

-- 나가기: 이 기기의 토큰을 지운다
create or replace function public.gb_logout(p_token text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is not null and pg_catalog.char_length(p_token) = 36 then
    delete from gb_private.sessions where token_hash = extensions.digest(pg_catalog.lower(p_token), 'sha256');
  end if;
  return pg_catalog.json_build_object('ok', true);
end
$$;

-- 글 목록 (새 글부터, p_before 보다 오래된 것, 강아지별): {ok, notes:[...], more}
create or replace function public.gb_list(p_token text, p_dog text default null, p_before bigint default null, p_limit int default 30)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mid   int := gb_private.session_member(p_token);
  v_admin boolean;
  v_lim   int := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_notes jsonb;
  v_min   bigint;
  v_more  boolean;
begin
  if v_mid is null then
    return pg_catalog.json_build_object('ok', false, 'error', 'auth');
  end if;
  if p_dog is not null and p_dog not in ('all', 'pinky', 'dami', 'pupu', 'jaerong', 'alpang') then
    return pg_catalog.json_build_object('ok', false, 'error', 'dog');
  end if;
  select m.is_admin into v_admin from gb_private.members m where m.id = v_mid;

  select coalesce(pg_catalog.jsonb_agg(gb_private.note_json(x.id, v_mid, v_admin) order by x.id desc), '[]'::jsonb), pg_catalog.min(x.id)
    into v_notes, v_min
    from (select n.id from gb_private.notes n
           where n.deleted_at is null
             and (p_dog is null or n.dog = p_dog)
             and (p_before is null or n.id < p_before)
           order by n.id desc
           limit v_lim) x;

  v_more := v_min is not null and exists (
    select 1 from gb_private.notes n
     where n.deleted_at is null and (p_dog is null or n.dog = p_dog) and n.id < v_min);

  return pg_catalog.json_build_object('ok', true, 'notes', v_notes, 'more', v_more);
end
$$;

-- 글 남기기 (5초에 한 번, 하루 60개까지): {ok, note} | {ok:false, error:'dog'|'empty'|'long'|'slow'(wait)|'daily'|'auth'}
create or replace function public.gb_post(p_token text, p_dog text, p_body text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mid   int := gb_private.session_member(p_token);
  v_admin boolean;
  v_body  text := gb_private.clean_body(p_body);
  v_last  timestamptz;
  v_day   int;
  v_id    bigint;
begin
  if v_mid is null then
    return pg_catalog.json_build_object('ok', false, 'error', 'auth');
  end if;
  if p_dog is null or p_dog not in ('all', 'pinky', 'dami', 'pupu', 'jaerong', 'alpang') then
    return pg_catalog.json_build_object('ok', false, 'error', 'dog');
  end if;
  if v_body = '' then
    return pg_catalog.json_build_object('ok', false, 'error', 'empty');
  end if;
  if pg_catalog.char_length(v_body) > 500 then
    return pg_catalog.json_build_object('ok', false, 'error', 'long');
  end if;

  -- 같은 식구의 글쓰기는 한 줄로 세운다 (동시에 눌러도 속도 제한이 지켜지게)
  select m.is_admin into v_admin from gb_private.members m where m.id = v_mid for update;

  select pg_catalog.max(n.created_at) into v_last from gb_private.notes n where n.member_id = v_mid;
  if v_last is not null and v_last > pg_catalog.now() - interval '5 seconds' then
    return pg_catalog.json_build_object('ok', false, 'error', 'slow',
      'wait', greatest(1, pg_catalog.ceil(5 - extract(epoch from (pg_catalog.now() - v_last))))::int);
  end if;
  select pg_catalog.count(*) into v_day
    from gb_private.notes n
   where n.member_id = v_mid and n.created_at > pg_catalog.now() - interval '1 day';
  if v_day >= 60 then
    return pg_catalog.json_build_object('ok', false, 'error', 'daily');
  end if;

  insert into gb_private.notes (member_id, dog, body) values (v_mid, p_dog, v_body) returning id into v_id;
  return pg_catalog.json_build_object('ok', true, 'note', gb_private.note_json(v_id, v_mid, v_admin));
end
$$;

-- 글 고치기 (자기 글만): {ok, note} | {ok:false, error:'empty'|'long'|'gone'|'forbidden'|'auth'}
create or replace function public.gb_edit(p_token text, p_id bigint, p_body text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mid   int := gb_private.session_member(p_token);
  v_admin boolean;
  v_body  text := gb_private.clean_body(p_body);
  n       gb_private.notes;
begin
  if v_mid is null then
    return pg_catalog.json_build_object('ok', false, 'error', 'auth');
  end if;
  if v_body = '' then
    return pg_catalog.json_build_object('ok', false, 'error', 'empty');
  end if;
  if pg_catalog.char_length(v_body) > 500 then
    return pg_catalog.json_build_object('ok', false, 'error', 'long');
  end if;
  select * into n from gb_private.notes where id = p_id for update;
  if not found or n.deleted_at is not null then
    return pg_catalog.json_build_object('ok', false, 'error', 'gone');
  end if;
  if n.member_id <> v_mid then
    return pg_catalog.json_build_object('ok', false, 'error', 'forbidden');
  end if;
  if n.body is distinct from v_body then
    update gb_private.notes set body = v_body, edited_at = pg_catalog.now() where id = p_id;
  end if;
  select m.is_admin into v_admin from gb_private.members m where m.id = v_mid;
  return pg_catalog.json_build_object('ok', true, 'note', gb_private.note_json(p_id, v_mid, v_admin));
end
$$;

-- 글 지우기 (자기 글, 규시기는 모든 글): {ok} | {ok:false, error:'gone'|'forbidden'|'auth'}
create or replace function public.gb_delete(p_token text, p_id bigint)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mid   int := gb_private.session_member(p_token);
  v_admin boolean;
  n       gb_private.notes;
begin
  if v_mid is null then
    return pg_catalog.json_build_object('ok', false, 'error', 'auth');
  end if;
  select * into n from gb_private.notes where id = p_id for update;
  if not found or n.deleted_at is not null then
    return pg_catalog.json_build_object('ok', false, 'error', 'gone');
  end if;
  select m.is_admin into v_admin from gb_private.members m where m.id = v_mid;
  if n.member_id <> v_mid and not coalesce(v_admin, false) then
    return pg_catalog.json_build_object('ok', false, 'error', 'forbidden');
  end if;
  update gb_private.notes set deleted_at = pg_catalog.now(), deleted_by = v_mid where id = p_id;
  return pg_catalog.json_build_object('ok', true);
end
$$;

-- 바깥(anon · authenticated)에서는 이 일곱 함수만 부를 수 있다
revoke all on function public.gb_login(text, text)                   from public;
revoke all on function public.gb_me(text)                            from public;
revoke all on function public.gb_logout(text)                        from public;
revoke all on function public.gb_list(text, text, bigint, int)       from public;
revoke all on function public.gb_post(text, text, text)              from public;
revoke all on function public.gb_edit(text, bigint, text)            from public;
revoke all on function public.gb_delete(text, bigint)                from public;
grant execute on function public.gb_login(text, text)                to anon, authenticated;
grant execute on function public.gb_me(text)                         to anon, authenticated;
grant execute on function public.gb_logout(text)                     to anon, authenticated;
grant execute on function public.gb_list(text, text, bigint, int)    to anon, authenticated;
grant execute on function public.gb_post(text, text, text)           to anon, authenticated;
grant execute on function public.gb_edit(text, bigint, text)         to anon, authenticated;
grant execute on function public.gb_delete(text, bigint)             to anon, authenticated;

-- ================================================================
-- 식구 네 명 (이름 · 비밀번호 · 관리자)
-- 비밀번호는 저장소에 두지 않아요. 실제 설정 파일에만 있고, 데이터베이스에는 bcrypt 해시로만 들어가요.
-- 모양만 남겨 두면:
--   insert into gb_private.members (name, pass_hash, is_admin) values
--     ('재롱맘', extensions.crypt('<비밀번호>', extensions.gen_salt('bf', 10)), false),
--     ('푸맘',   extensions.crypt('<비밀번호>', extensions.gen_salt('bf', 10)), false),
--     ('규시기', extensions.crypt('<비밀번호>', extensions.gen_salt('bf', 10)), true),
--     ('담온니', extensions.crypt('<비밀번호>', extensions.gen_salt('bf', 10)), false)
--   on conflict (name) do update set pass_hash = excluded.pass_hash, is_admin = excluded.is_admin;
-- ================================================================

-- Data API가 새 함수를 바로 알아보게
notify pgrst, 'reload schema';
