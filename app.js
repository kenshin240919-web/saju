/* ============================================
   사주 이루리라 - Main Application Logic
   계산·포인트·결제 확인은 서버(Supabase Edge Function)에서 처리하고,
   브라우저는 로그인 · 입력 · 결과 표시만 담당
   ============================================ */

// ===== 설정 · 상태 =====
const CFG = window.APP_CONFIG || {};
const CONFIGURED = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_URL.includes('YOUR-'));
const sb = CONFIGURED && window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

let session = null;
let profile = null;

const COST_FORTUNE = 100; // 오늘의 운세만 포인트(가입·추천 보상)로 이용
const PRICE = 1000; // 사주풀이 · 전생풀이 · 전생풀이 추가 8가지, 건당 결제 (실제 금액은 서버가 정함)
const PURCHASE_BONUS = 100; // 결제해서 풀이를 받으면 적립 (오늘의 운세 1회)
const PRODUCT_NAME = { saju: '사주풀이', jyotish: '전생풀이', jyotish_extra: '전생풀이 추가 8가지' };
const REFERRAL_REWARD = 100;
const REFERRAL_DAILY_LIMIT = 100;

// ===== 표시용 기본 표 (계산 엔진은 서버에만 있음) =====
const 천간 = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const 지지 = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
const 천간한자 = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const 지지한자 = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const 천간오행 = ['목', '목', '화', '화', '토', '토', '금', '금', '수', '수'];
const 지지오행 = ['수', '토', '목', '목', '토', '화', '화', '토', '금', '금', '토', '수'];
const 오행영문 = { '목': 'wood', '화': 'fire', '토': 'earth', '금': 'metal', '수': 'water' };
const 오행한자 = { '목': '木', '화': '火', '토': '土', '금': '金', '수': '水' };
const 띠동물 = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];

const 간한자 = (g) => 천간한자[천간.indexOf(g)];
const 지한자 = (j) => 지지한자[지지.indexOf(j)];
const 간오행 = (g) => 천간오행[천간.indexOf(g)];
const 지오행 = (j) => 지지오행[지지.indexOf(j)];
const 오행색 = (oh) => `var(--${오행영문[oh]})`;

// 한국 날짜 기준 (서버 운세 날짜·출생년도 목록과 맞추기 위함)
function kstParts() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day };
}
const kstDateString = () => {
  const t = kstParts();
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
};

// 서버 엔진의 getBirthYearsForZodiac와 같은 규칙 (서버가 이 목록으로 검증함)
function getBirthYearsForZodiac(zodiacIndex) {
  const currentYear = kstParts().year;
  const startYear = currentYear - (((currentYear - 4 - zodiacIndex) % 12) + 12) % 12;
  return Array.from({ length: 8 }, (_, i) => startYear - i * 12);
}

// 텍스트를 HTML에 넣을 때 사용
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtP = (n) => `${Number(n || 0).toLocaleString('ko-KR')}P`;
const fmtWon = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const myBalance = () => (profile?.is_admin ? '무제한' : fmtP(profile?.points));
const paidText = () => (profile?.is_admin ? '관리자 계정이라 결제 없이 보여드려요.' : `결제가 완료되어 풀이를 보여드려요. ${fmtP(PURCHASE_BONUS)} 적립!`);
// 차감 안내: 관리자는 차감되지 않음
const spentText = (cost) => (profile?.is_admin ? '관리자 계정이라 포인트가 차감되지 않아요.' : `${fmtP(cost)} 사용 · 남은 포인트 ${fmtP(profile?.points)}`);

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
  initFortuneSection();
  initCitySelect();
  showSection('home');

  if (!sb) {
    document.getElementById('config-banner').hidden = false;
    renderAuthState();
    return;
  }

  // 로그인 상태가 바뀔 때마다 프로필(포인트) 다시 불러오기
  // (콜백 안에서 바로 Supabase를 호출하면 멈출 수 있어 다음 틱으로 미룸)
  sb.auth.onAuthStateChange((_event, s) => {
    session = s;
    setTimeout(refreshProfile, 0);
  });
  recordReferralVisit();
});

async function refreshProfile() {
  profile = null;
  if (session) {
    const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    profile = data;
  }
  renderAuthState();
  if (profile) {
    loadHistory();
    loadJyotishHistory();
    resumePendingAction();
  }
}

// ===== 로그인 전에 누른 '결과 보기'를 기억했다가 로그인 후 이어서 실행 =====
// (로그인하러 카카오·네이버·구글에 다녀와도 같은 탭이면 sessionStorage가 유지됨)
function savePendingAction(action) {
  try { sessionStorage.setItem('pending_action', JSON.stringify(action)); } catch (_) { /* 저장 불가: 다시 누르면 됨 */ }
}

function resumePendingAction() {
  let action = null;
  try {
    action = JSON.parse(sessionStorage.getItem('pending_action') || 'null');
    sessionStorage.removeItem('pending_action');
  } catch (_) { /* 없음 */ }
  // 페이앱 결제를 마치면 ?paid=1 로 돌아옴. 결제 없이 뒤로 돌아온 경우엔 결제 대기 작업을 버림
  const q = new URLSearchParams(location.search);
  const returnedPaid = q.has('paid');
  if (returnedPaid) {
    q.delete('paid');
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
  }
  if (!action || (action.paymentId && !returnedPaid)) return;
  closeSheet();
  runAction(action);
}

function runAction(action) {
  if (action.type === 'saju') {
    showSection('saju');
    runSaju(action.body, action.paymentId);
  }
  if (action.type === 'jyotish') {
    showSection('jyotish');
    runJyotish(action.body, action.paymentId);
  }
  if (action.type === 'jyotish_extra') {
    openSavedJyotish(action.readingId).then(() => unlockJyotishExtra(action.paymentId));
  }
  if (action.type === 'fortune') {
    showSection('fortune');
    openFortuneSheet(action.zodiac).then(() => loadFortune(action.zodiac, action.birthYear));
  }
}

// ===== 건별 결제 (페이앱) =====
// 서버가 PAYMENT_REQUIRED를 돌려주면 휴대폰 번호를 받아 페이앱 결제창으로 보냄.
// 결제 후 ?paid=1 로 돌아오면 pending_action을 paymentId와 함께 다시 실행하고,
// 결제 완료 알림이 서버에 닿을 때까지 몇 번 더 확인함
let payTarget = null;
let payChecks = 0;

function payAndRun(product, action, paidAlready) {
  if (paidAlready) {
    if (++payChecks <= 10) {
      showToast('결제를 확인하고 있어요…');
      return setTimeout(() => runAction({ ...action, paymentId: paidAlready }), 2000);
    }
    payChecks = 0;
    return alert('결제 확인이 늦어지고 있어요. 결제를 마치셨다면 잠시 후 같은 버튼을 다시 눌러 주세요. 추가 결제 없이 진행돼요.');
  }
  payChecks = 0;
  payTarget = { product, action };
  openSheet(`
    <div class="sheet-head">
      <div>
        <h2 class="sheet-title" id="sheet-title">${PRODUCT_NAME[product]} 결제</h2>
        <p class="sheet-sub">${fmtWon(PRICE)} · 결제하면 오늘의 운세 1회(${fmtP(PURCHASE_BONUS)}) 적립</p>
      </div>
    </div>
    <form class="pay-form" onsubmit="return startPayment(event)">
      <label class="field-label" for="pay-phone">휴대폰 번호</label>
      <input type="tel" id="pay-phone" class="input" inputmode="numeric" autocomplete="tel" placeholder="01012345678" maxlength="13" required>
      <p class="field-help">결제사(페이앱)의 결제 확인에 쓰여요. 문자는 보내지 않고, 사이트에는 저장하지 않아요.</p>
      <button type="submit" class="btn-primary btn-submit" id="pay-submit">
        <span class="btn-text">${fmtWon(PRICE)} 결제하기</span>
        <span class="btn-loader" aria-hidden="true"><span></span><span></span><span></span></span>
      </button>
      <p class="pay-note">결제 후 바로 제공되는 디지털 콘텐츠로, 풀이를 연 뒤에는 청약철회가 제한돼요. <a href="refund.html">환불 정책</a></p>
    </form>
  `);
}

