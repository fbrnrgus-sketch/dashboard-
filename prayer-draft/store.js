/* ==========================================================================
   store.js — 「두 손 모아」 데이터 계층 (Supabase 연동)
   --------------------------------------------------------------------------
   app.js 는 아래 공개 함수만 호출하고, 모든 함수는 Promise 를 돌려줍니다.
   예전 localStorage 초안과 같은 이름 · 같은 인자 · 같은 반환 모양을 유지합니다.

       listPosts(options)          글 목록  { category, archived }
       getPost(id)                 글 하나 (댓글 포함)
       addPost(data)               글 쓰기
       togglePray(postId)          '함께 기도했어요' 켜기/끄기  → { prayed, count }
       addComment(postId, data)    나눔(댓글) 달기
       markAnswered(postId, bool)  응답됨 표시
       reportPost(postId, reason)  신고
       setHidden(postId, bool)     관리자: 가리기 / 복구
       deletePost(postId)          삭제
       getReportedPosts()          관리자: 신고가 들어온 글
       getHiddenPosts()            관리자: 가려진 글
       getDeviceId()               이 기기 식별자
       resetAll()                  (서버 운영에서는 사용하지 않음)
   관리자 로그인(추가)
       adminSignIn(email, password) · adminSignOut() · isAdmin() · adminEmail()

   ▶ 보안 경계
     글·댓글·기도·신고는 모두 Supabase 함수(RPC)를 통해서만 오갑니다.
     표에는 익명 키로 직접 접근할 수 없고, 권한(글쓴이 본인·관리자)은
     서버 함수 안에서 확인합니다. 화면에서 버튼을 숨기는 것은 보조 수단입니다.
     service_role 같은 비밀 키는 이 파일에 절대 넣지 않습니다.

   ▶ 익명 처리
     '이름 공개'를 끄면 이름을 아예 저장하지 않습니다(author_name = null).
     본인 확인용 기기 식별자(device_id)만 서버에 남고 화면에는 나가지 않습니다.
   ========================================================================== */

