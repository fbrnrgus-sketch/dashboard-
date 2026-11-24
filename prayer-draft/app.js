/* ==========================================================================
   app.js — 「두 손 모아」 화면과 흐름
   --------------------------------------------------------------------------
   데이터는 store.js 만 통해 읽고 씁니다. 이 파일은 저장 방식을 모릅니다.
   (서버로 바꿀 때는 store.js 만 교체하면 됩니다.)
   ========================================================================== */

(function () {
  'use strict';

  var CFG = window.DSM_CONFIG;
  var S = window.DSMStore;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    category: 'all',
    showArchive: false,
    isAdmin: false,
    post: null,
    routing: false
  };

  var SS = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  };

  var deleteTimers = {};
  var toastTimer = null;

  /* ---------- 작은 도구들 ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function nl2br(s) {
    return esc(s).replace(/\r\n|\r|\n/g, '<br>');
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function fmtDate(iso, withTime) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var s = '';
    if (d.getFullYear() !== now.getFullYear()) s += d.getFullYear() + '. ';
    s += (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    if (withTime) {
      var h = d.getHours();
      var ap = h < 12 ? '오전' : '오후';
      var hh = h % 12 === 0 ? 12 : h % 12;
      s += ' ' + ap + ' ' + hh + ':' + pad2(d.getMinutes());
    }
    return s;
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2400);
  }

  function catLabel(id) {
    var list = CFG.CATEGORIES || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i].label;
    }
    return '기타';
  }

  function authorOf(item) {
    return item && item.namePublic && item.authorName ? item.authorName : '익명';
  }

  /* ---------- 화면 전환 ---------- */

  function setView(name) {
    var views = {
      list: $('listView'),
      detail: $('detailView'),
      compose: $('composeView'),
      admin: $('adminView')
    };
    Object.keys(views).forEach(function (k) {
      views[k].hidden = (k !== name);
    });
    $('siteHeader').hidden = (name !== 'list');
    $('tabs').hidden = (name !== 'list');
    $('fab').hidden = (name !== 'list');
    window.scrollTo(0, 0);
  }

  function updateAdminLink() {
    $('adminLink').textContent = state.isAdmin ? '관리자 모드' : '관리자';
  }

  /* ---------- 목록 ---------- */

  function renderTabs() {
    var html = '<button type="button" class="tab' + (state.category === 'all' ? ' is-active' : '') +
      '" data-cat="all" aria-pressed="' + (state.category === 'all') + '">전체</button>';
    (CFG.CATEGORIES || []).forEach(function (c) {
      var on = state.category === c.id;
      html += '<button type="button" class="tab' + (on ? ' is-active' : '') +
        '" data-cat="' + esc(c.id) + '" aria-pressed="' + on + '">' + esc(c.label) + '</button>';
    });
    $('tabsInner').innerHTML = html;
    var active = $('tabsInner').querySelector('.is-active');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }

  function cardHTML(p) {
    return '<article class="card' + (p.answered ? ' is-answered' : '') + '">' +
      '<a class="card-main" href="#/post/' + encodeURIComponent(p.id) + '">' +
        '<div class="card-top">' +
          '<span class="chip">' + esc(catLabel(p.category)) + '</span>' +
          (p.answered ? '<span class="badge">응답됨</span>' : '') +
        '</div>' +
        '<h3 class="card-title">' + esc(p.title) + '</h3>' +
        '<p class="card-body">' + esc(p.body) + '</p>' +
      '</a>' +
      '<div class="card-foot">' +
        '<span class="who">' + esc(authorOf(p)) + '</span>' +
        '<span class="sep" aria-hidden="true">·</span>' +
        '<time datetime="' + esc(p.createdAt) + '">' + fmtDate(p.createdAt) + '</time>' +
        (p.commentCount ? '<span class="sep" aria-hidden="true">·</span><span class="comment-count">나눔 ' + p.commentCount + '</span>' : '') +
        '<button type="button" class="pray-mini' + (p.prayed ? ' is-on' : '') + '"' +
          ' data-action="pray" data-id="' + esc(p.id) + '"' +
          ' aria-pressed="' + (p.prayed ? 'true' : 'false') + '"' +
          ' aria-label="함께 기도했어요">' +
          '<span class="heart" aria-hidden="true">' + (p.prayed ? '♥' : '♡') + '</span>' +
          ' <span class="pray-count">' + p.prayCount + '</span>' +
        '</button>' +
      '</div>' +
    '</article>';
  }

  async function showList() {
    setView('list');
    renderTabs();

    var posts = await S.listPosts({
      category: state.category,
      archived: state.showArchive ? 'only' : 'exclude'
    });

    var listEl = $('postList');
    var emptyEl = $('listEmpty');

    if (!posts.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      if (state.showArchive) {
        emptyEl.textContent = '아직 지난 기도제목이 없습니다.';
      } else if (state.category !== 'all') {
        emptyEl.textContent = '이 분류에는 아직 기도제목이 없습니다.';
      } else {
        emptyEl.textContent = '아직 올라온 기도제목이 없습니다. 첫 기도제목을 남겨 주세요.';
      }
    } else {
      emptyEl.hidden = true;
      listEl.innerHTML = posts.map(cardHTML).join('');
    }

    $('archiveToggle').textContent = state.showArchive ? '최근 기도제목으로' : '지난 기도제목 보기';
    updateAdminLink();
  }

  /* ---------- 글 하나 ---------- */

  function commentsHTML(p) {
    var items = (p.comments || []).map(function (c) {
      return '<li class="comment">' +
        '<p class="comment-meta"><span class="who">' + esc(authorOf(c)) + '</span>' +
        '<time datetime="' + esc(c.createdAt) + '">' + fmtDate(c.createdAt, true) + '</time></p>' +
        '<p class="comment-body">' + nl2br(c.body) + '</p>' +
      '</li>';
    }).join('');

    return '<section class="sheet comments">' +
      '<h3 class="comments-title">나눔 <span class="count">' + (p.commentCount || 0) + '</span></h3>' +
      (p.comments && p.comments.length
        ? '<ul class="comment-list">' + items + '</ul>'
        : '<p class="comments-empty">아직 나눈 글이 없습니다. 함께 기도한 마음을 짧게 남겨 주세요.</p>') +
      '<form class="comment-form" id="commentForm" novalidate>' +
        '<textarea id="cBody" rows="3" maxlength="500" placeholder="기도하며 나누고 싶은 한마디"></textarea>' +
        '<div class="comment-form-foot">' +
          '<label class="inline-check"><input type="checkbox" id="cNamePublic"> 이름 공개</label>' +
          '<input type="text" id="cName" maxlength="20" autocomplete="off" placeholder="이름 (예: 김○○)" hidden>' +
          '<button type="submit" class="primary-btn small">남기기</button>' +
        '</div>' +
      '</form>' +
    '</section>';
  }

  function detailHTML(p) {
    var canManage = p.isMine || state.isAdmin;
    var modBtn = '';
    if (state.isAdmin) {
      modBtn = p.hidden
        ? '<button type="button" class="ghost-btn" data-action="unhide-post" data-id="' + esc(p.id) + '">다시 보이게</button>'
        : '<button type="button" class="ghost-btn" data-action="hide-post" data-id="' + esc(p.id) + '">가리기</button>';
    }

    return '<a class="back-link" href="#/">← 목록으로</a>' +
      '<article class="sheet detail">' +
        '<div class="card-top">' +
          '<span class="chip">' + esc(catLabel(p.category)) + '</span>' +
          (p.answered ? '<span class="badge">응답됨</span>' : '') +
          (p.hidden ? '<span class="badge badge-muted">가려짐</span>' : '') +
        '</div>' +
        '<h2 class="detail-title">' + esc(p.title) + '</h2>' +
        '<p class="detail-meta">' +
          '<span class="who">' + esc(authorOf(p)) + '</span>' +
          '<span class="sep" aria-hidden="true">·</span>' +
          '<time datetime="' + esc(p.createdAt) + '">' + fmtDate(p.createdAt, true) + '</time>' +
        '</p>' +
        '<div class="detail-body">' + nl2br(p.body) + '</div>' +
        '<div class="detail-actions">' +
          '<button type="button" class="pray-btn' + (p.prayed ? ' is-on' : '') + '"' +
            ' data-action="pray" data-id="' + esc(p.id) + '"' +
            ' aria-pressed="' + (p.prayed ? 'true' : 'false') + '">' +
            '<span class="heart" aria-hidden="true">' + (p.prayed ? '♥' : '♡') + '</span>' +
            ' 함께 기도했어요 <span class="pray-count">' + p.prayCount + '</span>' +
          '</button>' +
          (canManage
            ? '<button type="button" class="ghost-btn" data-action="toggle-answered" data-id="' + esc(p.id) + '">' +
                (p.answered ? '응답 표시 해제' : '응답됨으로 표시') + '</button>'
            : '') +
          (canManage
            ? '<button type="button" class="ghost-btn danger" data-action="delete-post" data-id="' + esc(p.id) + '">삭제</button>'
            : '<button type="button" class="ghost-btn" data-action="report-open" data-id="' + esc(p.id) + '">신고</button>') +
          modBtn +
        '</div>' +
        '<div class="report-panel" id="reportPanel" hidden>' +
          '<p class="report-title">이 글을 신고하는 이유를 골라 주세요.</p>' +
          '<div class="report-reasons">' +
            '<button type="button" class="ghost-btn small" data-action="report-submit" data-id="' + esc(p.id) + '" data-reason="부적절한 내용">부적절한 내용</button>' +
            '<button type="button" class="ghost-btn small" data-action="report-submit" data-id="' + esc(p.id) + '" data-reason="광고·홍보">광고·홍보</button>' +
            '<button type="button" class="ghost-btn small" data-action="report-submit" data-id="' + esc(p.id) + '" data-reason="기타">기타</button>' +
          '</div>' +
          '<p class="report-note">신고가 ' + (CFG.REPORT_HIDE_THRESHOLD || 3) + '회 쌓이면 목록에서 자동으로 가려집니다.</p>' +
        '</div>' +
      '</article>' +
      commentsHTML(p);
  }

  async function refreshDetail(id) {
    var p = await S.getPost(id);
    if (!p) return;
    state.post = p;
    $('detailBody').innerHTML = detailHTML(p);
  }

  async function showPost(id) {
    var p = await S.getPost(id);
    if (!p) {
      toast('기도제목을 찾을 수 없습니다.');
      location.replace('#/');
      return;
    }
    // 가려진 글은 글쓴이 본인과 관리자만 볼 수 있습니다.
    if (p.hidden && !p.isMine && !state.isAdmin) {
      toast('가려진 기도제목입니다.');
      location.replace('#/');
      return;
    }
    state.post = p;
    setView('detail');
    $('detailBody').innerHTML = detailHTML(p);
  }

  /* ---------- 글쓰기 ---------- */

  function renderCatPicker() {
    var html = '';
    (CFG.CATEGORIES || []).forEach(function (c, i) {
      html += '<label class="cat-opt">' +
        '<input type="radio" name="category" value="' + esc(c.id) + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span>' + esc(c.label) + '</span></label>';
    });
    $('catPicker').innerHTML = html;
  }

  function resetComposeForm() {
    $('composeForm').reset();
    $('nameWrap').hidden = true;
    $('crisisNote').hidden = true;
    $('formError').textContent = '';
    $('micStatus').textContent = '';
    if ($('catPicker').children.length === 0) renderCatPicker();
    var checked = $('catPicker').querySelector('input:checked');
    if (!checked) {
      var first = $('catPicker').querySelector('input');
      if (first) first.checked = true;
    }
  }

  function showCompose() {
    resetComposeForm();
    setView('compose');
    updateAdminLink();
  }

  var CRISIS_WORDS = [
    '죽고싶', '죽고싶다', '자살', '자해', '사라지고싶', '살기싫', '살고싶지',
    '극단적선택', '해치고싶', '죽어버리고싶'
  ];

  function checkCrisis() {
    var text = ($('fTitle').value + ' ' + $('fBody').value).replace(/\s+/g, '');
    var hit = CRISIS_WORDS.some(function (w) { return text.indexOf(w) >= 0; });
    $('crisisNote').hidden = !hit;
  }

  async function submitCompose() {
    var title = $('fTitle').value.trim();
    var body = $('fBody').value.trim();
    var namePublic = $('fNamePublic').checked;
    var name = $('fName').value.trim();
    var errEl = $('formError');
    errEl.textContent = '';

    if (!title) {
      errEl.textContent = '기도 제목을 적어 주세요.';
      $('fTitle').focus();
      return;
    }
    if (!body) {
      errEl.textContent = '함께 기도해 주셨으면 하는 마음을 적어 주세요.';
      $('fBody').focus();
      return;
    }
    if (namePublic && !name) {
      errEl.textContent = '이름을 적어 주시거나, 이름 공개를 끄고 익명으로 올려 주세요.';
      $('fName').focus();
      return;
    }

    var catEl = $('catPicker').querySelector('input:checked');

    var post = await S.addPost({
      title: title,
      body: body,
      category: catEl ? catEl.value : 'other',
      namePublic: namePublic,
      authorName: name
    });

    if (!post) return;
    resetComposeForm();
    toast('기도제목을 올렸습니다. 함께 기도합니다.');
    location.hash = '#/post/' + encodeURIComponent(post.id);
  }

  /* ---------- 댓글 ---------- */

  async function submitComment() {
    var p = state.post;
    if (!p) return;
    var bodyEl = $('cBody');
    var text = bodyEl.value.trim();
    if (!text) {
      toast('나눌 내용을 적어 주세요.');
      bodyEl.focus();
      return;
    }
    var namePublic = $('cNamePublic').checked;
    var name = $('cName').value.trim();
    if (namePublic && !name) {
      toast('이름을 적어 주시거나, 이름 공개를 끄고 익명으로 남겨 주세요.');
      $('cName').focus();
      return;
    }

    var updated = await S.addComment(p.id, { body: text, namePublic: namePublic, authorName: name });
    if (!updated) return;
    toast('남겼습니다. 함께 기도합니다.');
    state.post = updated;
    $('detailBody').innerHTML = detailHTML(updated);
  }

  /* ---------- 함께 기도 ---------- */

  async function handlePray(id) {
    var r = await S.togglePray(id);
    if (!r) return;

    var btns = document.querySelectorAll('[data-action="pray"][data-id="' + id + '"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var countEl = b.querySelector('.pray-count');
      var heartEl = b.querySelector('.heart');
      if (countEl) countEl.textContent = r.count;
      if (heartEl) heartEl.textContent = r.prayed ? '♥' : '♡';
      b.classList.toggle('is-on', r.prayed);
      b.setAttribute('aria-pressed', r.prayed ? 'true' : 'false');
    }

    if (state.post && state.post.id === id) {
      state.post.prayed = r.prayed;
      state.post.prayCount = r.count;
    }

    if (r.prayed) toast('함께 기도했습니다.');
  }

  /* ---------- 삭제 (두 번 눌러 확인) ---------- */

  function armDelete(btn, id) {
    if (btn.dataset.armed === '1') return false;
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = '정말 삭제할까요?';
    btn.classList.add('is-armed');
    clearTimeout(deleteTimers[id]);
    deleteTimers[id] = setTimeout(function () {
      if (!btn.isConnected) return;
      btn.dataset.armed = '';
      btn.textContent = btn.dataset.label || '삭제';
      btn.classList.remove('is-armed');
    }, 4000);
    return true;
  }

  async function handleDelete(btn, id) {
    if (armDelete(btn, id)) return;
    clearTimeout(deleteTimers[id]);
    await S.deletePost(id);
    toast('삭제했습니다.');

    if (!$('adminView').hidden) {
      await renderAdminPanel();
    } else if (!$('detailView').hidden) {
      if (location.hash && location.hash !== '#/') location.hash = '#/';
      else await showList();
    } else {
      await showList();
    }
  }

  /* ---------- 관리자 ---------- */

  function adminRow(p) {
    var reasons = {};
    (p.reportReasons || []).forEach(function (r) { reasons[r] = (reasons[r] || 0) + 1; });
    var reasonText = Object.keys(reasons).map(function (r) { return r + ' ' + reasons[r]; }).join(', ');

    return '<li class="admin-item">' +
      '<div class="admin-item-main">' +
        '<a class="admin-item-title" href="#/post/' + encodeURIComponent(p.id) + '">' + esc(p.title) + '</a>' +
        '<p class="admin-item-meta">' +
          esc(catLabel(p.category)) + ' · ' + esc(authorOf(p)) + ' · ' + fmtDate(p.createdAt) +
          (p.reportCount ? ' · 신고 ' + p.reportCount + '회' + (reasonText ? ' (' + esc(reasonText) + ')' : '') : '') +
          (p.hidden ? ' · 가려짐' : '') +
        '</p>' +
      '</div>' +
      '<div class="admin-item-actions">' +
        (p.hidden
          ? '<button type="button" class="ghost-btn small" data-action="unhide-post" data-id="' + esc(p.id) + '">복구</button>'
          : '<button type="button" class="ghost-btn small" data-action="hide-post" data-id="' + esc(p.id) + '">가리기</button>') +
        '<button type="button" class="ghost-btn small danger" data-action="delete-post" data-id="' + esc(p.id) + '">삭제</button>' +
      '</div>' +
    '</li>';
  }

  function adminSection(title, posts, emptyText) {
    return '<section class="sheet admin-section">' +
      '<h3 class="admin-section-title">' + esc(title) + ' <span class="count">' + posts.length + '</span></h3>' +
      (posts.length ? '<ul class="admin-list">' + posts.map(adminRow).join('') + '</ul>'
                    : '<p class="admin-empty">' + esc(emptyText) + '</p>') +
    '</section>';
  }

  async function renderAdminPanel() {
    var reported = await S.getReportedPosts();
    var hidden = await S.getHiddenPosts();

    var html = '<div class="sheet admin-head">' +
      '<h2 class="sheet-title">관리자</h2>' +
      '<p class="admin-note">신고가 ' + (CFG.REPORT_HIDE_THRESHOLD || 3) + '회 쌓이면 자동으로 가려집니다. 여기서 바로 가리기 · 복구 · 삭제를 할 수 있습니다.</p>' +
      '<button type="button" class="ghost-btn small" data-action="admin-exit">관리자 모드 끝내기</button>' +
    '</div>';

    html += adminSection('신고된 기도제목', reported, '신고된 글이 없습니다.');
    html += adminSection('가려진 기도제목', hidden, '가려진 글이 없습니다.');

    $('adminPanel').innerHTML = html;
  }

  async function showAdmin() {
    setView('admin');
    var ok = await S.isAdmin();
    state.isAdmin = ok;
    $('adminGate').hidden = ok;
    $('adminPanel').hidden = !ok;

    if (ok) {
      await renderAdminPanel();
    } else {
      var mail = SS.get('dsm_admin_email') || '';
      $('adminEmail').value = mail;
      $('adminPassword').value = '';
      $('adminError').textContent = '';
      (mail ? $('adminPassword') : $('adminEmail')).focus();
    }
    updateAdminLink();
  }

  async function submitAdmin() {
    var email = $('adminEmail').value.trim();
    var pw = $('adminPassword').value;
    var errEl = $('adminError');
    errEl.textContent = '';

    if (!email || !pw) {
      errEl.textContent = '이메일과 비밀번호를 모두 적어 주세요.';
      return;
    }

    var btn = $('adminSubmit');
    if (btn) { btn.disabled = true; btn.textContent = '들어가는 중…'; }

    var r = await S.adminSignIn(email, pw);

    if (btn) { btn.disabled = false; btn.textContent = '들어가기'; }

    if (!r || !r.ok) {
      errEl.textContent = (r && r.error) || '들어가지 못했습니다. 잠시 후 다시 시도해 주세요.';
      $('adminPassword').value = '';
      $('adminPassword').focus();
      return;
    }

    SS.set('dsm_admin_email', email);
    state.isAdmin = true;
    toast('관리자 모드로 들어왔습니다.');
    await showAdmin();
  }

  async function afterModerationChange(id) {
    if (!$('adminView').hidden) {
      await renderAdminPanel();
    } else if (!$('detailView').hidden && state.post && state.post.id === id) {
      await refreshDetail(id);
    }
  }

  /* ---------- 음성 입력 ---------- */

  var recog = null;
  var listening = false;

  function setMicIdle() {
    var btn = $('micBtn');
    listening = false;
    btn.classList.remove('is-live');
    btn.setAttribute('aria-pressed', 'false');
    $('micLabel').textContent = '음성으로 말하기';
  }

  function appendTranscript(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    var ta = $('fBody');
    var base = ta.value;
    var joined = base && !/[\s\n]$/.test(base) ? base + ' ' + text : base + text;
    var max = ta.getAttribute('maxlength');
    if (max) joined = joined.slice(0, parseInt(max, 10));
    ta.value = joined;
    checkCrisis();
  }

  function micError(code) {
    var msg = '음성 입력이 중간에 멈췄어요. 다시 눌러 말씀해 주세요.';
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      msg = '마이크 사용이 허용되지 않았어요. 주소창의 자물쇠(권한)에서 마이크를 허용해 주세요.';
    } else if (code === 'no-speech') {
      msg = '목소리가 들리지 않았어요. 다시 눌러 말씀해 주세요.';
    } else if (code === 'audio-capture') {
      msg = '마이크를 찾지 못했어요. 기기의 마이크를 확인해 주세요.';
    } else if (code === 'network') {
      msg = '음성 인식 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
    } else if (code === 'aborted') {
      msg = '';
    }
    $('micStatus').textContent = msg;
  }

  function initMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var btn = $('micBtn');
    var status = $('micStatus');

    if (!SR) {
      btn.hidden = true;
      status.textContent = '이 브라우저에서는 음성 입력을 지원하지 않아요. 글자로 입력해 주세요.';
      return;
    }

    if (!(window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      btn.hidden = true;
      status.textContent = '음성 입력은 https 주소에서만 동작합니다. 글자로 입력해 주세요.';
      return;
    }

    btn.addEventListener('click', function () {
      if (listening && recog) {
        try { recog.stop(); } catch (e) {}
        return;
      }

      try {
        recog = new SR();
      } catch (e) {
        status.textContent = '이 브라우저에서는 음성 입력을 시작하지 못했어요. 글자로 입력해 주세요.';
        return;
      }

      recog.lang = 'ko-KR';
      recog.continuous = false;
      recog.interimResults = false;
      recog.maxAlternatives = 1;

      recog.onstart = function () {
        listening = true;
        btn.classList.add('is-live');
        btn.setAttribute('aria-pressed', 'true');
        $('micLabel').textContent = '듣고 있어요… (눌러서 멈추기)';
        status.textContent = '말씀하세요.';
      };

      recog.onresult = function (ev) {
        var text = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          text += ev.results[i][0].transcript;
        }
        appendTranscript(text);
        status.textContent = '';
      };

      recog.onerror = function (ev) {
        micError(ev.error);
      };

      recog.onend = function () {
        setMicIdle();
      };

      try {
        recog.start();
      } catch (e) {
        setMicIdle();
        status.textContent = '음성 입력을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.';
      }
    });
  }

  /* ---------- 길 찾기 ---------- */

  function route() {
    var h = (location.hash || '').replace(/^#\/?/, '');

    if (h.indexOf('post/') === 0) {
      showPost(decodeURIComponent(h.slice(5)));
    } else if (h === 'write') {
      showCompose();
    } else if (h === 'admin') {
      showAdmin();
    } else {
      showList();
    }
  }

  /* ---------- 이벤트 ---------- */

  function onAction(action, el) {
    var id = el.getAttribute('data-id');

    switch (action) {
      case 'pray':
        handlePray(id);
        break;

      case 'toggle-answered':
        if (state.post && state.post.id === id) {
          var next = !state.post.answered;
          S.markAnswered(id, next).then(function () {
            toast(next ? '응답됨으로 표시했습니다.' : '응답 표시를 해제했습니다.');
            refreshDetail(id);
          });
        }
        break;

      case 'delete-post':
        handleDelete(el, id);
        break;

      case 'hide-post':
        S.setHidden(id, true).then(function () {
          toast('가렸습니다. 목록에서 보이지 않습니다.');
          afterModerationChange(id);
        });
        break;

      case 'unhide-post':
        S.setHidden(id, false).then(function () {
          toast('다시 보이게 했습니다.');
          afterModerationChange(id);
        });
        break;

      case 'report-open':
        var panel = $('reportPanel');
        if (panel) {
          panel.hidden = false;
          el.hidden = true;
        }
        break;

      case 'report-submit':
        S.reportPost(id, el.getAttribute('data-reason')).then(function (r) {
          if (!r) return;
          if (r.alreadyReported) {
            toast('이미 신고한 글입니다.');
          } else if (r.hidden) {
            toast('신고가 접수되어 이 글은 가려졌습니다.');
          } else {
            toast('신고를 접수했습니다. 관리자가 확인합니다.');
          }
          refreshDetail(id);
        });
        break;

      case 'admin-exit':
        S.adminSignOut().then(function () {
          state.isAdmin = false;
          toast('관리자 모드를 끝냈습니다.');
          location.hash = '#/';
        });
        break;
    }
  }

  function bindEvents() {
    document.addEventListener('dsm:error', function (e) {
      if (e.detail && e.detail.message) toast(e.detail.message);
    });

    document.addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        e.preventDefault();
        onAction(actionEl.getAttribute('data-action'), actionEl);
        return;
      }

      var tabEl = e.target.closest('[data-cat]');
      if (tabEl) {
        state.category = tabEl.getAttribute('data-cat');
        state.showArchive = false;
        showList();
        return;
      }

      if (e.target.closest('#archiveToggle')) {
        state.showArchive = !state.showArchive;
        showList();
        return;
      }

      if (e.target.closest('#adminLink')) {
        location.hash = '#/admin';
        return;
      }

      if (e.target.closest('#fab')) {
        location.hash = '#/write';
        return;
      }
    });

    document.addEventListener('submit', function (e) {
      if (e.target.id === 'composeForm') {
        e.preventDefault();
        submitCompose();
      } else if (e.target.id === 'commentForm') {
        e.preventDefault();
        submitComment();
      } else if (e.target.id === 'adminForm') {
        e.preventDefault();
        submitAdmin();
      }
    });

    document.addEventListener('change', function (e) {
      if (e.target.id === 'fNamePublic') {
        var on = e.target.checked;
        $('nameWrap').hidden = !on;
        if (on) $('fName').focus();
      } else if (e.target.id === 'cNamePublic') {
        var el = $('cName');
        if (!el) return;
        el.hidden = !e.target.checked;
        if (e.target.checked) el.focus();
      }
    });

    document.addEventListener('input', function (e) {
      if (e.target.id === 'fTitle' || e.target.id === 'fBody') checkCrisis();
    });

    window.addEventListener('hashchange', route);
  }

  function boot() {
    bindEvents();
    initMic();
    renderCatPicker();
    route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