async function startPayment(e) {
  e.preventDefault();
  const phone = document.getElementById('pay-phone').value.replace(/\D/g, '');
  if (!/^01\d{8,9}$/.test(phone)) {
    alert('휴대폰 번호를 정확히 입력해 주세요. (예: 01012345678)');
    return false;
  }
  const btn = document.getElementById('pay-submit');
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    const { paymentId, payurl } = await callFn('payment', {
      product: payTarget.product,
      phone,
      returnUrl: `${location.origin}${location.pathname}?paid=1`,
    });
    savePendingAction({ ...payTarget.action, paymentId });
    location.href = payurl;
  } catch (err) {
    btn.classList.remove('loading');
    btn.disabled = false;
    handleCallError(err);
  }
  return false;
}

function renderAuthState() {
  const loggedIn = Boolean(session && profile);
  const btn = document.getElementById('account-btn');
  btn.textContent = loggedIn ? myBalance() : '로그인';
  btn.classList.toggle('has-points', loggedIn);
  btn.setAttribute('aria-label', loggedIn ? `내 계정, 보유 포인트 ${myBalance()}` : '로그인');
  if (!loggedIn) document.getElementById('history').hidden = document.getElementById('j-history').hidden = true;
}

function setBalance(balance) {
  if (profile && Number.isFinite(balance)) {
    profile.points = balance;
    renderAuthState();
  }
}

// ===== 서버 함수 호출 (오류 코드: UNAUTHORIZED, INSUFFICIENT_POINTS, BAD_REQUEST, SERVER_ERROR) =====
async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let code = 'SERVER_ERROR';
    try { code = (await error.context.json()).error || code; } catch (_) { /* 네트워크 오류 등 */ }
    const e = new Error(code);
    e.code = code;
    throw e;
  }
  return data;
}

function handleCallError(err, cost) {
  if (err.code === 'PAYMENT_REQUIRED') return alert('결제가 필요한 풀이예요.');
  if (err.code === 'PAYMENT_UNAVAILABLE') return alert('결제 기능을 준비하고 있어요. 조금만 기다려 주세요.');
  if (err.code === 'INSUFFICIENT_POINTS') return openPointsSheet(cost);
  if (err.code === 'UNAUTHORIZED') return openLoginSheet();
  alert('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

// ===== 광고: 화면에 보이는 슬롯만, 슬롯당 한 번씩 요청 =====
// 숨겨진 섹션에서 요청하면 너비 0 오류가 나므로 섹션이 보일 때 호출
function pushVisibleAds(root) {
  root.querySelectorAll('ins.adsbygoogle:not([data-pushed])').forEach(ins => {
    if (!ins.offsetWidth) return;
    ins.dataset.pushed = '1';
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.log('AdSense notice:', err);
    }
  });
}

// ===== Section Navigation =====
function showSection(sectionName) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const name = ['saju', 'fortune', 'jyotish'].includes(sectionName) ? sectionName : 'home';
  const target = document.getElementById(`${name}-section`);
  target.classList.add('active');

  document.querySelectorAll('.tab').forEach(tab => {
    const active = tab.dataset.section === name;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });

  window.scrollTo({ top: 0 });
  pushVisibleAds(target);
}

// ===== 로그인 =====
const LOGIN_LOGO = {
  kakao: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#000" d="M12 3C6.48 3 2 6.48 2 10.8c0 2.78 1.86 5.22 4.66 6.6l-.95 3.48c-.08.3.26.54.52.36l4.15-2.75c.53.07 1.07.11 1.62.11 5.52 0 10-3.48 10-7.8S17.52 3 12 3z"/></svg>',
  naver: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M16.27 12.84 7.46 0H0v24h7.73V11.16L16.54 24H24V0h-7.73z"/></svg>',
  google: '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
};

function loginButtonsHtml() {
  const btn = (p, label) => `<button type="button" class="login-btn login-${p}" onclick="signIn('${p}')">${LOGIN_LOGO[p]}<span>${label}</span></button>`;
  return (CFG.KAKAO_CLIENT_ID ? btn('kakao', '카카오로 시작하기') : '') +
    (CFG.NAVER_CLIENT_ID ? btn('naver', '네이버로 시작하기') : '') +
    btn('google', 'Google 계정으로 시작하기');
}

