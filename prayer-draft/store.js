/* ==========================================================================
   store.js — 「두 손 모아」 데이터 계층 (초안: localStorage)
   --------------------------------------------------------------------------
   ▶ 서버로 바꿀 때 이 파일만 교체하면 됩니다.
     app.js 는 아래 공개 함수만 호출하고, 모든 함수는 Promise 를 돌려줍니다.
     Supabase 등으로 옮길 때도 같은 이름 · 같은 인자 · 같은 반환 모양을
     유지하면 app.js 는 손대지 않아도 됩니다.

       listPosts(options)          글 목록  { category, archived }
       getPost(id)                 글 하나 (댓글 포함)
       addPost(data)               글 쓰기
       togglePray(postId)          '함께 기도했어요' 켜기/끄기
       addComment(postId, data)    나눔(댓글) 달기
       markAnswered(postId, bool)  응답됨 표시
       reportPost(postId, reason)  신고
       setHidden(postId, bool)     관리자: 가리기 / 복구
       deletePost(postId)          삭제
       getReportedPosts()          관리자: 신고가 들어온 글
       getHiddenPosts()            관리자: 가려진 글
       getDeviceId()               이 기기 식별자 (글쓴이 본인 확인 · 중복 기도 방지)
       resetAll()                  초안 데이터를 샘플 상태로 되돌리기 (개발용)

   ▶ 초안의 경계
     이 파일은 브라우저 localStorage 에만 저장합니다. 그래서 지금은
     '한 기기 · 한 브라우저'에서만 글과 댓글이 보입니다. 서버에 연결하면
     성도들끼리 서로의 기도제목이 보이게 됩니다. 화면 위 얇은 안내 띠가
     그 사실을 알려 주고 있으며, 서버 연결 시 app.js 에서 띠만 지우면 됩니다.

   ▶ 익명 처리
     '이름 공개'를 끄면 이름을 아예 저장하지 않습니다(authorName = null).
     글쓴이 본인 확인용 기기 식별자(ownerId)만 따로 보관하며 화면에는
     나가지 않습니다.
   ========================================================================== */

