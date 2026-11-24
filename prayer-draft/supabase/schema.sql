-- ==========================================================================
-- 두 손 모아 · Supabase 스키마 (v1)
-- Supabase SQL Editor 에서 그대로 실행하세요. 여러 번 실행해도 안전합니다.
-- --------------------------------------------------------------------------
-- 설계 요점
--  * 테이블 4개 + 관리자 명단(admins)
--  * 테이블에는 RLS 를 켜고 정책을 두지 않습니다 → anon 키로 직접 표에
--    접근할 수 없습니다. 모든 읽기/쓰기는 SECURITY DEFINER 함수를 통해서만
--    이뤄지고, 함수 안에서 기기 식별자(device_id)와 관리자 여부를 확인합니다.
--  * 기도자·신고자의 기기 식별자는 화면으로 내보내지 않고 개수만 돌려줍니다.
--  * 관리자 판별: auth.jwt() 의 email 이 admins 표에 있는가 (Supabase Auth)
-- ==========================================================================

create extension if not exists pgcrypto;

-- ── 테이블 ────────────────────────────────────────────────────────────────

create table if not exists public.posts (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 1 and 60),
  body             text not null check (char_length(body) between 1 and 1000),
  category         text not null default 'other'
                     check (category in ('health', 'family', 'work', 'thanks', 'other')),
  author_name      text check (author_name is null or char_length(author_name) <= 20),
  name_public      boolean not null default false,
  device_id        text not null check (char_length(device_id) between 8 and 64),
  answered         boolean not null default false,
  answered_at      timestamptz,
  hidden           boolean not null default false,
  hidden_by_report boolean not null default false,
  hidden_at        timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  author_name text check (author_name is null or char_length(author_name) <= 20),
  name_public boolean not null default false,
  device_id   text not null check (char_length(device_id) between 8 and 64),
  created_at  timestamptz not null default now()
);

create table if not exists public.prays (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  device_id  text not null check (char_length(device_id) between 8 and 64),
  created_at timestamptz not null default now(),
  unique (post_id, device_id)
);

create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  device_id  text not null check (char_length(device_id) between 8 and 64),
  reason     text not null default '기타',
  created_at timestamptz not null default now(),
  unique (post_id, device_id)
);

create table if not exists public.admins (
  email      text primary key,
  created_at timestamptz not null default now()
);

create index if not exists posts_created_idx  on public.posts (created_at desc);
create index if not exists posts_device_idx   on public.posts (device_id);
create index if not exists comments_post_idx  on public.comments (post_id, created_at);
create index if not exists prays_post_idx     on public.prays (post_id);
create index if not exists reports_post_idx   on public.reports (post_id);

-- ── 접근 차단 (RLS + 직접 권한 회수) ──────────────────────────────────────

alter table public.posts    enable row level security;
alter table public.comments enable row level security;
alter table public.prays    enable row level security;
alter table public.reports  enable row level security;
alter table public.admins   enable row level security;

revoke all on public.posts    from anon, authenticated;
revoke all on public.comments from anon, authenticated;
revoke all on public.prays    from anon, authenticated;
revoke all on public.reports  from anon, authenticated;
revoke all on public.admins   from anon, authenticated;

-- ── 공통 도우미 ───────────────────────────────────────────────────────────

-- 로그인한 사람이 관리자 명단에 있는가
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.admins a
     where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 글 하나를 화면이 쓰는 모양(JSON)으로 만들어 준다.
create or replace function public.post_json(
  p_id uuid,
  p_device_id text,
  p_archive_days int default 30
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id',             p.id,
    'title',          p.title,
    'body',           p.body,
    'category',       p.category,
    'authorName',     case when p.name_public then p.author_name else null end,
    'namePublic',     p.name_public,
    'createdAt',      to_jsonb(p.created_at),
    'answered',       p.answered,
    'answeredAt',     to_jsonb(p.answered_at),
    'hidden',         p.hidden,
    'hiddenByReport', p.hidden_by_report,
    'hiddenAt',       to_jsonb(p.hidden_at),
    'prayCount',      (select count(*) from public.prays x where x.post_id = p.id),
    'prayed',         exists (select 1 from public.prays x
                               where x.post_id = p.id and x.device_id = p_device_id),
    'commentCount',   (select count(*) from public.comments c where c.post_id = p.id),
    'reportCount',    (select count(*) from public.reports r where r.post_id = p.id),
    'reportReasons',  coalesce((select jsonb_agg(r.reason order by r.created_at)
                                  from public.reports r where r.post_id = p.id), '[]'::jsonb),
    'isMine',         (p.device_id = p_device_id),
    'archived',       (now() - p.created_at) > make_interval(days => greatest(p_archive_days, 0)),
    'comments',       coalesce((select jsonb_agg(jsonb_build_object(
                                 'id',         c.id,
                                 'authorName', case when c.name_public then c.author_name else null end,
                                 'namePublic', c.name_public,
                                 'body',       c.body,
                                 'createdAt',  to_jsonb(c.created_at)
                               ) order by c.created_at)
                                from public.comments c where c.post_id = p.id), '[]'::jsonb)
  )
  from public.posts p
  where p.id = p_id;