async function signIn(provider) {
  if (!sb) {
    alert('로그인 서버가 아직 연결되지 않았습니다. (config.js 설정 필요)');
    return;
  }
  if (provider === 'kakao' || provider === 'naver') {
    // 카카오·네이버는 login-callback.html → 서버 함수(social-login)로 직접 처리
    const state = crypto.randomUUID();
    const redirectUri = new URL('login-callback.html', location.href).href;
    sessionStorage.setItem('oauth_state', JSON.stringify({ provider, state, redirectUri }));
    location.href = provider === 'kakao'
      ? 'https://kauth.kakao.com/oauth/authorize?' + new URLSearchParams({
        response_type: 'code', client_id: CFG.KAKAO_CLIENT_ID, redirect_uri: redirectUri, state,
      })
      : 'https://nid.naver.com/oauth2.0/authorize?' + new URLSearchParams({
        response_type: 'code', client_id: CFG.NAVER_CLIENT_ID, redirect_uri: redirectUri, state,
      });
    return;
  }
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
  if (error) alert('로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

function openLoginSheet(reason) {
  openSheet(`
    <div class="sheet-head">
      <div>
        <h2 class="sheet-title" id="sheet-title">간편 가입하고 1,000P 받기</h2>
        <p class="sheet-sub">${reason || '사주풀이 · 오늘의 운세 · 전생풀이는 회원만 볼 수 있어요.'}</p>
      </div>
    </div>
    <div class="login-buttons sheet-section">${loginButtonsHtml()}</div>
    <p class="consent">계속하면 <a href="terms.html">이용약관</a>과 <a href="privacy.html">개인정보처리방침</a>에 동의하게 됩니다. 만 14세 미만은 가입할 수 없습니다.</p>
  `);
}

function onAccountButton() {
  if (session && profile) openAccountSheet();
  else openLoginSheet();
}

// ===== 내 계정 · 포인트 =====
const PROVIDER_LABEL = { kakao: '카카오', naver: '네이버', google: 'Google' };
const REASON_LABEL = { signup: '가입 축하', admin: '관리자', referral: '추천 링크 방문', saju: '사주풀이', fortune: '오늘의 운세', jyotish: '전생풀이', jyotish_extra: '전생풀이 추가' };

function shareBlockHtml() {
  return `
    <div class="share-box">
      <p class="share-title">친구에게 공유하고 포인트 받기</p>
      <p class="share-desc">내 추천 링크를 연 사람 1명당 ${fmtP(REFERRAL_REWARD)} · 하루 최대 ${REFERRAL_DAILY_LIMIT}명</p>
      <button type="button" class="btn-primary" onclick="shareReferral()">추천 링크 공유하기</button>
    </div>
  `;
}

async function openAccountSheet() {
  openSheet(`
    <div class="sheet-head">
      <div>
        <h2 class="sheet-title" id="sheet-title">${esc(profile.display_name || '회원')}님</h2>
        <p class="sheet-sub">${PROVIDER_LABEL[profile.provider] || ''} 계정으로 로그인</p>
      </div>
    </div>
    <div class="balance">
      <span class="balance-label">보유 포인트</span>
      <strong class="balance-value">${myBalance()}</strong>
      <span class="balance-note">포인트는 오늘의 운세(1회 ${fmtP(COST_FORTUNE)})에 쓰여요 · 사주풀이와 전생풀이는 건당 ${fmtWon(PRICE)}, 결제하면 ${fmtP(PURCHASE_BONUS)} 적립</span>
    </div>
    ${shareBlockHtml()}
    <button type="button" class="btn-outline" disabled>포인트 충전 (준비 중)</button>
    <h3 class="sheet-section-title">포인트 내역</h3>
    <ul class="ledger" id="ledger"><li class="ledger-empty">불러오는 중…</li></ul>
    <div class="account-actions">
      <button type="button" class="text-btn" onclick="signOut()">로그아웃</button>
      <button type="button" class="text-btn danger" onclick="deleteAccount()">회원 탈퇴</button>
    </div>
  `);

  const { data } = await sb.from('point_ledger').select('amount, reason, created_at')
    .order('created_at', { ascending: false }).limit(30);
  const ledger = document.getElementById('ledger');
  if (!ledger) return;
  ledger.innerHTML = (data || []).map(l => `
    <li>
      <span>${REASON_LABEL[l.reason] || esc(l.reason)}<small>${new Date(l.created_at).toLocaleDateString('ko-KR')}</small></span>
      <strong class="${l.amount > 0 ? 'plus' : 'minus'}">${l.amount > 0 ? '+' : ''}${l.amount.toLocaleString('ko-KR')}P</strong>
    </li>
  `).join('') || '<li class="ledger-empty">아직 내역이 없어요.</li>';
}

function openPointsSheet(cost) {
  openSheet(`
    <div class="sheet-head">
      <div>
        <h2 class="sheet-title" id="sheet-title">포인트가 부족해요</h2>
        <p class="sheet-sub">필요 ${fmtP(cost)} · 보유 ${fmtP(profile?.points)}</p>
      </div>
    </div>
    ${shareBlockHtml()}
    <button type="button" class="btn-outline" disabled>포인트 충전 (준비 중)</button>
  `);
}

async function shareReferral() {
  const url = `${location.origin}${location.pathname}?ref=${profile.referral_code}`;
  const text = '내 사주로 원하는 모든 것을 이루리라 — 사주 이루리라에서 사주를 봐요';
  if (navigator.share) {
    try {
      await navigator.share({ title: '사주 이루리라', text, url });
    } catch (_) { /* 사용자가 공유 창을 닫음 */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('추천 링크를 복사했어요. 친구에게 보내주세요!');
  } catch (_) {
    prompt('아래 링크를 복사해 친구에게 보내주세요.', url);
  }
}

async function signOut() {
  await sb.auth.signOut();
  closeSheet();
  showSajuForm();
  showToast('로그아웃했어요.');
}

async function deleteAccount() {
  if (!confirm('탈퇴하면 포인트와 풀이 기록이 모두 삭제되고 되돌릴 수 없습니다. 탈퇴할까요?')) return;
  try {
    await callFn('delete-account', {});
    await sb.auth.signOut();
    closeSheet();
    showToast('탈퇴가 완료되었습니다.');
  } catch (err) {
    handleCallError(err, 0);
  }
}

// ===== 추천 링크 방문 기록 (?ref=코드) =====
function recordReferralVisit() {
  const params = new URLSearchParams(location.search);
  const code = params.get('ref');
  if (!code) return;

  // 방문자 구분용 임의 ID (브라우저에 저장, 개인정보 아님)
  let visitorId = null;
  try {
    visitorId = localStorage.getItem('visitor_id');
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      localStorage.setItem('visitor_id', visitorId);
    }
  } catch (_) {
    visitorId = crypto.randomUUID();
  }
  sb.functions.invoke('referral-visit', { body: { code, visitorId } }).catch(() => {});

  // 주소창에서 ref 제거 (새로고침·재공유 시 중복 방지)
  params.delete('ref');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
}

// ===== Saju Form =====
// 생년월일 입력칸 + 양력/음력 선택 → 양력 날짜 (잘못되면 안내 후 null)
function readBirthDate(inputId, calendarName) {
  const calendarType = document.querySelector(`input[name="${calendarName}"]:checked`).value;
  const digits = document.getElementById(inputId).value.replace(/\D/g, '');
  let year = parseInt(digits.slice(0, 4), 10);
  let month = parseInt(digits.slice(4, 6), 10);
  let day = parseInt(digits.slice(6, 8), 10);
  if (digits.length !== 8) {
    alert('생년월일을 8자리 숫자로 입력해주세요. (예: 19900515)');
    return null;
  }

  // 음력 → 양력 변환 (한국천문연구원 기준 데이터)
  let lunarText = '';
  if (calendarType !== 'solar') {
    const cal = new KoreanLunarCalendar();
    if (!cal.setLunarDate(year, month, day, calendarType === 'leap')) {
      alert('존재하지 않는 음력 날짜입니다. 윤달 여부와 날짜를 확인해주세요.');
      return null;
    }
    lunarText = `음력 ${year}.${month}.${day}${calendarType === 'leap' ? '(윤)' : ''}`;
    ({ year, month, day } = cal.getSolarCalendar());
  } else {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > 2050 || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      alert('올바른 날짜를 입력해주세요. (1900~2050년)');
      return null;
    }
  }
  const solarText = `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')} 양력`;
  return { year, month, day, birthText: lunarText ? `${lunarText} (${solarText})` : solarText };
}

function handleSajuSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('name').value.trim();
  const date = readBirthDate('birthdate', 'calendar');
  if (!date) return false;
  const { year, month, day, birthText } = date;
  const timeMode = document.querySelector('input[name="timeMode"]:checked').value;
  const sijinSelect = document.getElementById('birth-sijin');
  const birthtime = timeMode === 'exact' ? document.getElementById('birthtime').value
    : timeMode === 'range' ? sijinSelect.value : '';
  const gender = document.querySelector('input[name="gender"]:checked')?.value;

  if (!name || !year || !month || !day || (timeMode !== 'unknown' && !birthtime) || !gender) {
    alert(timeMode !== 'unknown' && !birthtime ? '태어난 시간을 입력하거나 시간대를 선택해주세요.' : '모든 정보를 입력해주세요.');
    return false;
  }
  if (name.length > 20) {
    alert('이름은 20자까지 입력할 수 있어요.');
    return false;
  }

  const [hour, minute] = birthtime ? birthtime.split(':').map(Number) : [null, 0];
  const timeText = timeMode === 'exact' ? birthtime
    : timeMode === 'range' ? sijinSelect.selectedOptions[0].textContent.replace(' · ', ' ') : '시간 모름';

  const body = {
    name, year, month, day, hour, minute, gender,
    birthText,
    timeText,
  };
  if (!session) {
    savePendingAction({ type: 'saju', body });
    openLoginSheet('입력하신 사주 결과를 보려면 가입이 필요해요. 가입하면 바로 결과가 나와요.');
    return false;
  }
  runSaju(body);
  return false;
}

