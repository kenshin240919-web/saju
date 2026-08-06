/* ============================================
   천명(天命) - Main Application Logic
   ============================================ */

// ===== Global State =====
let currentSection = 'hero';

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
  initStars();
  initFortuneSection();
  showSection('hero');
});

// ===== Star Background =====
function initStars() {
  const container = document.getElementById('stars');
  if (!container) return;
  const count = 80;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.setProperty('--duration', (2 + Math.random() * 4) + 's');
    star.style.setProperty('--opacity', (0.3 + Math.random() * 0.7));
    star.style.animationDelay = Math.random() * 5 + 's';
    star.style.width = (1 + Math.random() * 2) + 'px';
    star.style.height = star.style.width;
    container.appendChild(star);
  }
}

// ===== Section Navigation =====
function showSection(sectionName) {
  currentSection = sectionName;

  // Hide all sections
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

  // Show target section
  const targetId = sectionName === 'hero' ? 'hero-section' :
                   sectionName === 'saju' ? 'saju-section' :
                   'fortune-section';
  const target = document.getElementById(targetId);
  if (target) {
    target.classList.add('active');
  }

  // Update nav
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
    if (link.dataset.section === sectionName) {
      link.classList.add('active');
    }
  });

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Saju Form =====
function handleSajuSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('name').value.trim();
  const birthdate = document.getElementById('birthdate').value;
  const birthtime = document.getElementById('birthtime').value;
  const gender = document.querySelector('input[name="gender"]:checked')?.value;

  if (!name || !birthdate || !birthtime || !gender) {
    alert('모든 정보를 입력해주세요.');
    return false;
  }

  // Loading state
  const submitBtn = document.querySelector('.btn-submit');
  submitBtn.classList.add('loading');
  submitBtn.disabled = true;

  // Parse date
  const [year, month, day] = birthdate.split('-').map(Number);
  const hour = parseInt(birthtime);

  // Brief loading effect
  setTimeout(() => {
    try {
      const result = SajuEngine.calculate(year, month, day, hour, gender);
      const interpretation = SajuEngine.generateInterpretation(result, name, gender);
      renderSajuResult(result, interpretation, name, birthdate, hour, gender);
    } catch (err) {
      console.error('사주 계산 에러:', err);
      alert('사주 풀이 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  }, 400);

  return false;
}

function showSajuForm() {
  document.getElementById('saju-form-container').style.display = 'block';
  document.getElementById('saju-result').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Render Saju Result =====
function renderSajuResult(result, interpretation, name, birthdate, hour, gender) {
  // Hide form, show result
  document.getElementById('saju-form-container').style.display = 'none';
  document.getElementById('saju-result').classList.remove('hidden');

  // Header
  document.getElementById('result-name').textContent = `${name}님의 사주팔자`;

  const timeLabels = {
    23: '자시(23~01시)', 1: '축시(01~03시)', 3: '인시(03~05시)', 5: '묘시(05~07시)',
    7: '진시(07~09시)', 9: '사시(09~11시)', 11: '오시(11~13시)', 13: '미시(13~15시)',
    15: '신시(15~17시)', 17: '유시(17~19시)', 19: '술시(19~21시)', 21: '해시(21~23시)'
  };

  const genderText = gender === 'male' ? '남성' : '여성';
  document.getElementById('result-birth').textContent =
    `${birthdate} | ${timeLabels[hour]} | ${genderText} | ${result.ddiEmoji} ${result.ddi}띠`;

  // Saju Table
  renderSajuTable(result);

  // Ohaeng Chart
  renderOhaengChart(result);

  // Interpretation Accordion
  renderInterpretationAccordion(interpretation);

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderInterpretationAccordion(interpretationSections) {
  const container = document.getElementById('interpretation-accordion');
  if (!container) return;

  let html = '';
  interpretationSections.forEach((sec, idx) => {
    const isOpen = idx === 0 ? 'active' : '';
    html += `
      <div class="accordion-item ${isOpen}">
        <div class="accordion-header" onclick="toggleAccordion(this)">
          <div class="accordion-header-left">
            <span class="accordion-num">0${idx + 1}</span>
            <span class="accordion-icon-badge">${sec.icon}</span>
            <h4 class="accordion-title">${sec.title}</h4>
          </div>
          <div class="accordion-chevron">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="accordion-content">
          <div class="accordion-body">
            ${sec.content}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function toggleAccordion(header) {
  const item = header.closest('.accordion-item');
  if (item) {
    item.classList.toggle('active');
  }
}

function renderSajuTable(result) {
  const labels = ['시주(時柱)', '일주(日柱)', '월주(月柱)', '연주(年柱)'];
  const pillars = [result.pillars[3], result.pillars[2], result.pillars[1], result.pillars[0]];

  let html = '';
  pillars.forEach((p, i) => {
    const ganOhaeng = SajuEngine.천간오행[p.gan];
    const jiOhaeng = SajuEngine.지지오행[p.ji];
    const ganElement = SajuEngine.오행영문[ganOhaeng];
    const jiElement = SajuEngine.오행영문[jiOhaeng];
    const ganHanja = SajuEngine.천간한자[SajuEngine.천간.indexOf(p.gan)];
    const jiHanja = SajuEngine.지지한자[SajuEngine.지지.indexOf(p.ji)];

    html += `
      <div class="saju-pillar">
        <div class="pillar-label">${labels[i]}</div>
        <div class="pillar-chars">
          <div class="pillar-char cheongan element-${ganElement}" title="${p.gan}(${ganHanja}) - ${ganOhaeng}">
            ${ganHanja}
          </div>
          <div class="pillar-element">${p.gan} · ${SajuEngine.오행한자[ganOhaeng]}</div>
          <div class="pillar-char jiji element-${jiElement}" title="${p.ji}(${jiHanja}) - ${jiOhaeng}">
            ${jiHanja}
          </div>
          <div class="pillar-element">${p.ji} · ${SajuEngine.오행한자[jiOhaeng]}</div>
        </div>
      </div>
    `;
  });

  document.getElementById('saju-table').innerHTML = html;
}

function renderOhaengChart(result) {
  const ohaengOrder = ['목', '화', '토', '금', '수'];
  const maxCount = Math.max(...Object.values(result.ohaengCount), 1);

  let html = '';
  let descParts = [];

  ohaengOrder.forEach(oh => {
    const count = result.ohaengCount[oh];
    const pct = (count / 8) * 100;
    const element = SajuEngine.오행영문[oh];
    const hanja = SajuEngine.오행한자[oh];

    html += `
      <div class="ohaeng-bar-group">
        <div class="ohaeng-bar-container">
          <div class="ohaeng-bar" style="height: ${Math.max(pct, 5)}%; background: var(--${element});"></div>
        </div>
        <span class="ohaeng-label" style="color: var(--${element})">${hanja}</span>
        <span class="ohaeng-count">${count}개</span>
      </div>
    `;

    if (count === 0) {
      descParts.push(`${hanja}(${oh})이 없어 보완이 필요합니다`);
    } else if (count >= 3) {
      descParts.push(`${hanja}(${oh})이 강해 ${oh === '목' ? '추진력' : oh === '화' ? '열정' : oh === '토' ? '안정감' : oh === '금' ? '결단력' : '지혜'}이 돋보입니다`);
    }
  });

  document.getElementById('ohaeng-chart').innerHTML = html;

  const descText = descParts.length > 0 ?
    descParts.join('. ') + '.' :
    '오행이 비교적 균형 잡혀 있어 조화로운 사주입니다.';
  document.getElementById('ohaeng-desc').innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:14px;margin-top:8px;">${descText}</p>`;
}

// ===== Fortune Section (오늘의 운세) =====
function initFortuneSection() {
  // Set date
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][today.getDay()]}요일`;
  document.getElementById('fortune-date').textContent = dateStr + ' 띠별 운세';

  // Generate zodiac cards
  const grid = document.getElementById('zodiac-grid');
  const yearSamples = {
    0: '2020, 2008, 1996, 1984',
    1: '2021, 2009, 1997, 1985',
    2: '2022, 2010, 1998, 1986',
    3: '2023, 2011, 1999, 1987',
    4: '2024, 2012, 2000, 1988',
    5: '2025, 2013, 2001, 1989',
    6: '2026, 2014, 2002, 1990',
    7: '2027, 2015, 2003, 1991',
    8: '2016, 2004, 1992, 1980',
    9: '2017, 2005, 1993, 1981',
    10: '2018, 2006, 1994, 1982',
    11: '2019, 2007, 1995, 1983'
  };

  let html = '';
  SajuEngine.띠동물.forEach((animal, idx) => {
    const fortune = SajuEngine.generateDailyFortune(idx);

    html += `
      <div class="zodiac-card" onclick="openFortuneModal(${idx})" id="zodiac-${idx}">
        <span class="zodiac-emoji">${SajuEngine.띠이모지[idx]}</span>
        <div class="zodiac-name">${animal}띠</div>
        <div class="zodiac-years">${yearSamples[idx]}</div>
        <div class="zodiac-luck-badge luck-${fortune.overallLuck}">${fortune.overallLuckText}</div>
      </div>
    `;
  });

  grid.innerHTML = html;
}

function openFortuneModal(zodiacIndex) {
  const animal = SajuEngine.띠동물[zodiacIndex];
  const emoji = SajuEngine.띠이모지[zodiacIndex];
  const fortune = SajuEngine.generateDailyFortune(zodiacIndex);
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  let starsHtml = (score) => {
    let s = '';
    for (let i = 0; i < 5; i++) {
      s += i < score ? '★' : '☆';
    }
    return s;
  };

  let categoriesHtml = fortune.categories.map(cat => `
    <div class="fortune-category">
      <div class="fortune-cat-header">
        <span class="fortune-cat-title">${cat.icon} ${cat.name}</span>
        <span class="fortune-stars">${starsHtml(cat.score)}</span>
      </div>
      <p class="fortune-cat-desc">${cat.text}</p>
    </div>
  `).join('');

  document.getElementById('modal-body').innerHTML = `
    <div class="modal-header">
      <span class="modal-emoji">${emoji}</span>
      <h3 class="modal-title">${animal}띠 오늘의 운세</h3>
      <p class="modal-date">${dateStr}</p>
      <div class="zodiac-luck-badge luck-${fortune.overallLuck}" style="margin-top:12px;">${fortune.overallLuckText}</div>
    </div>
    ${categoriesHtml}
    <div class="fortune-lucky">
      <div class="lucky-title">🍀 오늘의 행운</div>
      <div class="lucky-items">
        <div class="lucky-item">행운의 색 <span>${fortune.lucky.color}</span></div>
        <div class="lucky-item">행운의 숫자 <span>${fortune.lucky.number}</span></div>
        <div class="lucky-item">행운의 방향 <span>${fortune.lucky.direction}</span></div>
        <div class="lucky-item">행운의 음식 <span>${fortune.lucky.food}</span></div>
      </div>
    </div>
  `;

  document.getElementById('fortune-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeFortuneModal() {
  document.getElementById('fortune-modal').classList.remove('active');
  document.body.style.overflow = '';
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.id === 'fortune-modal') {
    closeFortuneModal();
  }
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeFortuneModal();
  }
});