$$;

-- ── 읽기 ──────────────────────────────────────────────────────────────────

create or replace function public.list_posts(
  p_device_id text,
  p_category text default null,
  p_archived text default 'exclude',
  p_archive_days int default 30,
  p_include_hidden boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb)
    from (
      select public.post_json(p.id, p_device_id, p_archive_days) as j,
             p.created_at
        from public.posts p
       where (p_include_hidden or not p.hidden)
         and (coalesce(p_category, 'all') = 'all' or p.category = p_category)
         and case coalesce(p_archived, 'exclude')
               when 'only'    then (now() - p.created_at) > make_interval(days => greatest(p_archive_days, 0))
               when 'include' then true
               else               (now() - p.created_at) <= make_interval(days => greatest(p_archive_days, 0))
             end
    ) x;
$$;

create or replace function public.get_post(
  p_id uuid,
  p_device_id text,
  p_archive_days int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hidden boolean;
  v_device text;
begin
  select p.hidden, p.device_id into v_hidden, v_device
    from public.posts p where p.id = p_id;

  if not found then
    return null;
  end if;

  -- 가려진 글은 글쓴이 본인과 관리자만 볼 수 있다.
  if v_hidden and v_device is distinct from p_device_id and not public.is_admin() then
    return null;
  end if;

  return public.post_json(p_id, p_device_id, p_archive_days);
end;
$$;

-- ── 쓰기 ──────────────────────────────────────────────────────────────────

create or replace function public.add_post(
  p_title text,
  p_body text,
  p_category text,
  p_author_name text,
  p_name_public boolean,
  p_device_id text,
  p_archive_days int default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_cat   text := coalesce(p_category, 'other');
  v_name  text := btrim(coalesce(p_author_name, ''));
  v_public boolean;
begin
  if char_length(coalesce(p_device_id, '')) < 8 then
    raise exception '기기 식별자가 없습니다.' using errcode = '22023';
  end if;
  if char_length(v_title) < 1 then
    raise exception '제목을 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 then
    raise exception '내용을 적어 주세요.' using errcode = '22023';
  end if;

  v_public := coalesce(p_name_public, false) and char_length(v_name) > 0;

  insert into public.posts (title, body, category, author_name, name_public, device_id)
  values (
    left(v_title, 60),
    left(v_body, 1000),
    case when v_cat in ('health', 'family', 'work', 'thanks', 'other') then v_cat else 'other' end,
    case when v_public then left(v_name, 20) else null end,
    v_public,
    p_device_id
  )
  returning id into v_id;

  return public.post_json(v_id, p_device_id, p_archive_days);
end;
$$;

create or replace function public.toggle_pray(
  p_post_id uuid,
  p_device_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_prayed boolean;
  v_count int;
begin
  perform 1 from public.posts where id = p_post_id;
  if not found then
    return null;
  end if;
  if char_length(coalesce(p_device_id, '')) < 8 then
    raise exception '기기 식별자가 없습니다.' using errcode = '22023';
  end if;

  delete from public.prays
   where post_id = p_post_id and device_id = p_device_id;

  if found then
    v_prayed := false;
  else
    insert into public.prays (post_id, device_id)
    values (p_post_id, p_device_id)
    on conflict (post_id, device_id) do nothing;
    v_prayed := true;
  end if;

  select count(*) into v_count from public.prays where post_id = p_post_id;

  return jsonb_build_object('prayed', v_prayed, 'count', v_count);
end;
$$;

create or replace function public.add_comment(
  p_post_id uuid,
  p_body text,
  p_author_name text,
  p_name_public boolean,
  p_device_id text,
  p_archive_days int default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_name text := btrim(coalesce(p_author_name, ''));
  v_public boolean;
begin
  perform 1 from public.posts where id = p_post_id;
  if not found then
    return null;
  end if;
  if char_length(v_body) < 1 then
    raise exception '나눌 내용을 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_device_id, '')) < 8 then
    raise exception '기기 식별자가 없습니다.' using errcode = '22023';
  end if;

  v_public := coalesce(p_name_public, false) and char_length(v_name) > 0;

  insert into public.comments (post_id, body, author_name, name_public, device_id)
  values (p_post_id, left(v_body, 500),
          case when v_public then left(v_name, 20) else null end,
          v_public, p_device_id);

  return public.post_json(p_post_id, p_device_id, p_archive_days);
end;
$$;

create or replace function public.set_answered(
  p_post_id uuid,
  p_answered boolean,
  p_device_id text,
  p_archive_days int default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_device text;
begin
  select p.device_id into v_device from public.posts p where p.id = p_post_id;
  if not found then
    return null;
  end if;
  if v_device is distinct from p_device_id and not public.is_admin() then
    raise exception '응답 표시는 글쓴이와 관리자만 할 수 있습니다.' using errcode = '42501';
  end if;

  update public.posts
     set answered = coalesce(p_answered, false),
         answered_at = case when coalesce(p_answered, false) then now() else null end
   where id = p_post_id;

  return public.post_json(p_post_id, p_device_id, p_archive_days);
end;
$$;

create or replace function public.report_post(
  p_post_id uuid,
  p_reason text,
  p_device_id text,
  p_archive_days int default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_already boolean;
  v_count int;
  v_threshold int := 3;
begin
  perform 1 from public.posts where id = p_post_id;
  if not found then
    return null;
  end if;
  if char_length(coalesce(p_device_id, '')) < 8 then
    raise exception '기기 식별자가 없습니다.' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.reports
     where post_id = p_post_id and device_id = p_device_id
  ) into v_already;

  if not v_already then
    insert into public.reports (post_id, device_id, reason)
    values (p_post_id, p_device_id,
            left(coalesce(nullif(btrim(coalesce(p_reason, '')), ''), '기타'), 40))
    on conflict (post_id, device_id) do nothing;
  end if;

  select count(*) into v_count from public.reports where post_id = p_post_id;

  if v_count >= v_threshold then
    update public.posts
       set hidden = true,
           hidden_by_report = true,
           hidden_at = coalesce(hidden_at, now())
     where id = p_post_id and not hidden;
  end if;

  return public.post_json(p_post_id, p_device_id, p_archive_days)
         || jsonb_build_object('alreadyReported', v_already);
end;
$$;

create or replace function public.delete_post(
  p_post_id uuid,
  p_device_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin boolean := public.is_admin();
begin
  if v_admin then
    delete from public.posts where id = p_post_id;
  else
    delete from public.posts where id = p_post_id and device_id = p_device_id;
  end if;

  return found;
end;
$$;

-- ── 관리자 전용 ───────────────────────────────────────────────────────────

create or replace function public.set_hidden(
  p_post_id uuid,
  p_hidden boolean,
  p_device_id text,
  p_archive_days int default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
  end if;

  perform 1 from public.posts where id = p_post_id;
  if not found then
    return null;
  end if;

  update public.posts
     set hidden = coalesce(p_hidden, false),
         hidden_by_report = case when coalesce(p_hidden, false) then hidden_by_report else false end,
         hidden_at = case when coalesce(p_hidden, false) then coalesce(hidden_at, now()) else null end
   where id = p_post_id;

  return public.post_json(p_post_id, p_device_id, p_archive_days);
end;
$$;

create or replace function public.admin_reported_posts(
  p_device_id text,
  p_archive_days int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(x.j order by x.report_count desc, x.created_at desc)
      from (
        select public.post_json(p.id, p_device_id, p_archive_days) as j,
               (select count(*) from public.reports r where r.post_id = p.id) as report_count,
               p.created_at
          from public.posts p
         where exists (select 1 from public.reports r where r.post_id = p.id)
      ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_hidden_posts(
  p_device_id text,
  p_archive_days int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc)
      from (
        select public.post_json(p.id, p_device_id, p_archive_days) as j,
               p.created_at
          from public.posts p
         where p.hidden
      ) x
  ), '[]'::jsonb);
end;
$$;

-- ── 함수 실행 권한 (anon 키로 호출 가능 · 표 직접 접근은 막혀 있음) ────────

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.post_json(uuid, text, int) to anon, authenticated;
grant execute on function public.list_posts(text, text, text, int, boolean) to anon, authenticated;
grant execute on function public.get_post(uuid, text, int) to anon, authenticated;
grant execute on function public.add_post(text, text, text, text, boolean, text, int) to anon, authenticated;
grant execute on function public.toggle_pray(uuid, text) to anon, authenticated;
grant execute on function public.add_comment(uuid, text, text, boolean, text, int) to anon, authenticated;
grant execute on function public.set_answered(uuid, boolean, text, int) to anon, authenticated;
grant execute on function public.report_post(uuid, text, text, int) to anon, authenticated;
grant execute on function public.delete_post(uuid, text) to anon, authenticated;
grant execute on function public.set_hidden(uuid, boolean, text, int) to anon, authenticated;
grant execute on function public.admin_reported_posts(text, int) to anon, authenticated;
grant execute on function public.admin_hidden_posts(text, int) to anon, authenticated;

-- ── 관리자 명단 ───────────────────────────────────────────────────────────
-- Supabase Auth 에 같은 이메일의 계정이 있어야 실제로 로그인할 수 있습니다.

insert into public.admins (email) values ('fbrnrgus@gmail.com')
on conflict (email) do nothing;

-- ── 첫 화면용 샘플 (글이 하나도 없을 때만) ────────────────────────────────

do $$
declare
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; v5 uuid;
begin
  if (select count(*) from public.posts) > 0 then
    return;
  end if;

  insert into public.posts (title, body, category, author_name, name_public, device_id, created_at)
  values ('아버지 수술이 잘 마치도록 기도 부탁드립니다',
          E'다음 주 화요일에 아버지가 큰 수술을 받습니다.\n의료진의 손길이 정확하고, 회복이 순조롭도록 함께 기도해 주세요.',
          'health', '김○○', true, 'sample-owner-a', now() - interval '3 hours')
  returning id into v1;

  insert into public.posts (title, body, category, author_name, name_public, device_id, created_at)
  values ('아이의 새 학기를 앞두고',
          '아이가 새 학교에 잘 적응할 수 있도록, 그리고 저희 부부가 조급해지지 않도록 기도 부탁드립니다.',
          'family', null, false, 'sample-owner-b', now() - interval '1 day 2 hours')
  returning id into v2;

  insert into public.posts (title, body, category, author_name, name_public, device_id, created_at)
  values ('직장에서 지혜를 구합니다',
          '여러 사람의 마음을 설득해야 하는 자리입니다. 말에 은혜가 있고, 판단이 흔들리지 않도록 기도해 주세요.',
          'work', '이○○', true, 'sample-owner-c', now() - interval '3 days 5 hours')
  returning id into v3;

  insert into public.posts (title, body, category, author_name, name_public, device_id, created_at,
                            answered, answered_at)
  values ('기도의 응답을 나눕니다',
          E'지난달 함께 기도해 주신 일이 잘 마무리되었습니다.\n기도해 주신 모든 분께 감사드립니다.',
          'thanks', '박○○', true, 'sample-owner-d', now() - interval '5 days',
          true, now() - interval '5 days')
  returning id into v4;

  insert into public.posts (title, body, category, author_name, name_public, device_id, created_at)
  values ('회복 중인 가족을 위해',
          '오랜 병원 생활 끝에 집으로 돌아왔습니다. 하루하루 기운을 되찾아 가도록 기도해 주세요.',
          'health', null, false, 'sample-owner-e', now() - interval '38 days')
  returning id into v5;

  insert into public.prays (post_id, device_id, created_at)
  select v, 'sample-prayer-' || v::text || '-' || g, now() - interval '1 hour'
    from (values (v1, 7), (v2, 3), (v3, 5), (v4, 12), (v5, 2)) as t(v, n),
         generate_series(1, 12) as g
   where g <= t.n;

  insert into public.comments (post_id, body, author_name, name_public, device_id, created_at)
  values (v3, '함께 기도하겠습니다. 지혜가 있기를.', '최○○', true, 'sample-commenter-a', now() - interval '3 days 1 hour'),
         (v3, '말씀하실 때 은혜가 있기를 기도합니다.', null, false, 'sample-commenter-b', now() - interval '2 days 4 hours');
end;
$$;