function runSaju(body, paymentId) {
  const submitBtn = document.querySelector('#saju-form .btn-submit');
  submitBtn.classList.add('loading');
  submitBtn.disabled = true;

  callFn('saju', { ...body, paymentId }).then(data => {
    setBalance(data.balance);
    showReading(data.reading);
    loadHistory();
    showToast(data.charged ? paidText() : '이미 본 사주라 무료로 다시 보여드려요.');
  }).catch(err => err.code === 'PAYMENT_REQUIRED'
    ? payAndRun('saju', { type: 'saju', body }, paymentId)
    : handleCallError(err))
    .finally(() => {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    });
}

function showSajuForm() {
  document.getElementById('saju-form-container').classList.remove('hidden');
  document.getElementById('saju-result').classList.add('hidden');
  window.scrollTo({ top: 0 });
}

// ===== 내 풀이 기록 (다시 보기 무료) =====
async function loadHistory() {
  const { data } = await sb.from('saju_readings').select('id, input, created_at')
    .order('created_at', { ascending: false }).limit(30);
  const box = document.getElementById('history');
  box.hidden = !data || data.length === 0;
  document.getElementById('history-list').innerHTML = (data || []).map(r => `
    <button type="button" class="history-item" onclick="openSavedReading(${r.id})">
      <span class="history-name">${esc(r.input.name)}</span>
      <span class="history-meta">${esc(r.input.birthText)} · ${esc(r.input.timeText)}</span>
    </button>
  `).join('');
}

async function openSavedReading(id) {
  const { data, error } = await sb.from('saju_readings').select('id, input, result, extra, created_at').eq('id', id).single();
  if (error) return alert('기록을 불러오지 못했습니다.');
  showReading(data);
}

// 서버 기록 형식: { input, result: { result, interpretation } }
function showReading(reading) {
  const { input } = reading;
  // 정확한 시각(HH:MM)으로 입력한 경우에만 진태양시를 함께 표시
  const timeText = /^\d{2}:\d{2}$/.test(input.timeText)
    ? `${input.timeText} (진태양시 ${reading.result.result.solarTime})`
    : input.timeText;
  renderSajuResult(reading.result.result, reading.result.interpretation, input.name, input.birthText, timeText, input.gender, input.year);
}

// ===== Render Saju Result =====
function renderSajuResult(result, interpretation, name, birthText, timeText, gender, birthYear) {
  showSection('saju');
  document.getElementById('saju-form-container').classList.add('hidden');
  const resultEl = document.getElementById('saju-result');
  resultEl.classList.remove('hidden');

  // 요약 카드 (이름은 textContent로 넣어 XSS 방지)
  document.getElementById('result-name').textContent = `${name}님의 사주`;
  document.getElementById('summary-seal').textContent = 간한자(result.ilgan);
  document.getElementById('summary-sub').textContent =
    `일간 · ${result.ilganYinyang}의 ${오행한자[result.ilganOhaeng]}(${result.ilganOhaeng})`;
  document.getElementById('summary-title').textContent = interpretation[0].title;

  const genderText = gender === 'male' ? '남성' : '여성';
  document.getElementById('result-birth').replaceChildren(...[birthText, timeText, genderText, `${result.ddi}띠`].map(t => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = t;
    return chip;
  }));

  renderSajuTable(result);
  renderOhaengChart(result);
  renderDaeun(result, birthYear);
  renderInterpretationAccordion(interpretation);

  window.scrollTo({ top: 0 });
  pushVisibleAds(resultEl);
}

function renderInterpretationAccordion(interpretationSections) {
  const container = document.getElementById('interpretation-accordion');

  let html = '';
  interpretationSections.forEach((sec, idx) => {
    const open = idx === 0;
    html += `
      <div class="acc-item${open ? ' open' : ''}">
        <button type="button" class="acc-head" aria-expanded="${open}" onclick="toggleAccordion(this)">
          <span class="acc-num">0${idx + 1}</span>
          <span class="acc-title">${sec.title}</span>
          <svg class="acc-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="acc-body">${sec.content}</div>
      </div>
    `;

    // [광고] 3번과 4번 풀이 사이 인피드
    if (idx === 2) {
      html += `
        <div class="ad-container">
          <ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-3087515825675332" data-ad-slot="6639512269" data-ad-format="auto" data-full-width-responsive="true"></ins>
        </div>
      `;
    }
  });

  container.innerHTML = html;
}

function toggleAccordion(header) {
  const item = header.closest('.acc-item');
  const open = item.classList.toggle('open');
  header.setAttribute('aria-expanded', open);
}

// 사주표: 시·일·월·연 순서, 행 = 라벨 / 천간 십성 / 천간 / 지지 / 지지 십성
function renderSajuTable(result) {
  const order = [3, 2, 1, 0];
  const labels = ['시주', '일주 · 나', '월주', '연주'];
  const cols = order.map(i => ({ p: result.pillars[i], s: result.sipsungList[i], me: i === 2 }));

  const row = (fn) => cols.map(fn).join('');
  document.getElementById('saju-table').innerHTML =
    row((c, i) => `<div class="pillar-label${c.me ? ' me' : ''}">${labels[i]}</div>`) +
    row(c => `<div class="pillar-sip">${!c.p ? '—' : c.me ? '일간' : c.s.gan}</div>`) +
    row(c => c.p
      ? `<div class="pc el-${오행영문[간오행(c.p.gan)]}${c.me ? ' me' : ''}" title="${c.p.gan} · ${간오행(c.p.gan)}">${간한자(c.p.gan)}</div>`
      : '<div class="pc" title="태어난 시간 모름">?</div>') +
    row(c => c.p
      ? `<div class="pc el-${오행영문[지오행(c.p.ji)]}" title="${c.p.ji} · ${지오행(c.p.ji)}">${지한자(c.p.ji)}</div>`
      : '<div class="pc" title="태어난 시간 모름">?</div>') +
    row(c => `<div class="pillar-sip">${c.p ? c.s.ji : '시간 모름'}</div>`);
}

// 대운: 나이는 한국식 세는 나이 기준
function renderDaeun(result, birthYear) {
  const { forward, startAge, list } = result.daeun;
  const age = kstParts().year - birthYear + 1;
  const current = list.filter(d => d.age <= age).pop();

  document.getElementById('daeun-desc').textContent =
    `대운수 ${startAge} · ${forward ? '순행' : '역행'} · 10년 단위 (세는 나이)`;
  const listEl = document.getElementById('daeun-list');
  listEl.innerHTML = list.map(d => `
      <div class="daeun-item${d === current ? ' current' : ''}">
        <span class="daeun-age">${d.age}세${d === current ? ' · 지금' : ''}</span>
        <span class="daeun-char" style="color: ${오행색(간오행(d.gan))}">${간한자(d.gan)}</span>
        <span class="daeun-char" style="color: ${오행색(지오행(d.ji))}">${지한자(d.ji)}</span>
      </div>
    `).join('');

  // 현재 대운이 보이도록 가로 스크롤 이동
  const cur = listEl.querySelector('.current');
  if (cur) listEl.scrollLeft = Math.max(0, cur.offsetLeft - listEl.offsetLeft - 70);
}

