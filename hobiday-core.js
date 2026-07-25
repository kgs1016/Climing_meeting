/* ══════════════════════════════════════════════════════
   HOBIDAY 공통 코어 — 설문 스키마 + 카드 생성 로직
   app.html(참가자) / console.html(운영자) 공유
   ══════════════════════════════════════════════════════ */
(function (global) {

  const LEVELS = ['초급', '중급', '상급'];
  const LEVEL_DESC = {
    '초급': '빨강·주황 계열(초급)',
    '중급': '초록·파랑 계열(중급)',
    '상급': '보라 이상(상급)'
  };
  const MBTI = ['ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP',
                'ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'];

  /* 설문 문항
     match : 'exact'(단일 일치 → Tier1) | 'overlap'(다중 교집합 → Tier2)
     diff  : 값이 다를 때 Tier3 '궁금 포인트'로 노출
     hero  : 일치 시 카드 최상단 강조
     free  : 서술형 → 카드에 원문 그대로 노출                              */
  const FIELDS = [
    {key:'area', label:'사는 동네', type:'text', ph:'예: 연남동',
     match:'exact', card:v=>`같은 동네 · ${v}`},

    {key:'job', label:'하는 일 또는 전공', type:'text', ph:'예: 개발자, 경영학과',
     match:'exact', card:v=>`같은 분야 · ${v}`},

    {key:'mbti', label:'MBTI', type:'select', options:MBTI,
     match:'exact', card:v=>`둘 다 ${v}`,
     diff:true, diffCard:(a,b)=>`MBTI가 다름 — 나 ${a} / 상대 ${b}`},

    {key:'weekend', label:'주말의 나는?', type:'multi', hint:'복수 선택',
     options:['집콕','나들이','운동','전시·문화','맛집투어','즉흥여행'],
     match:'overlap', card:vs=>`주말 취향 겹침 · ${vs.join(' · ')}`},

    {key:'travel', label:'여행 스타일은?', type:'select',
     options:['분단위 계획형','즉흥형','맛집 중심','풍경 중심','액티비티 중심'],
     match:'exact', card:v=>`여행 스타일 같음 · ${v}`},

    {key:'food', label:'이건 못 참는다, 하는 음식', type:'multi', hint:'복수 선택',
     options:['마라','회·초밥','고기','빵·디저트','매운 것','국물+소주'],
     match:'overlap', card:vs=>`둘 다 못 참음 · ${vs.join(' · ')}`},

    {key:'dateStyle', label:'데이트는?', type:'select', options:['실내파','야외파'],
     match:'exact', card:v=>`둘 다 ${v}`,
     diff:true, diffCard:(a,b)=>`나는 ${a}, 상대는 ${b}`},

    {key:'afterClimb', label:'클라이밍 끝나면 나는?', type:'select', hero:true,
     options:['🍺 무조건 맥주','🥤 단백질 쉐이크','🍜 국밥·라멘 직행','🏃 바로 귀가','☕ 카페 수다'],
     match:'exact', card:v=>`둘 다 ${v}!`},

    {key:'gymItem', label:'암장 갈 때 꼭 챙기는 것', type:'select',
     options:['개인 초크','손톱깎이','테이핑','이어폰','맨몸이 장비'],
     match:'exact', card:v=>`둘 다 챙김 · ${v}`},

    {key:'topOut', label:'완등하면 나는?', type:'select',
     options:['조용히 쿨하게 하강','포효','아래 보며 브이','영상부터 확인'],
     match:'exact', card:v=>`완등 세리머니 같음 · ${v}`,
     diff:true, diffCard:(a,b)=>`완등하면 나는 "${a}", 상대는 "${b}"`},

    {key:'stuck', label:'안 풀리는 문제 앞에서 나는?', type:'select',
     options:['될 때까지 근성형','옆 문제로 도피','남의 베타 정찰','오늘은 아닌가 봐~'],
     match:'exact', card:v=>`막혔을 때 스타일 같음 · ${v}`,
     diff:true, diffCard:(a,b)=>`나는 "${a}", 상대는 "${b}" 🔍`},

    {key:'bestMoment', label:'클라이밍 최고의 순간은?', type:'select',
     options:['완등 순간','베타 짜는 순간','다 같이 응원받을 때','새 문제 세팅된 날'],
     match:'exact', card:v=>`최고의 순간이 같음 · ${v}`},

    {key:'threeWords', label:'나를 3단어로 표현하면?', type:'text',
     ph:'예: 집요함, 수다, 맥주', free:'나를 3단어로'},

    {key:'intoLately', label:'요즘 빠져있는 것', type:'text',
     ph:'예: 주말마다 빵집 투어', free:'요즘 빠져있는 것'},

    {key:'climbStart', label:'클라이밍을 시작한 계기', type:'text',
     ph:'짧아도 좋아요. 솔직할수록 대화가 잘 풀려요', free:'클라이밍 시작 계기'},
  ];

  /* 라운드 로빈 — 라운드 r(1~3): 남 i ↔ 여 (i+r-1)%3 → 9쌍 전부 커버 */
  function partnerSlot(gender, slot, round) {
    return gender === 'm'
      ? (slot + round - 1) % 3
      : (slot - round + 1 + 3) % 3;
  }

  /* 두 사람 중 하위 실력 기준 미션 난이도 */
  function missionText(levelA, levelB) {
    const ia = LEVELS.indexOf(levelA), ib = LEVELS.indexOf(levelB);
    if (ia < 0 || ib < 0) return '🎯 함께 미션 · 두 분 모두 편한 난이도로 2문제';
    return `🎯 함께 미션 · ${LEVEL_DESC[LEVELS[Math.min(ia, ib)]]} 이상 2문제 클리어`;
  }

  /* me 기준으로 you를 소개하는 카드 데이터 */
  function buildCard(me, you) {
    me = me || {}; you = you || {};
    const t1 = [], t2 = [], t3 = [];
    let hero = null, topKey = null;

    FIELDS.forEach(f => {
      const a = me[f.key], b = you[f.key];

      if (f.match === 'exact' && a && b && a === b) {
        const line = f.card(a);
        if (f.hero) hero = line; else t1.push(line);
        if (!topKey) topKey = f.key;
      } else if (f.match === 'overlap') {
        const inter = (a || []).filter(x => (b || []).includes(x));
        if (inter.length) {
          t2.push({ line: f.card(inter), hits: inter });
          if (!topKey) topKey = f.key;
        }
      }
      if (f.diff && a && b && a !== b && f.diffCard) t3.push(f.diffCard(a, b));
    });

    if (hero) t1.unshift(hero);

    const frees = FIELDS.filter(f => f.free && you[f.key])
                        .map(f => ({ label: f.free, text: you[f.key] }));

    return { t1, t2, t3: t3.slice(0, 2), frees, seed: seedFor(me, you, hero, t2) };
  }

  function seedFor(me, you, hero, t2) {
    if (hero) return '"라운드 끝나고 뭐 먹을지부터 정해야겠는데요?"';
    if (me.area && me.area === you.area) return `"${me.area} 사세요? 자주 가는 데 있어요?"`;
    if (me.travel && me.travel === you.travel) return '"최근 다녀온 여행 있어요? 저는…"';
    const w = t2.find(x => x.hits.includes('맛집투어'));
    if (w) return '"요즘 발견한 맛집 있어요?"';
    const any = t2.find(x => x.hits.length);
    if (any) return `"${any.hits[0]}" 얘기로 시작해보세요`;
    if (me.mbti && me.mbti === you.mbti) return `"${me.mbti}끼리는 통하는 게 있죠"`;
    if (you.climbStart) return '"클라이밍 어쩌다 시작했어요? 저는…"';
    return '"이 문제 같이 한번 붙어볼까요?"';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }

  /* 카드 HTML (양쪽 화면 공통 스타일 클래스 사용) */
  function cardHTML(card, opts) {
    opts = opts || {};
    const rows =
      card.t1.map(l => `<div class="row t1"><span class="tag">일치</span><span>${esc(l)}</span></div>`).join('') +
      card.t2.map(o => `<div class="row t2"><span class="tag">겹침</span><span>${esc(o.line)}</span></div>`).join('') +
      card.t3.map(l => `<div class="row t3"><span class="tag">궁금</span><span>${esc(l)}</span></div>`).join('');

    const frees = card.frees.map(f =>
      `<div class="quote"><small>상대가 직접 쓴 답 · ${esc(f.label)}</small>"${esc(f.text)}"</div>`).join('');

    return (rows || '<div class="empty">겹치는 항목이 없어요 — 클라이밍 얘기로 시작해보세요</div>')
      + frees
      + `<div class="seed"><small>💬 대화 씨앗</small>${esc(card.seed)}</div>`
      + (opts.mission ? `<div class="mission">${esc(opts.mission)}</div>` : '');
  }

  global.HOBIDAY = { LEVELS, LEVEL_DESC, MBTI, FIELDS, partnerSlot, missionText, buildCard, cardHTML, esc };

})(window);
