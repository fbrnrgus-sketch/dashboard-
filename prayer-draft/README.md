# 두 손 모아 — 중보기도를 나누는 곳

교회 성도들이 기도 제목을 나누고 함께 기도하는 웹앱입니다.
글·댓글·기도 수는 **Supabase**(Postgres)에 저장되어, 이제 기기와 상관없이 서로의 기도제목이 보입니다.

- 주소: https://fbrnrgus-sketch.github.io/dashboard-/prayer-draft/
- 공개 범위: **누구나 들어올 수 있는 공개 사이트** (검색엔진 노출 허용)
- 서버: Supabase 프로젝트 `fbrnrgus-sketch's Project` (ref `likxgtawtilzclfrbeeh`, ap-southeast-2)

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 화면 뼈대 (목록 · 글 하나 · 글쓰기 · 관리자) + Supabase JS CDN |
| `styles.css` | '새벽빛' 디자인 (남색→살구빛 배경, 흰 카드, 금빛 포인트) |
| `config.js` | Supabase 공개 키, 보관 일수, 신고 기준, 분류 목록 |
| `store.js` | **데이터 계층** — Supabase 함수(RPC) 호출. `app.js`가 쓰는 함수 이름·인자는 그대로 |
| `app.js` | 화면 그리기, 입력 처리, 음성 입력, 길 찾기, 관리자 로그인 |
| `supabase/schema.sql` | 서버 스키마(표 5개 · 함수 13개 · 권한) — SQL Editor에서 실행한 내용 그대로 |

## 기능 체크리스트

- [x] 기도 제목 목록 (최신순) · 카드형 · 분류 탭(전체·건강·가정·일터·감사·기타)
- [x] 글쓰기 — 제목 · 내용 · 분류 · **이름 공개 토글(기본 익명)**
- [x] **익명은 진짜 익명** — 토글을 끄면 이름을 서버에 저장하지 않음 (본인 확인용 기기 식별자만 별도 보관)
- [x] **함께 기도했어요** — 카드와 상세에서 하트 한 번. 같은 기기에서 중복 집계되지 않음(서버 unique)
- [x] **나눔(댓글)** — 글 하나에서 읽고 쓰기, 댓글도 익명/이름 공개 선택
- [x] **응답됨 표시** — 글쓴이·관리자만 (서버에서 확인)
- [x] **자동 정리** — 30일(`ARCHIVE_DAYS`) 지난 글은 기본 목록에서 내리고 '지난 기도제목'에서 볼 수 있음 (글은 남김)
- [x] **신고 + 자동 가림** — 한 기기당 1회 집계, 3회(`REPORT_HIDE_THRESHOLD`) 쌓이면 서버가 자동으로 가림
- [x] **가려진 글 보호** — 목록에서 빠지고, 글쓴이 본인과 관리자만 열 수 있음
- [x] **관리자 모드** — 하단 '관리자' 또는 주소 끝 `#admin` → Supabase Auth 이메일 로그인 → 신고 목록 확인, 가리기·복구·삭제
- [x] **삭제 권한** — 글쓴이 본인 + 관리자 (두 번 눌러 확인)
- [x] **음성 입력** — 글쓰기 마이크 버튼(Web Speech API, `ko-KR`). 미지원 브라우저·권한 거부·오류 안내 포함
- [x] **위기 상황 안내** — 자해·극단적 선택 관련 표현이 감지되면 게시 전에 상담전화 109 안내 (차단하지 않음)
- [x] **반응형** — 320px 모바일 ~ 데스크톱(최대 720px 가운데 정렬)
- [x] **검색 노출** — title/description/OG 메타태그
- [x] 첫 화면 샘플 기도제목 5건 (모두 가상 이름 · 연락처 없음)

## 서버 구조 (보안 경계)

```
브라우저 ──(공개 키: sb_publishable_…)──▶ Supabase 함수(RPC) ──▶ 표(posts·comments·prays·reports·admins)
                                              권한 확인(기기 식별자·관리자 여부)
```