function renderOhaengChart(result) {
  const total = result.pillars.length * 2;
  const descParts = [];

  document.getElementById('ohaeng-chart').innerHTML = ['목', '화', '토', '금', '수'].map(oh => {
    const count = result.ohaengCount[oh];
    const hanja = 오행한자[oh];
    const 조사 = (oh === '목' || oh === '금') ? '이' : '가'; // 받침 유무
    if (count === 0) {
      descParts.push(`${hanja}(${oh})${조사} 없어 보완이 필요합니다`);
    } else if (count >= 3) {
      descParts.push(`${hanja}(${oh})${조사} 강해 ${oh === '목' ? '추진력' : oh === '화' ? '열정' : oh === '토' ? '안정감' : oh === '금' ? '결단력' : '지혜'}이 돋보입니다`);
    }
    return `
      <div class="ohaeng-row">
        <span class="ohaeng-name" style="color: ${오행색(oh)}">${hanja} ${oh}</span>
        <div class="ohaeng-track"><div class="ohaeng-fill" style="width: ${(count / total) * 100}%; background: ${오행색(oh)}"></div></div>
        <span class="ohaeng-count">${count}</span>
      </div>
    `;
  }).join('');

  document.getElementById('ohaeng-desc').textContent = descParts.length > 0
    ? descParts.join('. ') + '.'
    : '오행이 비교적 균형 잡혀 있어 조화로운 사주입니다.';
}

// ===== Fortune Section (오늘의 운세) =====
function initFortuneSection() {
  const t = kstParts();
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay()];
  document.getElementById('fortune-date').textContent = `${t.year}년 ${t.month}월 ${t.day}일 ${weekday}요일 · 내 띠를 눌러보세요`;
  document.getElementById('teaser-date').textContent = `${t.month}월 ${t.day}일 운세 예시 보기`;
  // 홈 카드에는 올해의 띠 한자
  document.getElementById('teaser-hanja').textContent = 지지한자[((t.year - 4) % 12 + 12) % 12];

  document.getElementById('zodiac-grid').innerHTML = 띠동물.map((animal, idx) => {
    const yearText = getBirthYearsForZodiac(idx).slice(0, 4).reverse().map(y => String(y).slice(2)).join('·');
    return `
      <button type="button" class="zodiac-card" onclick="openFortuneSheet(${idx})" id="zodiac-${idx}">
        <span class="hanja-circle" aria-hidden="true">${지지한자[idx]}</span>
        <span class="zodiac-name">${animal}띠</span>
        <span class="zodiac-years">${yearText}</span>
      </button>
    `;
  }).join('');
}

const ICON = {
  color: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/>',
  number: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  outfit: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>'
};

function luckyCard(icon, label, value) {
  return `
    <div class="lucky-card">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[icon]}</svg>
      <div><span class="lucky-label">${label}</span><span class="lucky-val">${esc(value)}</span></div>
    </div>
  `;
}

let fortuneViewedToday = new Set(); // '띠/출생년도' (오늘 이미 본 것 = 무료)

async function openFortuneSheet(zodiacIndex) {
  const t = kstParts();
  openSheet(`
    <div class="sheet-head">
      <span class="sheet-seal" aria-hidden="true">${지지한자[zodiacIndex]}</span>
      <div>
        <h2 class="sheet-title" id="sheet-title">${띠동물[zodiacIndex]}띠 오늘의 운세</h2>
        <p class="sheet-sub">${t.month}월 ${t.day}일 · 출생년도를 골라주세요</p>
      </div>
    </div>
    <div class="year-tabs" role="group" aria-label="출생년도 선택" id="year-tabs"></div>
    <div id="fortune-body">
      <p class="fortune-hint">출생년도를 누르면 ${fmtP(COST_FORTUNE)}가 사용돼요. 오늘 이미 본 운세는 다시 봐도 무료예요.</p>
    </div>
  `);

  fortuneViewedToday = new Set();
  if (session) {
    const { data } = await sb.from('fortune_views').select('zodiac, birth_year').eq('view_date', kstDateString());
    fortuneViewedToday = new Set((data || []).map(v => `${v.zodiac}/${v.birth_year}`));
  }
  renderYearTabs(zodiacIndex, null);
}