(function () {
  'use strict';

  var CFG = window.DSM_CONFIG || {};
  var DEVICE_KEY = 'dsm_device_id';
  var AUTH_KEY = 'dsm_auth';
  var client = null;
  var deviceId = null;

  /* ---------- 작은 도구들 ---------- */

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function safeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }

  function safeSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  function hasHangul(s) {
    return /[가-힣]/.test(String(s || ''));
  }

  function friendlyMessage(err) {
    var msg = '';
    if (typeof err === 'string') msg = err;
    else if (err) msg = err.message || err.error_description || err.hint || '';
    if (!msg) return '서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    if (hasHangul(msg)) return msg;
    if (/permission denied|row-level security|jwt|apikey|invalid api key|not authorized/i.test(msg)) {
      return '권한이 없어 처리하지 못했습니다.';
    }
    if (/failed to fetch|network|timeout|load failed/i.test(msg)) {
      return '서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
    return '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }

  function notifyError(err) {
    var message = friendlyMessage(err);
    try {
      document.dispatchEvent(new CustomEvent('dsm:error', { detail: { message: message } }));
    } catch (e) {}
    return message;
  }

  /* ---------- 기기 식별자 ---------- */

  function getDeviceId() {
    if (deviceId) return deviceId;
    var id = safeGet(DEVICE_KEY);
    if (!id) {
      id = uid('dev');
      safeSet(DEVICE_KEY, id);
    }
    deviceId = id;
    return deviceId;
  }

  /* ---------- Supabase 클라이언트 ---------- */

  function db() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('서버 라이브러리를 불러오지 못했습니다.');
    }
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      throw new Error('서버 주소가 설정되지 않았습니다.');
    }
    client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: {
        storageKey: AUTH_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    return client;
  }

  function archiveDays() {
    var n = parseInt(CFG.ARCHIVE_DAYS, 10);
    return isNaN(n) ? 30 : n;
  }

  async function callRpc(name, args, fallback) {
    try {
      var res = await db().rpc(name, args);
      if (res.error) {
        notifyError(res.error);
        return fallback === undefined ? null : fallback;
      }
      var data = res.data;
      if (data === undefined || data === null) return fallback === undefined ? null : fallback;
      return data;
    } catch (e) {
      notifyError(e);
      return fallback === undefined ? null : fallback;
    }
  }

  /* ---------- 공개 API ---------- */

  async function listPosts(options) {
    var o = options || {};
    return await callRpc('list_posts', {
      p_device_id: getDeviceId(),
      p_category: o.category || 'all',
      p_archived: o.archived || 'exclude',
      p_archive_days: archiveDays(),
      p_include_hidden: !!o.includeHidden
    }, []);
  }

  async function getPost(id) {
    if (!id) return null;
    return await callRpc('get_post', {
      p_id: id,
      p_device_id: getDeviceId(),
      p_archive_days: archiveDays()
    }, null);
  }

  async function addPost(input) {
    var data = input || {};
    return await callRpc('add_post', {
      p_title: String(data.title || ''),
      p_body: String(data.body || ''),
      p_category: data.category || 'other',
      p_author_name: data.namePublic ? String(data.authorName || '') : '',
      p_name_public: !!data.namePublic,
      p_device_id: getDeviceId(),
      p_archive_days: archiveDays()
    }, null);
  }

  async function togglePray(postId) {
    if (!postId) return null;
    return await callRpc('toggle_pray', {
      p_post_id: postId,
      p_device_id: getDeviceId()
    }, null);
  }

  async function addComment(postId, input) {
    if (!postId) return null;
    var data = input || {};
    return await callRpc('add_comment', {
      p_post_id: postId,
      p_body: String(data.body || ''),
      p_author_name: data.namePublic ? String(data.authorName || '') : '',
      p_name_public: !!data.namePublic,
      p_device_id: getDeviceId(),
      p_archive_days: archiveDays()
    }, null);
  }

  async function markAnswered(postId, answered) {
    if (!postId) return null;
    return await callRpc('set_answered', {
      p_post_id: postId,
      p_answered: !!answered,
      p_device_id: getDeviceId(),
      p_archive_days: archiveDays()
    }, null);
  }

  async function reportPost(postId, reason) {
    if (!postId) return null;
    return await callRpc('report_post', {
      p_post_id: postId,
      p_reason: String(reason || '기타'),
      p_device_id: getDeviceId(),
      p_archive_days: archiveDays()
    }, null);
  }

  async function setHidden(postId, hidden) {
    if (!postId) return null;
    return await callRpc('set_hidden', {
      p_post_id: postId,
      p_hidden: !!hidden,
      p_device_id: getDeviceId(),
      p_archive_days: archiveDays()
    }, null);
  }

  async function deletePost(postId) {
    if (!postId) return false;
    var ok = await callRpc('delete_post', {
      p_post_id: postId,
      p_device_id: getDeviceId()
    }, false);
    return ok === true;
  }

  async function getReportedPosts() {
    return await callRpc('admin_reported_posts', {
      p_device_id: getDeviceId(),
      p_archive_days: archiveDays()
    }, []);
  }

  async function getHiddenPosts() {
    return await callRpc('admin_hidden_posts', {
      p_device_id: getDeviceId(),
      p_archive_days: archiveDays()
    }, []);
  }

  // 서버 운영에서는 사용하지 않습니다 (실수로 전체 글이 지워지지 않도록).
  async function resetAll() {
    return false;
  }

  /* ---------- 관리자 인증 (Supabase Auth · 이메일/비밀번호) ---------- */

  async function isAdmin() {
    try {
      var s = await db().auth.getSession();
      var session = s && s.data ? s.data.session : null;
      if (!session) return false;
      var res = await db().rpc('is_admin');
      if (res.error) return false;
      return res.data === true;
    } catch (e) {
      return false;
    }
  }

  async function adminEmail() {
    try {
      var s = await db().auth.getSession();
      var session = s && s.data ? s.data.session : null;
      return session && session.user ? (session.user.email || '') : '';
    } catch (e) {
      return '';
    }
  }

  async function adminSignIn(email, password) {
    var mail = String(email || '').trim();
    var pw = String(password || '');
    if (!mail || !pw) return { ok: false, error: '이메일과 비밀번호를 모두 적어 주세요.' };

    try {
      var res = await db().auth.signInWithPassword({ email: mail, password: pw });
      if (res.error) {
        var m = res.error.message || '';
        var msg = /invalid login credentials/i.test(m)
          ? '이메일 또는 비밀번호가 맞지 않습니다.'
          : /email not confirmed/i.test(m)
            ? '이메일 확인이 끝나지 않은 계정입니다.'
            : /rate limit|too many/i.test(m)
              ? '시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.'
              : '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
        return { ok: false, error: msg };
      }

      var okAdmin = await isAdmin();
      if (!okAdmin) {
        await db().auth.signOut();
        return { ok: false, error: '관리자 권한이 있는 계정이 아닙니다.' };
      }

      return { ok: true, email: (res.data && res.data.user && res.data.user.email) || mail };
    } catch (e) {
      return { ok: false, error: friendlyMessage(e) };
    }
  }

  async function adminSignOut() {
    try {
      await db().auth.signOut();
    } catch (e) {}
    return true;
  }

  /* ---------- 내보내기 ---------- */

  window.DSMStore = {
    listPosts: listPosts,
    getPost: getPost,
    addPost: addPost,
    togglePray: togglePray,
    addComment: addComment,
    markAnswered: markAnswered,
    reportPost: reportPost,
    setHidden: setHidden,
    deletePost: deletePost,
    getReportedPosts: getReportedPosts,
    getHiddenPosts: getHiddenPosts,
    getDeviceId: getDeviceId,
    resetAll: resetAll,
    isAdmin: isAdmin,
    adminEmail: adminEmail,
    adminSignIn: adminSignIn,
    adminSignOut: adminSignOut
  };
})();