(function () {
  'use strict';

  var CFG = window.DSM_CONFIG;
  var POSTS_KEY = 'dsm_posts_v1';
  var DEVICE_KEY = 'dsm_device_id';
  var DAY = 24 * 60 * 60 * 1000;

  /* ---------- 작은 도구들 ---------- */

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function agoISO(days, hours) {
    var t = Date.now() - (days || 0) * DAY - (hours || 0) * 60 * 60 * 1000;
    return new Date(t).toISOString();
  }

  function safeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }

  function safeSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  /* ---------- 기기 식별자 ---------- */

  function getDeviceId() {
    var id = safeGet(DEVICE_KEY);
    if (!id) {
      id = uid('dev');
      safeSet(DEVICE_KEY, id);
    }
    return id;
  }

  /* ---------- 저장소 읽기/쓰기 ---------- */

  function readPosts() {
    var raw = safeGet(POSTS_KEY);
    if (!raw) return null;
    try {
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : null;
    } catch (e) {
      return null;
    }
  }

  function writePosts(posts) {
    safeSet(POSTS_KEY, JSON.stringify(posts));
  }

  /* ---------- 첫 실행 샘플 (가상의 이름만 사용) ---------- */

  function makeComment(authorName, namePublic, body, createdISO) {
    return {
      id: uid('cmt'),
      authorName: namePublic ? authorName : null,
      namePublic: !!namePublic,
      body: body,
      ownerId: 'sample',
      createdAt: createdISO
    };
  }

  function makeSample() {
    var cats = (CFG.CATEGORIES || []).map(function (c) { return c.id; });
    function cat(i) { return cats[i] || 'other'; }

    return [
      {
        id: uid('post'),
        title: '아버지 수술이 잘 마치도록 기도 부탁드립니다',
        body: '다음 주 화요일에 아버지가 큰 수술을 받습니다.\n의료진의 손길이 정확하고, 회복이 순조롭도록 함께 기도해 주세요.',
        category: cat(0),
        authorName: '김○○',
        namePublic: true,
        ownerId: 'sample',
        createdAt: agoISO(0, 3),
        answered: false,
        answeredAt: null,
        hidden: false,
        hiddenByReport: false,
        reports: [],
        prayedBy: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'],
        comments: []
      },
      {
        id: uid('post'),
        title: '아이의 새 학기를 앞두고',
        body: '아이가 새 학교에 잘 적응할 수 있도록, 그리고 저희 부부가 조급해지지 않도록 기도 부탁드립니다.',
        category: cat(1),
        authorName: null,
        namePublic: false,
        ownerId: 'sample',
        createdAt: agoISO(1, 2),
        answered: false,
        answeredAt: null,
        hidden: false,
        hiddenByReport: false,
        reports: [],
        prayedBy: ['s1', 's2', 's3'],
        comments: []
      },
      {
        id: uid('post'),
        title: '직장에서 지혜를 구합니다',
        body: '여러 사람의 마음을 설득해야 하는 자리입니다. 말에 은혜가 있고, 판단이 흔들리지 않도록 기도해 주세요.',
        category: cat(2),
        authorName: '이○○',
        namePublic: true,
        ownerId: 'sample',
        createdAt: agoISO(3, 5),
        answered: false,
        answeredAt: null,
        hidden: false,
        hiddenByReport: false,
        reports: [],
        prayedBy: ['s1', 's2', 's3', 's4', 's5'],
        comments: [
          makeComment('최○○', true, '함께 기도하겠습니다. 지혜가 있기를.', agoISO(3, 1)),
          makeComment(null, false, '말씀하실 때 은혜가 있기를 기도합니다.', agoISO(2, 4))
        ]
      },
      {
        id: uid('post'),
        title: '기도의 응답을 나눕니다',
        body: '지난달 함께 기도해 주신 일이 잘 마무리되었습니다.\n기도해 주신 모든 분께 감사드립니다.',
        category: cat(3),
        authorName: '박○○',
        namePublic: true,
        ownerId: 'sample',
        createdAt: agoISO(5, 0),
        answered: true,
        answeredAt: agoISO(5, 0),
        hidden: false,
        hiddenByReport: false,
        reports: [],
        prayedBy: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12'],
        comments: []
      },
      {
        id: uid('post'),
        title: '회복 중인 가족을 위해',
        body: '오랜 병원 생활 끝에 집으로 돌아왔습니다. 하루하루 기운을 되찾아 가도록 기도해 주세요.',
        category: cat(0),
        authorName: null,
        namePublic: false,
        ownerId: 'sample',
        createdAt: agoISO(38, 0),
        answered: false,
        answeredAt: null,
        hidden: false,
        hiddenByReport: false,
        reports: [],
        prayedBy: ['s1', 's2'],
        comments: []
      }
    ];
  }

  function ensurePosts() {
    var posts = readPosts();
    if (!posts) {
      posts = makeSample();
      writePosts(posts);
    }
    return posts;
  }

  /* ---------- 화면으로 나갈 모양 만들기 ---------- */

  function decorate(p, me) {
    var c = clone(p);
    c.comments = (p.comments || []).slice().sort(function (a, b) {
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    c.prayCount = (p.prayedBy || []).length;
    c.prayed = (p.prayedBy || []).indexOf(me) >= 0;
    c.commentCount = c.comments.length;
    c.reportCount = (p.reports || []).length;
    c.reportReasons = (p.reports || []).map(function (r) { return r.reason; });
    c.isMine = p.ownerId === me;
    c.archived = isArchived(p);
    // 기기 식별자 목록은 화면에 내보내지 않는다.
    delete c.prayedBy;
    delete c.reports;
    delete c.ownerId;
    return c;
  }

  function isArchived(p) {
    var limit = (CFG.ARCHIVE_DAYS || 30) * DAY;
    return (Date.now() - new Date(p.createdAt).getTime()) > limit;
  }

  function findPost(posts, id) {
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].id === id) return posts[i];
    }
    return null;
  }

  /* ---------- 공개 API ---------- */

  async function listPosts(options) {
    var o = options || {};
    var posts = ensurePosts();
    var me = getDeviceId();
    var out = posts.filter(function (p) {
      if (!o.includeHidden && p.hidden) return false;
      var archived = isArchived(p);
      if (o.archived === 'only' && !archived) return false;
      if (o.archived !== 'only' && o.archived !== 'include' && archived) return false;
      if (o.category && o.category !== 'all' && p.category !== o.category) return false;
      return true;
    });
    out.sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return out.map(function (p) { return decorate(p, me); });
  }

  async function getPost(id) {
    var posts = ensurePosts();
    var p = findPost(posts, id);
    if (!p) return null;
    return decorate(p, getDeviceId());
  }

  async function addPost(input) {
    var data = input || {};
    var posts = ensurePosts();
    var namePublic = !!data.namePublic;
    var name = String(data.authorName || '').trim().slice(0, 20);

    var post = {
      id: uid('post'),
      title: String(data.title || '').trim().slice(0, 60),
      body: String(data.body || '').trim().slice(0, 1000),
      category: validCategory(data.category),
      // 익명이면 이름을 저장하지 않는다.
      authorName: namePublic && name ? name : null,
      namePublic: namePublic && !!name,
      ownerId: getDeviceId(),
      createdAt: nowISO(),
      answered: false,
      answeredAt: null,
      hidden: false,
      hiddenByReport: false,
      reports: [],
      prayedBy: [],
      comments: []
    };

    posts.push(post);
    writePosts(posts);
    return decorate(post, getDeviceId());
  }

  async function togglePray(postId) {
    var posts = ensurePosts();
    var p = findPost(posts, postId);
    if (!p) return null;
    var me = getDeviceId();
    p.prayedBy = p.prayedBy || [];
    var i = p.prayedBy.indexOf(me);
    var prayed;
    if (i >= 0) {
      p.prayedBy.splice(i, 1);
      prayed = false;
    } else {
      p.prayedBy.push(me);
      prayed = true;
    }
    writePosts(posts);
    return { prayed: prayed, count: p.prayedBy.length };
  }

  async function addComment(postId, input) {
    var posts = ensurePosts();
    var p = findPost(posts, postId);
    if (!p) return null;
    var data = input || {};
    var namePublic = !!data.namePublic;
    var name = String(data.authorName || '').trim().slice(0, 20);
    var comment = {
      id: uid('cmt'),
      authorName: namePublic && name ? name : null,
      namePublic: namePublic && !!name,
      body: String(data.body || '').trim().slice(0, 500),
      ownerId: getDeviceId(),
      createdAt: nowISO()
    };
    p.comments = p.comments || [];
    p.comments.push(comment);
    writePosts(posts);
    return decorate(p, getDeviceId());
  }

  async function markAnswered(postId, answered) {
    var posts = ensurePosts();
    var p = findPost(posts, postId);
    if (!p) return null;
    p.answered = !!answered;
    p.answeredAt = p.answered ? nowISO() : null;
    writePosts(posts);
    return decorate(p, getDeviceId());
  }

  async function reportPost(postId, reason) {
    var posts = ensurePosts();
    var p = findPost(posts, postId);
    if (!p) return null;
    var me = getDeviceId();
    p.reports = p.reports || [];

    // 같은 기기에서는 한 번만 신고로 집계한다.
    var already = p.reports.some(function (r) { return r.by === me; });
    if (!already) {
      p.reports.push({ by: me, reason: String(reason || '기타').slice(0, 40), at: nowISO() });
    }

    var threshold = CFG.REPORT_HIDE_THRESHOLD || 3;
    if (p.reports.length >= threshold && !p.hidden) {
      p.hidden = true;
      p.hiddenByReport = true;
      p.hiddenAt = nowISO();
    }

    writePosts(posts);
    var out = decorate(p, me);
    out.alreadyReported = already;
    return out;
  }

  async function setHidden(postId, hidden) {
    var posts = ensurePosts();
    var p = findPost(posts, postId);
    if (!p) return null;
    p.hidden = !!hidden;
    if (!hidden) {
      p.hiddenByReport = false;
      p.hiddenAt = null;
    } else {
      p.hiddenAt = nowISO();
    }
    writePosts(posts);
    return decorate(p, getDeviceId());
  }

  async function deletePost(postId) {
    var posts = ensurePosts();
    var idx = -1;
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].id === postId) { idx = i; break; }
    }
    if (idx < 0) return false;
    posts.splice(idx, 1);
    writePosts(posts);
    return true;
  }

  async function getReportedPosts() {
    var posts = ensurePosts();
    var me = getDeviceId();
    return posts
      .filter(function (p) { return (p.reports || []).length > 0; })
      .sort(function (a, b) { return (b.reports || []).length - (a.reports || []).length; })
      .map(function (p) { return decorate(p, me); });
  }

  async function getHiddenPosts() {
    var posts = ensurePosts();
    var me = getDeviceId();
    return posts
      .filter(function (p) { return p.hidden; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
      .map(function (p) { return decorate(p, me); });
  }

  async function resetAll() {
    writePosts(makeSample());
    return true;
  }

  /* ---------- 분류 검증 ---------- */

  function validCategory(id) {
    var list = CFG.CATEGORIES || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return id;
    }
    return 'other';
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
    resetAll: resetAll
  };
})();