function renderYearTabs(zodiacIndex, activeYear) {
  const tabs = document.getElementById('year-tabs');
  if (!tabs) return;
  tabs.innerHTML = getBirthYearsForZodiac(zodiacIndex).map(yr => {
    const viewed = fortuneViewedToday.has(`${zodiacIndex}/${yr}`);
    return `<button type="button" class="year-tab${yr === activeYear ? ' active' : ''}${viewed ? ' viewed' : ''}" aria-pressed="${yr === activeYear}" onclick="loadFortune(${zodiacIndex}, ${yr})">${yr}년생${viewed ? '<small>무료</small>' : ''}</button>`;
  }).join('');
  tabs.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

async function loadFortune(zodiacIndex, birthYear) {
  if (!session) {
    savePendingAction({ type: 'fortune', zodiac: zodiacIndex, birthYear });
    openLoginSheet(`${띠동물[zodiacIndex]}띠 ${birthYear}년생 오늘의 운세를 보려면 가입이 필요해요. 가입하면 바로 보여드려요.`);
    return;
  }
  const body = document.getElementById('fortune-body');
  renderYearTabs(zodiacIndex, birthYear);
  body.innerHTML = '<p class="fortune-hint">운세를 불러오는 중…</p>';

  try {
    const data = await callFn('fortune', { zodiac: zodiacIndex, birthYear });
    setBalance(data.balance);
    fortuneViewedToday.add(`${zodiacIndex}/${birthYear}`);
    renderYearTabs(zodiacIndex, birthYear);
    if (data.charged) showToast(spentText(COST_FORTUNE));

    const f = data.fortune;
    const age = kstParts().year - birthYear + 1;
    document.querySelector('.sheet-sub').textContent = `${kstParts().month}월 ${kstParts().day}일 · ${birthYear}년생 (${age}세)`;
    body.innerHTML = `
      <div class="quote-card">
        <span class="luck luck-${esc(f.overallLuck)}">${esc(f.overallLuckText)}</span>
        <p class="quote-text">${esc(f.quote)}</p>
      </div>
      <div class="lucky-grid">
        ${luckyCard('color', '행운의 색', f.lucky.color)}
        ${luckyCard('number', '행운의 숫자', f.lucky.number)}
        ${luckyCard('food', '행운의 음식', f.lucky.food)}
        ${luckyCard('outfit', '행운의 옷', f.lucky.outfit)}
      </div>
    `;
  } catch (err) {
    body.innerHTML = '';
    handleCallError(err, COST_FORTUNE);
  }
}

// ===== 바텀시트 · 토스트 =====
function openSheet(html) {
  document.getElementById('sheet-body').innerHTML = html;
  const overlay = document.getElementById('sheet');
  if (!overlay.classList.contains('active')) {
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.querySelector('.sheet-close').focus();
  }
}

function closeSheet() {
  document.getElementById('sheet').classList.remove('active');
  document.body.style.overflow = '';
}

let toastTimer = null;
function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// 바깥(어두운 영역) 탭 또는 Esc로 닫기
document.addEventListener('click', (e) => {
  if (e.target.id === 'sheet') closeSheet();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

// 생년월일 8자리 입력 → 1990.05.15 형식으로 자동 표시
function formatBirthdate(input, nextId = 'birthtime') {
  const d = input.value.replace(/\D/g, '').slice(0, 8);
  input.value = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join('.');
  const next = document.getElementById(nextId);
  if (d.length === 8 && !next.hidden) next.focus();
}

// 태어난 시간 입력 방식: 정확한 시간 / 시간대 선택 / 모름
function setTimeMode(mode) {
  document.getElementById('birthtime').hidden = mode !== 'exact';
  document.getElementById('birth-sijin').hidden = mode !== 'range';
  document.getElementById('time-hint').hidden = mode !== 'unknown';
}

// ===== Jyotish(인도 점성술)의 전생풀이 =====
// 출생도시 [시·도, [[도시, 위도, 경도], ...]] — OpenStreetMap(Nominatim) 행정구역 좌표
const BIRTH_CITIES = [
  ["서울", [["서울", 37.567, 126.978]]],
  ["부산", [["부산", 35.18, 129.075]]],
  ["대구", [["대구", 35.871, 128.602]]],
  ["인천", [["인천", 37.456, 126.705]]],
  ["광주", [["광주", 35.159, 126.852]]],
  ["대전", [["대전", 36.35, 127.385]]],
  ["울산", [["울산", 35.539, 129.312]]],
  ["세종", [["세종", 36.48, 127.289]]],
  ["경기", [["수원", 37.263, 127.029], ["성남", 37.42, 127.126], ["의정부", 37.738, 127.034], ["안양", 37.394, 126.957], ["부천", 37.501, 126.766], ["광명", 37.479, 126.864], ["평택", 36.992, 127.113], ["동두천", 37.903, 127.061], ["안산", 37.322, 126.831], ["고양", 37.658, 126.832], ["과천", 37.429, 126.988], ["구리", 37.594, 127.13], ["남양주", 37.636, 127.217], ["오산", 37.15, 127.077], ["시흥", 37.38, 126.803], ["군포", 37.362, 126.935], ["의왕", 37.345, 126.969], ["하남", 37.539, 127.215], ["용인", 37.241, 127.179], ["파주", 37.76, 126.78], ["이천", 37.281, 127.443], ["안성", 37.008, 127.28], ["김포", 37.616, 126.716], ["화성", 37.199, 126.831], ["경기 광주", 37.429, 127.255], ["양주", 37.785, 127.046], ["포천", 37.895, 127.201], ["여주", 37.298, 127.637]]],
  ["강원", [["춘천", 37.881, 127.73], ["원주", 37.342, 127.92], ["강릉", 37.753, 128.876], ["동해", 37.525, 129.115], ["태백", 37.164, 128.986], ["속초", 38.207, 128.591], ["삼척", 37.45, 129.165]]],
  ["충북", [["청주", 36.642, 127.489], ["충주", 36.991, 127.926], ["제천", 37.133, 128.191]]],
  ["충남", [["천안", 36.815, 127.114], ["공주", 36.473, 127.091], ["보령", 36.334, 126.613], ["아산", 36.79, 127.003], ["서산", 36.784, 126.45], ["논산", 36.187, 127.099], ["계룡", 36.276, 127.247], ["당진", 36.89, 126.646]]],
  ["전북", [["전주", 35.824, 127.147], ["군산", 35.968, 126.737], ["익산", 35.948, 126.958], ["정읍", 35.57, 126.856], ["남원", 35.416, 127.39], ["김제", 35.804, 126.881]]],
  ["전남", [["목포", 34.813, 126.392], ["여수", 34.761, 127.662], ["순천", 34.95, 127.488], ["나주", 35.029, 126.718], ["광양", 34.941, 127.696]]],
  ["경북", [["포항", 36.019, 129.343], ["경주", 35.856, 129.225], ["김천", 36.14, 128.114], ["안동", 36.563, 128.726], ["구미", 36.12, 128.344], ["영주", 36.806, 128.624], ["영천", 35.988, 128.942], ["상주", 36.41, 128.159], ["문경", 36.586, 128.187], ["경산", 35.825, 128.741]]],
  ["경남", [["창원", 35.228, 128.682], ["진주", 35.18, 128.108], ["통영", 34.854, 128.433], ["사천", 35.003, 128.065], ["김해", 35.228, 128.89], ["밀양", 35.504, 128.747], ["거제", 34.88, 128.621], ["양산", 35.335, 129.037]]],
  ["제주", [["제주", 33.5, 126.531], ["서귀포", 33.253, 126.561]]],
];

function initCitySelect() {
  const select = document.getElementById('j-city');
  for (const [sido, list] of BIRTH_CITIES) {
    const group = document.createElement('optgroup');
    group.label = sido;
    for (const [name, lat, lon] of list) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name === sido ? name : `${name} (${sido})`;
      opt.dataset.lat = lat;
      opt.dataset.lon = lon;
      group.append(opt);
    }
    select.append(group);
  }
}

// 기본 풀이 3가지
const JYOTISH_BASE = [
  ['past_life_story', '전생 이야기'],
  ['past_life_to_present', '전생의 직업·성향·인연이 이번 생으로'],
  ['fated_meeting_story', '전생의 인연, 이번 생의 만남'],
];
// 추가 풀이 8가지
const JYOTISH_EXTRA = [
  ['personality', '이번 생의 성격'],
  ['relationships', '인간관계'],
  ['appearance', '외모'],
  ['money', '돈'],
  ['career', '직업'],
  ['love', '연애'],
  ['marriage', '결혼'],
  ['astrology_link', '점성술 해석과 전생의 연결'],
];

function handleJyotishSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('j-name').value.trim();
  const gender = document.querySelector('input[name="jGender"]:checked')?.value;
  const time = document.getElementById('j-birthtime').value;
  const cityOpt = document.getElementById('j-city').selectedOptions[0];
  if (!name || !gender || !time || !cityOpt?.value) {
    alert('이름, 성별, 생년월일, 태어난 시간, 출생도시를 모두 입력해주세요.');
    return false;
  }
  if (name.length > 20) {
    alert('이름은 20자까지 입력할 수 있어요.');
    return false;
  }
  const date = readBirthDate('j-birthdate', 'jCalendar');
  if (!date) return false;

  const [hour, minute] = time.split(':').map(Number);
  const body = {
    name, gender, hour, minute,
    year: date.year, month: date.month, day: date.day, birthText: date.birthText,
    city: cityOpt.value, lat: Number(cityOpt.dataset.lat), lon: Number(cityOpt.dataset.lon),
  };
  if (!session) {
    savePendingAction({ type: 'jyotish', body });
    openLoginSheet('전생풀이를 보려면 가입이 필요해요. 가입하면 바로 이어서 진행돼요.');
    return false;
  }
  runJyotish(body);
  return false;
}

function runJyotish(body, paymentId) {
  const btn = document.getElementById('jyotish-submit');
  const wait = document.getElementById('jyotish-wait');
  btn.classList.add('loading');
  btn.disabled = true;
  wait.hidden = false;
  const progress = startProgress(document.getElementById('jyotish-pct'), 25000);

  callFn('jyotish', { ...body, paymentId }).then(data => {
    progress.done();
    setBalance(data.balance);
    showJyotishReading(data.reading);
    loadJyotishHistory();
    showToast(data.charged ? paidText() : '이미 본 풀이라 무료로 다시 보여드려요.');
  }).catch(err => err.code === 'PAYMENT_REQUIRED'
    ? payAndRun('jyotish', { type: 'jyotish', body }, paymentId)
    : jyotishError(err))
    .finally(() => {
      progress.stop();
      btn.classList.remove('loading');
      btn.disabled = false;
      wait.hidden = true;
    });
}

// 진행률: 실제 진행을 알 수 없어 시간에 따라 5% 단위로 90%까지 채우고, 완료 시 100%
function startProgress(el, pace) {
  const started = Date.now();
  const tick = () => { el.textContent = Math.min(90, Math.floor(90 * (1 - Math.exp(-(Date.now() - started) / pace)) / 5) * 5) + '%'; };
  tick();
  const timer = setInterval(tick, 1000);
  return { done: () => { el.textContent = '100%'; }, stop: () => clearInterval(timer) };
}

function jyotishError(err) {
  if (String(err.code).startsWith('AI_')) {
    alert('전생풀이를 쓰는 중 문제가 생겼어요. 결제하신 건은 그대로 남아 있어서, 잠시 후 다시 시도하면 추가 결제 없이 이어서 써드려요.');
  } else {
    handleCallError(err);
  }
}

// 지금 보고 있는 전생풀이 (추가 풀이 열기용)
let currentJyotish = null;

function unlockJyotishExtra(paymentId) {
  const btn = document.getElementById('j-unlock');
  const wait = document.getElementById('j-unlock-wait');
  btn.classList.add('loading');
  btn.disabled = true;
  wait.hidden = false;
  const progress = startProgress(document.getElementById('j-unlock-pct'), 35000);

  const readingId = currentJyotish.id;
  callFn('jyotish', { part: 'extra', readingId, paymentId }).then(data => {
    progress.done();
    setBalance(data.balance);
    currentJyotish.extra = data.extra;
    const firstNew = renderJyotishSections(currentJyotish);
    firstNew?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(data.charged ? paidText() : '이미 연 풀이라 무료로 보여드려요.');
  }).catch(err => {
    if (err.code === 'PAYMENT_REQUIRED') payAndRun('jyotish_extra', { type: 'jyotish_extra', readingId }, paymentId);
    else jyotishError(err);
    btn.classList.remove('loading');
    btn.disabled = false;
    wait.hidden = true;
  }).finally(() => progress.stop());
}

// 첫 화면 소개 카드: 누르면 바로 아래에 결과 예시를 펼침 (운세·전생 예시는 각 메뉴의 것을 복제)
function toggleIntro(btn) {
  const box = document.getElementById(btn.getAttribute('aria-controls'));
  if (!box.firstElementChild && box.dataset.from) {
    box.append(document.querySelector(`#${box.dataset.from} .sample`).cloneNode(true));
  }
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', open);
  box.hidden = !open;
}

// 예시 카드의 버튼: 입력란(또는 띠 목록)으로 이동
function goToForm(id) {
  const el = document.getElementById(id);
  const section = el.closest('.section');
  if (!section.classList.contains('active')) showSection(section.id.replace('-section', ''));
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (el.tagName === 'INPUT') el.focus({ preventScroll: true });
}

function showJyotishForm() {
  document.getElementById('jyotish-form-container').classList.remove('hidden');
  document.getElementById('jyotish-result').classList.add('hidden');
  window.scrollTo({ top: 0 });
}

// 전생풀이 항목 하나 (아코디언)
function jyotishItem(num, title, text, open) {
  const item = document.createElement('div');
  item.className = 'acc-item' + (open ? ' open' : '');
  item.innerHTML = `
    <button type="button" class="acc-head" aria-expanded="${open}" onclick="toggleAccordion(this)">
      <span class="acc-num">${String(num).padStart(2, '0')}</span>
      <span class="acc-title"></span>
      <svg class="acc-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="acc-body"></div>`;
  item.querySelector('.acc-title').textContent = title;
  const body = item.querySelector('.acc-body');
  for (const para of String(text || '').split(/\n\s*\n/).map(t => t.trim()).filter(Boolean)) {
    // [[ ]]로 감싼 핵심 문장은 형광펜 강조 (글자는 텍스트 노드로만 넣음)
    const p = document.createElement('p');
    para.split(/\[\[([\s\S]+?)\]\]/).forEach((part, i) => {
      const text = part.replace(/\[\[|\]\]/g, '');
      if (!text) return;
      if (i % 2) {
        const mark = document.createElement('mark');
        mark.className = 'key-line';
        mark.textContent = text;
        p.append(mark);
      } else p.append(text);
    });
    body.append(p);
  }
  return item;
}

// 기본 3가지 + 추가 8가지(열었으면 내용, 아니면 잠긴 목록과 열기 버튼). 새로 열린 첫 항목을 돌려줌
function renderJyotishSections(record) {
  const all = { ...record.result.reading, ...(record.extra || {}) };
  const unlocked = JYOTISH_EXTRA.every(([key]) => all[key]);
  // 기본 3가지는 AI가 내용에 맞게 지은 제목을 씀 (예전 풀이에는 없으니 기본 제목)
  const items = JYOTISH_BASE.map(([key, title], i) => jyotishItem(i + 1, all[`${key}_title`] || title, all[key], i === 0));
  // 기본 3가지는 위, 추가 8가지(또는 잠긴 목록)는 출생 차트 아래
  document.getElementById('j-sections').replaceChildren(...items);
  const box = document.getElementById('j-extra');
  if (unlocked) {
    const extra = JYOTISH_EXTRA.map(([key, title], i) => jyotishItem(JYOTISH_BASE.length + i + 1, title, all[key], i === 0));
    box.replaceChildren(...extra);
    return extra[0];
  }
  const locked = document.createElement('div');
  locked.className = 'locked card';
  locked.innerHTML = `
    <p class="locked-title">이번 생 풀이 8가지가 더 있어요</p>
    <p class="locked-desc">전생 이야기와 이어지는 이번 생의 모습을 풀어드려요.</p>
    <ul class="locked-list">${JYOTISH_EXTRA.map(([, title], i) => `<li><span class="acc-num">${String(JYOTISH_BASE.length + i + 1).padStart(2, '0')}</span>${title}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></li>`).join('')}</ul>
    <button type="button" class="btn-primary btn-submit" id="j-unlock" onclick="unlockJyotishExtra()">
      <span class="btn-text">나머지 8가지 풀이 열기 · ${fmtWon(PRICE)}</span>
      <span class="btn-loader" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <p class="pay-note">결제하면 오늘의 운세 1회(100P)를 적립해 드려요.<br>결제 후 바로 제공되는 디지털 콘텐츠로, 풀이를 연 뒤에는 청약철회가 제한돼요. <a href="refund.html">환불 정책</a></p>
    <p class="trust" id="j-unlock-wait" hidden>AI가 이번 생 풀이를 쓰는 중이에요. 1분 정도 걸려요. 창을 닫지 말아주세요. <strong class="wait-pct" id="j-unlock-pct">0%</strong></p>`;
  box.replaceChildren(locked);
  return null;
}

// 서버 기록 형식: { id, input, result: { chart, reading }, extra }
function showJyotishReading(record) {
  const { input } = record;
  const { chart, reading } = record.result;
  showSection('jyotish');
  document.getElementById('jyotish-form-container').classList.add('hidden');
  const resultEl = document.getElementById('jyotish-result');
  resultEl.classList.remove('hidden');

  // AI가 쓴 글은 모두 textContent로 넣음 (HTML로 해석하지 않음)
  document.getElementById('j-result-name').textContent = `${input.name}님의 전생풀이`;
  document.getElementById('j-headline').textContent = reading.headline;
  const time = `${String(input.hour).padStart(2, '0')}:${String(input.minute).padStart(2, '0')}`;
  document.getElementById('j-result-meta').replaceChildren(...[input.birthText, time, input.city, input.gender === 'male' ? '남성' : '여성'].map(t => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = t;
    return chip;
  }));

  renderChartGuide(chart);
  document.getElementById('j-planets').innerHTML = chart.planets.map(p => `
    <tr>
      <th scope="row">${PLANET_KO[p.name]}</th>
      <td>${RASHI_KO[p.sign]} ${Math.floor(p.degree)}°${p.dignity ? ` <small>${esc(p.dignity)}</small>` : ''}</td>
      <td>${p.house}</td>
      <td>${NAKSHATRA_KO[p.nakshatra]}</td>
    </tr>`).join('');

  currentJyotish = record;
  renderJyotishSections(record);

  window.scrollTo({ top: 0 });
  pushVisibleAds(resultEl);
}