- 표 5개는 **RLS를 켜고 정책을 두지 않았습니다.** 익명 키로 `posts` 표를 직접 읽거나 쓰면 `permission denied`가 납니다.
- 모든 읽기·쓰기는 `SECURITY DEFINER` 함수 13개를 통과하며, 함수 안에서 다음을 확인합니다.
  - 글쓰기·기도·댓글·신고: 기기 식별자(`device_id`) 길이 검사, 신고는 `(post_id, device_id)` 1회만 집계
  - 응답 표시·삭제: 글쓴이 본인 또는 관리자
  - 가림·복구·신고 목록·가려진 목록: 관리자만
- 응답에는 **기도자·신고자의 기기 식별자가 나가지 않습니다**(개수와 신고 사유만).
- `service_role`·secret 키는 코드에도, 저장소에도 없습니다.

### 관리자 인증

- `ADMIN_PIN` 하드코딩을 없앴습니다. 관리자 모드는 **Supabase Auth 이메일·비밀번호 로그인**입니다.
- `admins` 표에 등록된 이메일로 로그인한 사람만 관리자 함수를 쓸 수 있습니다. 현재 등록: `fbrnrgus@gmail.com`
- ⚠️ 그 이메일의 Auth 계정은 아직 없습니다. **관리자로 들어가려면 Supabase 대시보드 → Authentication → Users 에서 비밀번호를 정해 계정을 만들어야 합니다.** (계정을 만든 뒤 첫 로그인)

## 설정 바꾸기 (`config.js`)

```
window.DSM_CONFIG = {
  SITE_NAME: '두 손 모아',
  SUPABASE_URL: 'https://likxgtawtilzclfrbeeh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_…',   // 공개 키 (공개되어도 됨)
  ARCHIVE_DAYS: 30,
  REPORT_HIDE_THRESHOLD: 3,
  CATEGORIES: [ ... ]
}
```

- 분류를 바꾸면 목록 탭·글쓰기 선택지가 함께 바뀝니다. 다만 서버 함수 `add_post`의 분류 검사 목록과 `posts.category` 제약도 같은 값으로 바꿔야 합니다.
- 보관 일수·신고 기준은 화면과 서버가 같은 값을 씁니다(`ARCHIVE_DAYS`는 함수 인자로 전달, 신고 기준 3회는 서버 상수).

## 알려진 한계

1. **관리자 계정 등록이 아직 필요합니다.** (위 '관리자 인증' 참고)
2. **관리자 이메일 목록은 표에 있습니다.** 관리자를 추가·삭제하려면 `admins` 표를 고칩니다(SQL: `insert into public.admins(email) values ('…')`).
3. **음성 입력은 브라우저 지원에 달려 있습니다.** Chrome·Edge·삼성 인터넷(안드로이드)에서는 잘 되고, 사파리·파이어폭스에서는 버튼이 숨거나 안내 문구가 나옵니다.
4. **위기 안내는 안내만 합니다.** 글을 막지 않으며, 표현을 놓칠 수 있습니다.
5. **공개 사이트입니다.** 누구나 글을 쓸 수 있으므로 신고·가림 절차를 그대로 두고, 연락처·주소 같은 개인정보는 적지 않도록 안내 문구를 화면에 두었습니다.

## 데이터 확인·정리 (운영자용)

Supabase SQL Editor에서:

```
-- 전체 글 수 / 최근 글
select count(*) from public.posts;
select title, created_at, hidden from public.posts order by created_at desc limit 20;

-- 신고가 쌓인 글
select p.title, count(r.id) as reports from public.posts p
  join public.reports r on r.post_id = p.id group by p.id order by reports desc;
```

화면의 글 삭제는 글쓴이·관리자만 가능합니다. 관리자 계정이 없는 동안은 SQL Editor(서비스 권한)에서 정리하면 됩니다.
