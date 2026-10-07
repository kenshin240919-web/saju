/* ============================================
   사주 이루리라 - 관리자 페이지
   권한 확인은 DB 함수(admin_*)가 직접 함: profiles.is_admin = true인 계정만 결과를 받음
   ============================================ */

const CFG = window.APP_CONFIG || {};
const sb = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('YOUR-')
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }) : '—';
const PROVIDER_LABEL = { kakao: '카카오', naver: '네이버', google: 'Google' };
const REASON_LABEL = { signup: '가입 축하', admin: '관리자', purchase_bonus: '결제 적립', referral: '추천 링크 방문', saju: '사주풀이', fortune: '오늘의 운세', jyotish: '전생풀이', jyotish_extra: '전생풀이 추가' };

let users = [];

function message(text) {
  const el = document.getElementById('admin-message');
  el.hidden = !text;
  el.innerHTML = text || '';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!sb) return message('로그인 서버가 아직 연결되지 않았습니다. (config.js 설정 필요)');

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return message('로그인이 필요합니다. <a href="./">사이트에서 로그인</a>한 뒤 이 페이지를 다시 열어주세요.');

  const { data: stats, error } = await sb.rpc('admin_stats');
  if (error) return message('관리자 권한이 없는 계정입니다.');

  message('');
  document.getElementById('admin-content').hidden = false;
  document.getElementById('admin-stats').innerHTML = [
    ['전체 회원', stats.users], ['오늘 가입', stats.users_today], ['오늘 사주풀이', stats.saju_today],
    ['오늘 운세 열람', stats.fortune_today], ['오늘 전생풀이', stats.jyotish_today ?? 0], ['오늘 전생 추가', stats.jyotish_extra_today ?? 0], ['오늘 추천 방문', stats.referral_today], ['오늘 결제 건수', stats.paid_today ?? 0], ['오늘 결제 금액(원)', stats.revenue_today ?? 0],
  ].map(([label, n]) => `<div class="stat"><span>${label}</span><strong>${Number(n).toLocaleString('ko-KR')}</strong></div>`).join('');
  loadUsers();
});

async function loadUsers() {
  const q = document.getElementById('admin-q').value.trim();
  const { data, error } = await sb.rpc('admin_list_users', { q: q || null });
  if (error) return message('회원 목록을 불러오지 못했습니다.');
  users = data;
  document.getElementById('admin-count').textContent =
    `${data.length.toLocaleString('ko-KR')}명${data.length === 500 ? ' (최근 가입 500명까지 표시)' : ''}`;
  document.getElementById('admin-users').innerHTML = data.map((u, i) => `
    <tr>
      <td><button type="button" class="admin-user-btn" onclick="openUser(${i})">${esc(u.display_name || '(이름 없음)')}<small>${esc(u.email)}</small></button></td>
      <td>${PROVIDER_LABEL[u.provider] || esc(u.provider)}</td>
      <td class="num">${u.points.toLocaleString('ko-KR')}</td>
      <td class="num">${u.saju_count}</td>
      <td class="num">${u.fortune_count}</td>
      <td class="num">${u.jyotish_count ?? 0}</td>
      <td class="num">${u.referral_count}</td>
      <td>${fmtDate(u.created_at)}</td>
      <td>${fmtDate(u.last_activity)}</td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="admin-empty">검색 결과가 없습니다.</td></tr>';
}

async function openUser(i) {
  const u = users[i];
  openSheet(`
    <div class="sheet-head">
      <div>
        <h2 class="sheet-title" id="sheet-title">${esc(u.display_name || '(이름 없음)')}</h2>
        <p class="sheet-sub">${PROVIDER_LABEL[u.provider] || esc(u.provider)} · ${esc(u.email)} · 가입 ${fmtDate(u.created_at)}</p>
      </div>
    </div>
    <div class="balance">
      <span class="balance-label">보유 당근</span>
      <strong class="balance-value" id="detail-points">${u.points.toLocaleString('ko-KR')}개</strong>
      <span class="balance-note">사주 ${u.saju_count}회 · 운세 ${u.fortune_count}회 · 전생 ${u.jyotish_count ?? 0}회 · 추천 방문 ${u.referral_count}회</span>
    </div>
    <h3 class="sheet-section-title">당근 지급 · 회수</h3>
    <form class="admin-search" onsubmit="event.preventDefault(); grantPoints(${i});">
      <div class="admin-search-row">
        <input type="number" class="input" id="grant-amount" inputmode="numeric" step="100" placeholder="예: 5000 (회수는 -1000)" aria-label="당근" required>
        <button type="submit" class="btn-primary admin-search-btn">적용</button>
      </div>
      <input type="text" class="input" id="grant-memo" maxlength="40" placeholder="메모 (선택, 예: 이벤트 당첨)" aria-label="메모">
    </form>
    <h3 class="sheet-section-title">당근 내역 (최근 100건)</h3>
    <ul class="ledger" id="detail-ledger"><li class="ledger-empty">불러오는 중…</li></ul>
    <h3 class="sheet-section-title">사주풀이 기록</h3>
    <ul class="ledger" id="detail-readings"><li class="ledger-empty">불러오는 중…</li></ul>
  `);

  loadUserDetail(u);
}

async function grantPoints(i) {
  const u = users[i];
  const amount = Number(document.getElementById('grant-amount').value);
  if (!Number.isInteger(amount) || amount === 0) return alert('0이 아닌 정수를 입력하세요.');
  if (!confirm(`${u.display_name || u.email}님에게 ${amount > 0 ? '+' : ''}${amount.toLocaleString('ko-KR')}P를 ${amount > 0 ? '지급' : '회수'}할까요?`)) return;
  const { data, error } = await sb.rpc('admin_grant_points', {
    uid: u.id, amount, note: document.getElementById('grant-memo').value,
  });
  if (error) return alert(error.message.includes('INSUFFICIENT') ? '보유 당근보다 많이 회수할 수 없습니다.' : '처리하지 못했습니다: ' + error.message);
  u.points = data;
  document.getElementById('detail-points').textContent = data.toLocaleString('ko-KR') + '개';
  document.getElementById('grant-amount').value = document.getElementById('grant-memo').value = '';
  loadUsers();
  loadUserDetail(u);
}

async function loadUserDetail(u) {
  const { data, error } = await sb.rpc('admin_user_detail', { uid: u.id });
  if (error) return;
  document.getElementById('detail-ledger').innerHTML = data.ledger.map(l => `
    <li>
      <span>${REASON_LABEL[l.reason] || esc(l.reason)}<small>${fmtDateTime(l.created_at)}${l.memo ? ' · ' + esc(l.memo) : ''}</small></span>
      <strong class="${l.amount > 0 ? 'plus' : 'minus'}">${l.amount > 0 ? '+' : ''}${l.amount.toLocaleString('ko-KR')}</strong>
    </li>
  `).join('') || '<li class="ledger-empty">내역이 없습니다.</li>';
  document.getElementById('detail-readings').innerHTML = data.readings.map(r => `
    <li><span>${esc(r.name)}<small>${esc(r.birth)}</small></span><small>${fmtDateTime(r.created_at)}</small></li>
  `).join('') || '<li class="ledger-empty">기록이 없습니다.</li>';
}

function openSheet(html) {
  document.getElementById('sheet-body').innerHTML = html;
  document.getElementById('sheet').classList.add('active');
  document.body.style.overflow = 'hidden';
  document.querySelector('.sheet-close').focus();
}

function closeSheet() {
  document.getElementById('sheet').classList.remove('active');
  document.body.style.overflow = '';
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'sheet') closeSheet();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});