async function loadJyotishHistory() {
  const { data } = await sb.from('jyotish_readings').select('id, input, created_at')
    .order('created_at', { ascending: false }).limit(30);
  const box = document.getElementById('j-history');
  box.hidden = !data || data.length === 0;
  document.getElementById('j-history-list').innerHTML = (data || []).map(r => `
    <button type="button" class="history-item" onclick="openSavedJyotish(${r.id})">
      <span class="history-name">${esc(r.input.name)}</span>
      <span class="history-meta">${esc(r.input.birthText)} · ${esc(r.input.city)}</span>
    </button>
  `).join('');
}

async function openSavedJyotish(id) {
  const { data, error } = await sb.from('jyotish_readings').select('id, input, result, created_at').eq('id', id).single();
  if (error) return alert('기록을 불러오지 못했습니다.');
  showJyotishReading(data);
}

// 출생 차트를 처음 보는 사람도 읽을 수 있게: 핵심 4가지 · 12개의 인생 방 · 행성 뜻 (원래 표는 접어서 아래에)
function renderChartGuide(chart) {
  const moon = chart.planets.find(p => p.name === 'Moon');
  const dashaEnd = String(chart.currentDasha.end).slice(0, 4);
  document.getElementById('j-chart-key').innerHTML = [
    ['남에게 보이는 나', '라그나(상승궁)', RASHI_KO[chart.lagna.sign], SIGN_TRAIT[chart.lagna.sign]],
    ['나의 속마음', '달 별자리', RASHI_KO[moon.sign], SIGN_TRAIT[moon.sign]],
    ['타고난 마음의 별', '달의 나크샤트라', NAKSHATRA_KO[moon.nakshatra], '27개 별 무리 중 태어날 때 달이 있던 곳'],
    ['지금 인생을 이끄는 별', '대운(다샤)', PLANET_KO[chart.currentDasha.lord], `${PLANET_MEANING[chart.currentDasha.lord]}의 시기 · ${dashaEnd}년까지`],
  ].map(([title, term, value, desc]) => `
    <div class="chart-key-item">
      <span>${title} <small>${term}</small></span>
      <strong>${value}</strong>
      <em>${desc}</em>
    </div>`).join('');

  // 홀사인: 1번 방 = 라그나 별자리, 이후 별자리 순서대로
  document.getElementById('j-houses').innerHTML = HOUSE_MEANING.map((meaning, i) => {
    const house = i + 1;
    const inside = chart.planets.filter(p => p.house === house);
    const badge = house === 1 ? '<b class="house-badge">나의 시작</b>' : house === 12 ? '<b class="house-badge past">전생 단서</b>' : '';
    return `
      <div class="house${inside.length ? '' : ' empty'}${house === 12 ? ' past' : ''}">
        <div class="house-top"><span class="house-num">${house}</span>${badge}</div>
        <strong class="house-name">${meaning}</strong>
        <span class="house-sign">${RASHI_KO[(chart.lagna.sign + i) % 12]}</span>
        <div class="house-planets">${inside.map(p => `<span class="pchip${p.name === 'Ketu' ? ' past' : ''}">${PLANET_KO[p.name]}</span>`).join('')}</div>
      </div>`;
  }).join('');

  document.getElementById('j-guide').innerHTML = chart.planets.map(p => `
    <li>
      <span class="pchip${p.name === 'Ketu' ? ' past' : ''}">${PLANET_KO[p.name]}</span>
      <span><strong>${PLANET_MEANING[p.name]}</strong> · ${p.house}번 방(${HOUSE_MEANING[p.house - 1]})에 있어요
        <small>${RASHI_KO[p.sign]}${p.dignity ? ` · ${DIGNITY_KO[p.dignity] || esc(p.dignity)}` : ''}</small></span>
    </li>`).join('');
}

