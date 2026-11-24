/* ==========================================================================
   config.js — 「두 손 모아」 설정
   --------------------------------------------------------------------------
   SUPABASE_URL / SUPABASE_ANON_KEY 는 공개되어도 되는 값입니다(브라우저에
   내려가는 공개 키). 표에 직접 접근할 수는 없고, 서버 함수가 권한을 확인합니다.
   ⚠️ service_role·secret 키는 절대 이 파일에 넣지 마세요.
   관리자 모드는 Supabase Auth 이메일 로그인으로 열립니다(config 의 PIN 없음).
   ========================================================================== */

window.DSM_CONFIG = {
  // 사이트 이름 (상단 제목에 사용)
  SITE_NAME: '두 손 모아',

  // Supabase 프로젝트 (fbrnrgus-sketch's Project)
  SUPABASE_URL: 'https://likxgtawtilzclfrbeeh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_4soOUZujPow2OiIXdPB7yw_7JPjKoOd',

  // 이 일수가 지난 글은 기본 목록에서 내리고 '지난 기도제목'으로 옮깁니다 (글은 남김)
  ARCHIVE_DAYS: 30,

  // 신고가 이 횟수 이상 쌓이면 자동으로 가립니다
  REPORT_HIDE_THRESHOLD: 3,

  // 분류 — 순서대로 목록 탭에 나옵니다. '전체'는 자동으로 맨 앞에 붙습니다.
  // 분류를 바꾸면 Supabase 함수 안의 검사 목록도 함께 바꿔야 합니다.
  CATEGORIES: [
    { id: 'health', label: '건강' },
    { id: 'family', label: '가정' },
    { id: 'work', label: '일터' },
    { id: 'thanks', label: '감사' },
    { id: 'other', label: '기타' }
  ]
};