const HOUSE_MEANING = ['나 자신·외모', '재물·가족', '형제·소통', '집·어머니', '연애·자녀', '일·건강', '결혼·동업', '변화·비밀', '행운·스승', '직업·명예', '수입·친구', '전생·내면'];
const PLANET_MEANING = {
  Sun: '나의 의지·아버지', Moon: '마음·감정', Mars: '용기·추진력', Mercury: '지혜·말솜씨', Jupiter: '행운·지혜',
  Venus: '사랑·아름다움', Saturn: '책임·인내', Rahu: '이번 생의 욕망', Ketu: '전생에 익힌 재능',
};
const SIGN_TRAIT = ['앞장서는 개척자', '차분하고 꾸준한 사람', '재치 있고 호기심 많은 사람', '따뜻하게 보살피는 사람', '당당하게 빛나는 사람', '섬세하고 꼼꼼한 사람',
  '조화롭고 다정한 사람', '깊고 강렬한 사람', '자유롭고 낙천적인 사람', '성실하고 현실적인 사람', '독창적이고 남다른 사람', '감성적이고 직관적인 사람'];
const DIGNITY_KO = { 고양: '고양 – 가장 힘이 센 자리', 본궁: '본궁 – 자기 집이라 편안한 자리', 쇠약: '쇠약 – 힘이 약해지는 자리' };

// 차트 표시용 이름 (서버 jyotish.ts와 같은 순서)
const RASHI_KO = ['양자리', '황소자리', '쌍둥이자리', '게자리', '사자자리', '처녀자리', '천칭자리', '전갈자리', '궁수자리', '염소자리', '물병자리', '물고기자리'];
const NAKSHATRA_KO = ['아슈위니', '바라니', '크리티카', '로히니', '므리가시라', '아르드라', '푸나르바수', '푸쉬야', '아슐레샤',
  '마가', '푸르바 팔구니', '우타라 팔구니', '하스타', '치트라', '스와티', '비샤카', '아누라다', '지예슈타',
  '물라', '푸르바 아샤다', '우타라 아샤다', '슈라바나', '다니슈타', '샤타비샤', '푸르바 바드라파다', '우타라 바드라파다', '레바티'];
const PLANET_KO = { Sun: '태양', Moon: '달', Mars: '화성', Mercury: '수성', Jupiter: '목성', Venus: '금성', Saturn: '토성', Rahu: '라후', Ketu: '케투' };
