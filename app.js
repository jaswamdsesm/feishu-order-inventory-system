// app.js - 订单与库存管理系统

// ============ 模糊匹配产品 ============
// 常见别名/缩写映射（key 为用户可能输入的简写，value 为目标关键词）
const PRODUCT_ALIASES = {
  // 原有别名（值已修正为与 QUOTE_PRODUCTS 名称一致）
  'cagri': 'cagrilintide', 'cagr': 'cagrilintide',
  'mots': 'mots-c', 'motsc': 'mots-c', 'mots-c': 'mots-c',
  'bpc': 'bpc157', 'bpc-157': 'bpc157', 'bpc157': 'bpc157',
  'tb': 'tb500', 'tb-500': 'tb500', 'tb500': 'tb500',
  'ghk': 'ghk-cu', 'ghk-cu': 'ghk-cu', 'ghkcu': 'ghk-cu',
  'epitalon': 'epitalon', 'epi': 'epitalon',
  'dsip': 'dsip', 'selank': 'selank',
  'glp': 'glp-1', 'glp1': 'glp-1',
  'tirz': 'tirzepatide', 'semag': 'semaglutide', 'semaglu': 'semaglutide',
  'reta': 'retatrutide', 'retatru': 'retatrutide',
  'surmo': 'surmount', 'zepb': 'zepbound',
  'lira': 'liraglutide', 'dula': 'dulaglutide',
  'lipe': 'lipotropin', 'aod': 'aod9604', 'aod-9604': 'aod9604',
  // 从 ABBR_MAP 合并进来的缩写
  're': 'retatrutide',
  'retatide': 'retatrutide',
  'retatrutide': 'retatrutide',
};

// 常见拼写错误映射
const TYPOS = {
  // Semaglutide
  'semaglutide': 'semaglutide', 'semaglutide': 'semaglutide', 'semaglutde': 'semaglutide',
  // Tirzepatide
  'tirzepatide': 'tirzepatide', 'tirzepatde': 'tirzepatide', 'tirzepatude': 'tirzepatide',
  // Retatrutide
  'retatrutide': 'retatrutide', 'retatrutde': 'retatrutide', 'retatruide': 'retatrutide',
  // Liraglutide
  'liraglutide': 'liraglutide', 'liraglutde': 'liraglutide',
  // Cagrilintide
  'cagrilintide': 'cagrilintide', 'cagrilintde': 'cagrilintide', 'cagrilinitde': 'cagrilintide',
  // Semax（k/s 键盘相邻）
  'kemax': 'semax',
  // Mazdutide
  'mazditude': 'mazdutide',
  // BPC157
  'bpc157': 'bpc157', 'bpc-157': 'bpc157',
  // MOTS-c
  'motsc': 'mots-c',
  // KissPeptin（常见漏写 e）
  'kisspetin': 'kisspeptin', 'kisspetin10': 'kisspeptin10', 'kisspetin5': 'kisspeptin5',
  // Cardiogen
  'cardigen': 'cardiogen',
  // Pinealon
  'pineelon': 'pinealon',
  // SS-31
  'ss31': 'ss31',
  // Epithalon
  'epitalon': 'epithalon', 'eputhilon': 'epithalon',
};

// ============ 汇率缓存 ============
let _exchangeRates = null;
let _exchangeRatesExpiry = 0;

async function getExchangeRates() {
  const now = Date.now();
  if (_exchangeRates && now < _exchangeRatesExpiry) {
    return _exchangeRates;
  }
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await resp.json();
    if (data && data.rates) {
      _exchangeRates = {
        EUR: data.rates.EUR,
        AUD: data.rates.AUD,
        CAD: data.rates.CAD,
        CNY: data.rates.CNY,
        GBP: data.rates.GBP
      };
      _exchangeRatesExpiry = now + 30 * 60 * 1000;
      console.log('汇率已更新:', _exchangeRates);
      return _exchangeRates;
    }
  } catch (e) {
    console.warn('汇率获取失败，使用默认值', e);
  }
  return _exchangeRates || { EUR: 0.92, AUD: 1.53, CAD: 1.36 };
}

// 更新结算货币汇率显示
async function onSettlementCurrencyChange() {
  _settlementCurrency = document.getElementById('order-settlement-currency')?.value || 'USD';
  const rates = await getExchangeRates();
  _orderUsdToCny = rates.CNY || 7.25;
  // 1 结算货币 = ? USD：USD→rates 是 1USD=?cur，所以 1cur = 1/rates[cur]
  if (_settlementCurrency === 'USD') {
    _orderExchangeRate = 1;
  } else {
    _orderExchangeRate = 1 / (rates[_settlementCurrency] || 1);
  }
  const rateEl = document.getElementById('order-exchange-rate');
  if (rateEl) {
    const cnyRate = _orderUsdToCny * _orderExchangeRate;
    rateEl.textContent = `1 ${_settlementCurrency} = ¥${cnyRate.toFixed(4)}`;
  }
  recalcOrderTotal();
}

async function loadOrderExchangeRate() {
  // 打开订单弹窗时调用，初始化汇率
  const rates = await getExchangeRates();
  _orderUsdToCny = rates.CNY || 7.25;
  const cur = _settlementCurrency;
  if (cur === 'USD') {
    _orderExchangeRate = 1;
  } else {
    _orderExchangeRate = 1 / (rates[cur] || 1);
  }
  const rateEl = document.getElementById('order-exchange-rate');
  if (rateEl) {
    const cnyRate = _orderUsdToCny * _orderExchangeRate;
    rateEl.textContent = `1 ${cur} = ¥${cnyRate.toFixed(4)}`;
  }
}

function normalizeStr(s) {
  return (s || '').toLowerCase().replace(/[\s\-_.]/g, '').trim();
}

// Levenshtein 编辑距离：处理字符顺序错误（如 DSIP ↔ SDIP）
function levenshteinDist(a, b) {
  const na = a.length, nb = b.length;
  if (na === 0) return nb;
  if (nb === 0) return na;
  const d = Array.from({ length: na + 1 }, () => new Array(nb + 1).fill(0));
  for (let i = 0; i <= na; i++) d[i][0] = i;
  for (let j = 0; j <= nb; j++) d[0][j] = j;
  for (let i = 1; i <= na; i++) {
    for (let j = 1; j <= nb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[na][nb];
}

// 编辑距离相似度评分（0~1，1=完全相同）
function editSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDist(a, b) / maxLen;
}

// 模糊子序列匹配：输入字符按顺序出现在目标中即可
// e.g. "5amno" matches "5amino1mq"
function fuzzySubseq(input, target) {
  if (!input || !target) return false;
  let ti = 0;
  for (let ii = 0; ii < input.length && ti < target.length; ii++) {
    if (input[ii] === target[ti]) ti++;
  }
  return ti === target.length;
}

// 模糊子序列评分：返回 0~1 的匹配度，考虑连续匹配加成
function fuzzySubseqScore(input, target) {
  if (!input || !target) return 0;
  let ti = 0, score = 0, consecutive = 0;
  const len = input.length;
  for (let ii = 0; ii < input.length; ii++) {
    while (ti < target.length && target[ti] !== input[ii]) ti++;
    if (ti < target.length) {
      consecutive++;
      score += 1 + (consecutive > 1 ? consecutive * 0.5 : 0); // 连续匹配额外加分
      ti++;
    } else {
      consecutive = 0;
    }
  }
  return score / len; // 归一化
}

function correctTypo(s) {
  return TYPOS[normalizeStr(s)] || s;
}

function fuzzyFindProduct(name, sku) {
  if (!name && !sku) return null;
  const n = normalizeStr(name);
  const s = normalizeStr(sku);

  // 从输入中提取规格数字模式（如 5mg, 10vials, 2mg×10）
  const inputSpecMatch = (name || '').match(/(\d+)\s*mg/i);

  // 1. 完全匹配产品代码（short_name）
  if (n) {
    let found = allProducts.find(x => normalizeStr(x.short_name) === n);
    if (found) return { product: found, method: '产品代码匹配' };
  }

  // 2. 完全匹配产品名称
  if (n) {
    let found = allProducts.find(x => normalizeStr(x.name) === n);
    if (found) return { product: found, method: '精确名称' };
  }

  // 3. 完全匹配规格
  if (s) {
    let found = allProducts.find(x => normalizeStr(x.sku) === s);
    if (found) return { product: found, method: '精确规格' };
  }

  // 4. 别名/缩写匹配 → 转成关键词再匹配
  if (n) {
    const aliasKey = PRODUCT_ALIASES[n] || PRODUCT_ALIASES[n.replace(/[^a-z0-9]/g, '')];
    if (aliasKey) {
      let found = allProducts.find(x => normalizeStr(x.name).includes(aliasKey));
      if (found) return { product: found, method: '别名匹配' };
    }
  }

  // 5. 拼写纠正后匹配
  if (n) {
    const corrected = correctTypo(n);
    if (corrected !== n) {
      let found = allProducts.find(x => normalizeStr(x.name) === corrected);
      if (found) return { product: found, method: '拼写纠正' };
    }
  }

  // 6. 子序列模糊匹配（如 "5amno" → "5amino1mq"）
  if (n && n.length >= 2) {
    let subCandidates = allProducts.map(x => {
      const xn = normalizeStr(x.name);
      const xs = normalizeStr(x.short_name);
      const xSku = normalizeStr(x.sku);
      const nameScore = fuzzySubseqScore(n, xn);
      const shortScore = fuzzySubseqScore(n, xs);
      const skuScore = fuzzySubseqScore(n, xSku);
      const bestScore = Math.max(nameScore, shortScore, skuScore);
      return { product: x, score: bestScore };
    }).filter(c => c.score > 0.3); // 阈值：至少匹配 30% 字符

    if (subCandidates.length >= 1) {
      subCandidates.sort((a, b) => b.score - a.score);
      if (subCandidates.length === 1 || subCandidates[0].score > subCandidates[1]?.score * 1.3) {
        return { product: subCandidates[0].product, method: '子序列模糊匹配' };
      }
      // 多个候选时优先用规格筛选
      if (inputSpecMatch && subCandidates.length > 1) {
        const specNum = inputSpecMatch[1];
        const specMatch = subCandidates.find(c => (normalizeStr(c.product.sku) + normalizeStr(c.product.name)).includes(specNum + 'mg'));
        if (specMatch) return { product: specMatch.product, method: '子序列+规格匹配' };
      }
      if (subCandidates.length > 1) return { product: subCandidates.map(c => c.product), method: 'multiple' };
    }
  }

  // 7. 名称开头/主要单词匹配（如 "Reta" → Retatrutide）
  if (n && n.length >= 3) {
    let candidates = allProducts.filter(x => {
      const xn = normalizeStr(x.name);
      return xn.startsWith(n) || xn.includes(n);
    });
    if (candidates.length === 1) return { product: candidates[0], method: '前缀匹配' };
    if (candidates.length > 1) {
      // 如果有规格数字输入，优先匹配同规格
      if (inputSpecMatch) {
        const specNum = inputSpecMatch[1];
        const specMatch = candidates.find(x => (normalizeStr(x.sku) + normalizeStr(x.name)).includes(specNum + 'mg'));
        if (specMatch) return { product: specMatch, method: '前缀+规格匹配' };
      }
      return { product: candidates, method: 'multiple' };
    }
  }

  // 8. 宽泛模糊匹配（名称或规格包含输入）
  let candidates = [];
  if (n) {
    candidates = allProducts.filter(x => {
      const xn = normalizeStr(x.name);
      const xs = normalizeStr(x.short_name);
      return xn.includes(n) || n.includes(xn) || xs.includes(n) || n.includes(xs);
    });
  }
  if (candidates.length === 0 && s) {
    candidates = allProducts.filter(x => {
      const xs = normalizeStr(x.sku);
      return xs.includes(s) || s.includes(xs);
    });
  }
  if (candidates.length === 0 && n && s) {
    candidates = allProducts.filter(x => {
      const xn = normalizeStr(x.name);
      const xs = normalizeStr(x.sku);
      return xn.includes(n) || n.includes(xn) || xs.includes(s) || s.includes(xs);
    });
  }

  // 规格优先：如果输入含规格数字，同规格的排前面
  if (candidates.length > 1 && inputSpecMatch) {
    const specNum = inputSpecMatch[1];
    const specPriority = candidates.filter(x => (normalizeStr(x.sku) + normalizeStr(x.name)).includes(specNum + 'mg'));
    if (specPriority.length === 1) return { product: specPriority[0], method: '规格优先匹配' };
  }

  if (candidates.length === 1) return { product: candidates[0], method: '模糊匹配' };
  if (candidates.length > 1) return { product: candidates, method: 'multiple' };
  return null;
}

// 统一的模糊搜索（返回排序后的产品列表，用于下拉列表）
function fuzzyProductSearch(keyword) {
  if (!keyword) return allProducts;
  const kw = normalizeStr(keyword);
  if (!kw) return allProducts;

  // 先走别名映射
  const aliasTarget = PRODUCT_ALIASES[kw.replace(/[^a-z0-9]/g, '')];

  const scored = allProducts.map(p => {
    const pn = normalizeStr(p.name);
    const ps = normalizeStr(p.short_name);
    const pSku = normalizeStr(p.sku);
    let score = 0;

    // 产品代码完全匹配
    if (ps === kw) score += 1000;
    else if (ps.startsWith(kw)) score += 900;
    else if (ps.includes(kw)) score += 500;

    // 名称完全匹配
    if (pn === kw) score += 800;
    // 名称前缀匹配
    else if (pn.startsWith(kw)) score += 700;
    // 名称包含
    else if (pn.includes(kw)) score += 300;
    // 输入包含名称（反向）
    else if (kw.includes(pn)) score += 200;

    // 别名匹配
    if (aliasTarget && pn.includes(aliasTarget)) score += 600;

    // 拼写纠正
    const corrected = correctTypo(kw);
    if (corrected !== kw && pn === corrected) score += 750;
    if (corrected !== kw && pn.startsWith(corrected)) score += 650;

    // 规格匹配
    if (pSku === kw) score += 400;
    else if (pSku.includes(kw)) score += 100;
    else if (kw.includes(pSku)) score += 50;

    // 规格数字优先（输入含 mg 等时）
    const kwSpecMatch = keyword.match(/(\d+)\s*mg/i);
    if (kwSpecMatch && (pSku + pn).includes(kwSpecMatch[1] + 'mg')) score += 150;

    // 子序列模糊匹配（如 "5amno" → "5amino1mq"）
    if (score === 0) {
      const subName = fuzzySubseqScore(kw, pn);
      const subShort = fuzzySubseqScore(kw, ps);
      const subSku = fuzzySubseqScore(kw, pSku);
      const bestSub = Math.max(subName, subShort, subSku);
      if (bestSub > 0.3) score += Math.round(bestSub * 400); // 最高 400 分
    }

    return { product: p, score };
  });

  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).map(s => s.product);
}


// ============ 配置 ============
const SUPABASE_URL = 'https://pvrfqnffygusujsnxsct.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2cmZxbmZmeWd1c3Vqc254c2N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTI3ODYsImV4cCI6MjA5MzQ4ODc4Nn0.BraQWWOse2ikRGb02_PEgqV3b0Umdch9ugMqoBe7jio';
const FEISHU_APP_ID = 'cli_a9726837c7789cc5';

// ============ 全局状态 ============
let sb, currentUser = null, currentRole = 'employee', feishuUid = '';
let allProducts = [], allOrders = [], allOrderItems = [], allProfiles = [];
let allInventoryLogs = [];
let currentProfileId = '';  // 当前用户的 profile UUID，供订单权限过滤
let currentPage = 'dashboard', pageRefreshTimers = {}, editingOrderId = null, orderItemCounter = 0;
let originalStock = 0;  // 编辑产品时记录原始库存，用于写变动日志

// ============ 初始化 ============
async function init() {
  try {
    // 等待 Supabase SDK 异步加载完成
    if (typeof supabase === 'undefined') {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Supabase SDK 加载超时')), 8000);
        const check = setInterval(() => { if (typeof supabase !== 'undefined') { clearTimeout(t); clearInterval(check); resolve(); } }, 100);
      });
    }
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 本地开发模式：localhost 跳过飞书登录
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocalhost) {
      const localUser = localStorage.getItem('oi_user');
      if (localUser) {
        try {
          const u = JSON.parse(localUser);
          currentUser = u;
          currentRole = u.role || 'employee';
          feishuUid = u.feishu_user_id || '';
        } catch (e) { }
      }
      if (!currentUser) {
        currentUser = { name: '本地开发', role: 'super_admin', feishu_user_id: 'local_dev_001' };
        currentRole = 'super_admin';
        feishuUid = 'local_dev_001';
        localStorage.setItem('oi_user', JSON.stringify(currentUser));
      }
      hideLoading();
      applyRole();
      // 预加载运费模板和产品重量数据（避免首次新增订单时运费识别失败）
      try { await loadShippingTemplates(); } catch (e) { console.warn('预加载运费模板失败', e); }
      try { await loadWeightProducts(); } catch (e) { console.warn('预加载产品重量失败', e); }
      switchPage('dashboard');
      loadProfiles();  // 后台加载，不阻塞渲染
      return;
    }

    // 飞书 WebView 中 localStorage 按应用共享，不同用户会读到同一个缓存
    // 因此每次打开都必须走飞书登录获取真实身份，不依赖缓存
    await feishuLogin();
  } catch (err) {
    console.error(err);
    hideLoading();
    showToast('初始化失败:' + err.message, 'error');
  }
}

async function feishuLogin() {
  let code;
  // 等待飞书 JSSDK 加载完成（最多 5 秒）
  if (!window.tt) {
    try { await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('飞书SDK加载超时')), 5000); const check = setInterval(() => { if (window.tt) { clearTimeout(t); clearInterval(check); resolve(); } }, 100); }); } catch (e) { console.warn(e.message); }
  }
  // 飞书 WebView 环境：用 JSSDK 获取 auth code
  if (window.tt && window.tt.requestAuthCode) {
    try {
      await new Promise((resolve, reject) => {
        tt.config({ appId: FEISHU_APP_ID, onReady: resolve, onError: reject });
      });
      code = await new Promise((resolve, reject) => {
        tt.requestAuthCode({ appId: FEISHU_APP_ID, success: (res) => resolve(res.code), fail: (err) => reject(new Error('requestAuthCode 失败: ' + JSON.stringify(err))) });
      });
    } catch (e) {
      console.warn('JSSDK 获取 code 失败，降级为 URL 重定向:', e);
      code = null;
    }
  }
  // 非飞书环境 或 JSSDK 失败：走 URL 重定向
  if (!code) {
    const params = new URLSearchParams(window.location.search);
    code = params.get('code');
    if (!code) {
      window.location.href = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${FEISHU_APP_ID}&redirect_uri=${encodeURIComponent(location.origin + location.pathname)}&response_type=code`;
      return;
    }
    // 立即清除 URL 中的 code，防止刷新重复使用
    history.replaceState({}, document.title, location.pathname);
  }
  try {
    const resp = await fetch('https://pvrfqnffygusujsnxsct.functions.supabase.co/feishu-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, app_id: FEISHU_APP_ID })
    });
    if (!resp.ok) { const errData = await resp.json().catch(() => null); throw new Error('飞书登录失败(status:' + resp.status + ')' + (errData?.error ? ': ' + errData.error : '')); }
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || '飞书登录失败');
    currentUser = data.user;
    // ALI(592631) 强制超管，其他人从数据库读取角色
    feishuUid = data.user.feishu_user_id || '';
    // 同步获取 profile UUID，供订单权限过滤用（必须 await，否则 loadOrders 会漏掉过滤）
    if (data.user.id) {
      currentProfileId = data.user.id;
    } else {
      try {
        const { data: pf } = await sb.from('profiles').select('id').eq('feishu_user_id', feishuUid).single();
        if (pf) currentProfileId = pf.id;
      } catch (e) { console.warn('获取 profile ID 失败', e); }
    }
    if (!currentUser.name && data.user.en_name) currentUser.name = data.user.en_name;
    if (!currentUser.name && data.user.mobile) currentUser.name = data.user.mobile;
    currentRole = (feishuUid === '592631' || feishuUid === 'ALI_592631' || feishuUid === 'ou_dc1cda75f061ec9e607c2b78bd68f0f1') ? 'super_admin' : (data.user.role || 'employee');
    console.log('登录成功:', { name: currentUser.name, feishuUid, role: currentRole });
    try { await sb.rpc('upsert_profile', { p_feishu_user_id: feishuUid, p_name: currentUser.name || '未知用户', p_role: currentRole }); } catch (e) { console.warn('upsert_profile 失败', e); }
    hideLoading();
    applyRole();
    switchPage('dashboard');
    Promise.all([loadProfiles(), loadProducts(), loadOrders()]).then(() => refreshCurrentPage());
  } catch (err) { console.error(err); throw err; }
}

function hideLoading() { const e = document.getElementById('feishu-loading'); if (e) e.style.display = 'none'; }
function feishuLogout() { location.href = location.pathname; }

// ============ 权限控制 ============
function applyRole() {
  const isAdmin = ['super_admin', 'admin'].includes(currentRole);
  const isSuper = currentRole === 'super_admin';
  const isEmployee = currentRole === 'employee';
  const roleText = { super_admin: '超级管理员', admin: '管理员', employee: '员工' };
  document.getElementById('nav-admin-only').classList.toggle('hidden', !isSuper);
  document.getElementById('nav-logs-only').classList.toggle('hidden', !isAdmin);
  const mobileLogs = document.getElementById('mobile-nav-logs');
  if (mobileLogs) mobileLogs.classList.toggle('hidden', !isAdmin);
  document.getElementById('inventory-admin-btns').classList.toggle('hidden', !isAdmin);
  const shipAdmin = document.getElementById('shipping-admin-section');
  if (shipAdmin) shipAdmin.classList.toggle('hidden', !isAdmin);
  document.getElementById('export-orders-dropdown').querySelector('button').classList.toggle('hidden', !isSuper);
  document.getElementById('export-orders-dropdown').querySelector('button').classList.toggle('inline-flex', isSuper);
  document.getElementById('export-shipping-dropdown').querySelector('button').classList.toggle('hidden', !(isSuper || isAdmin));
  document.getElementById('export-shipping-dropdown').querySelector('button').classList.toggle('inline-flex', isSuper || isAdmin);
  document.getElementById('btn-batch-upload-order').classList.toggle('hidden', !isAdmin);
  document.getElementById('btn-add-order').classList.remove('hidden');
  const avatar = document.getElementById('sidebar-avatar');
  if (avatar) avatar.textContent = (currentUser?.name || '?')[0];
  const uname = document.getElementById('sidebar-user-name');
  if (uname) uname.textContent = currentUser?.name || '';
  const urole = document.getElementById('sidebar-user-role');
  if (urole) urole.textContent = roleText[currentRole] || currentRole;
}

// ============ 侧边栏/夜间模式/页面切换 ============
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ol = document.getElementById('sidebar-overlay');
  const open = !sb.classList.contains('-translate-x-full');
  sb.classList.toggle('-translate-x-full', open);
  ol.classList.toggle('hidden', open);
}
(function () {
  const s = localStorage.getItem('oi_dark_mode');
  if (s === 'true' || (!s && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
  updateDarkModeUI();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('oi_dark_mode')) {
      document.documentElement.classList.toggle('dark', e.matches);
      updateDarkModeUI();
    }
  });
})();
function toggleDarkMode() {
  const d = document.documentElement.classList.toggle('dark');
  localStorage.setItem('oi_dark_mode', d);
  updateDarkModeUI();
}
function updateDarkModeUI() {
  const d = document.documentElement.classList.contains('dark');
  const icon = document.getElementById('dark-mode-icon');
  const text = document.getElementById('dark-mode-text');
  if (icon) icon.textContent = d ? '☀️' : '🌙';
  if (text) text.textContent = d ? '日间模式' : '夜间模式';
}

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pe = document.getElementById('page-' + page);
  if (pe) pe.classList.add('active');
  const titles = { dashboard: '仪表盘', inventory: '库存管理', orders: '订单管理', logs: '变动日志', users: '用户管理', quote: '报价助手', shipping: '运费助手' };
  const te = document.getElementById('page-title');
  if (te) te.textContent = titles[page] || '';
  clearAllRefreshTimers();
  if (page === 'dashboard') { startPageRefresh(page, loadDashboardData); }
  else if (page === 'inventory') { startPageRefresh(page, () => loadProducts().then(renderInventory)); }
  else if (page === 'orders') { startPageRefresh(page, () => Promise.all([loadOrders(), loadWeightProducts()]).then(() => renderOrders())); }
  else if (page === 'logs') { startPageRefresh(page, () => loadInventoryLogs().then(renderLogs)); }
  else if (page === 'users' && currentRole === 'super_admin') { renderUsers(); }
  else if (page === 'quote') { renderQuotePage(); }
  else if (page === 'shipping') { loadWeightProducts().then(() => loadShippingTemplates().then(renderShippingPage)); }
}
function clearAllRefreshTimers() { Object.values(pageRefreshTimers).forEach(t => clearInterval(t)); pageRefreshTimers = {}; }
function startPageRefresh(page, fn) { clearAllRefreshTimers(); fn(); pageRefreshTimers[page] = setInterval(fn, 30000); }
function refreshCurrentPage() { switchPage(currentPage); }

// ============ 自定义下拉组件 ============
let activeDropdown = null;
function toggleDropdown(id) {
  const el = document.getElementById(id);
  const menu = el.querySelector(':scope > div:last-child');
  if (activeDropdown && activeDropdown !== el) {
    activeDropdown.querySelector(':scope > div:last-child').classList.add('hidden');
  }
  menu.classList.toggle('hidden');
  activeDropdown = menu.classList.contains('hidden') ? null : el;
}
function selectDropdown(id, label, value) {
  document.getElementById(id).querySelector('button > span').textContent = label;
  document.getElementById(id).dataset.value = value;
  const menu = document.getElementById(id).querySelector(':scope > div:last-child');
  menu.classList.add('hidden');
  activeDropdown = null;
}
function selectSort(label, field, dir) {
  document.getElementById('order-sort-dropdown').querySelector('button > span').textContent = label;
  document.getElementById('order-sort-dropdown').dataset.sortField = field;
  document.getElementById('order-sort-dropdown').dataset.sortDir = dir;
  const menu = document.getElementById('order-sort-dropdown').querySelector(':scope > div:last-child');
  menu.classList.add('hidden');
  activeDropdown = null;
  renderOrders();
}
document.addEventListener('click', function(e) {
  if (activeDropdown && !e.target.closest('.relative[id$="-dropdown"]')) {
    activeDropdown.querySelector(':scope > div:last-child').classList.add('hidden');
    activeDropdown = null;
  }
});

// ============ 工具函数 ============
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function showToast(msg, type) {
  type = type || 'info';
  const c = { success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-yellow-500', info: 'bg-blue-500' };
  const t = document.createElement('div');
  t.className = `fixed top-20 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-white text-sm font-medium shadow-lg z-[100] ${c[type] || c.info}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 2500);
}
function openModal(id) { const e = document.getElementById(id); if (e) { e.classList.remove('hidden'); e.style.display = 'flex'; e.classList.add('active'); } }
function closeModal(id) { const e = document.getElementById(id); if (e) { e.classList.add('hidden'); e.style.display = ''; e.classList.remove('active'); } }
async function genOrderNo(dateStr) {
  // dateStr: 'YYYY-MM-DD' 或 undefined（用今天）
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const ds = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const prefix = 'ORD' + ds;
  // 从数据库查当天最大序号，+1 保证唯一
  const { data, error } = await sb.from('orders')
    .select('order_no')
    .like('order_no', prefix + '%')
    .order('order_no', { ascending: false })
    .limit(1);
  let seq = 1;
  if (data && data.length > 0) {
    const lastNo = data[0].order_no;
    const lastSeq = parseInt(lastNo.slice(-4), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return prefix + String(seq).padStart(4, '0');
}
function isPhoneHidden() { return currentRole === 'employee'; }

// ============ 数据加载 ============
async function loadProfiles() { const { data, error } = await sb.from('profiles').select('*'); if (!error) { allProfiles = data || []; populateOwnerSelects(); } }
async function loadProducts() { const { data, error } = await sb.from('products').select('*').order('name'); if (!error) allProducts = data || []; return allProducts; }
async function loadOrders() {
  let query = sb.from('orders').select('*').order('created_at', { ascending: false }).limit(100);
  // 员工只能看自己创建的订单
  if (currentRole === 'employee' && currentProfileId) {
    query = query.eq('creator_id', currentProfileId);
  }
  const { data, error } = await query;
  if (!error) allOrders = data || [];
  const orderIds = allOrders.map(o => o.id);
  let items = [];
  if (orderIds.length > 0) {
    const { data: iData, error: e2 } = await sb.from('order_items').select('*').in('order_id', orderIds);
    if (!e2) items = iData || [];
  }
  allOrderItems = items;
  return allOrders;
}
async function loadInventoryLogs() { const { data, error } = await sb.from('inventory_logs').select('*').order('created_at', { ascending: false }).limit(200); if (error) console.error('loadInventoryLogs error:', error); else allInventoryLogs = data || []; console.log('loadInventoryLogs:', allInventoryLogs.length, '条'); }

// ============ 仪表盘 ============
async function loadDashboardData() {
  await Promise.all([loadProducts(), loadOrders()]);
  document.getElementById('dash-product-count').textContent = allProducts.length;
  const alerts = allProducts.filter(p => p.current_stock <= p.min_stock_alert);
  document.getElementById('dash-stock-alert').textContent = alerts.length;
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = allOrders.filter(o => (o.created_at || '').startsWith(today));
  document.getElementById('dash-today-orders').textContent = todayOrders.length;
  const thisMonth = new Date().toISOString().slice(0, 7);
  let monthSales = 0;
  // 只统计自己可见的订单（allOrders 已被 loadOrders 按权限过滤）
  allOrders.filter(o => (o.created_at || '').startsWith(thisMonth)).forEach(o => {
    allOrderItems.filter(i => i.order_id === o.id).forEach(i => { monthSales += (i.unit_price || 0) * i.quantity; });
  });
  document.getElementById('dash-month-sales').textContent = monthSales.toFixed(2) + '元';
  const al = document.getElementById('dash-alert-list');
  if (alerts.length === 0) al.innerHTML = '<p class="text-sm text-gray-400">暂无预警产品 🎉</p>';
  else al.innerHTML = alerts.map(p => `<div class="flex items-center justify-between py-2 border-b border-gray-50"><span class="text-sm font-medium text-red-600">${esc(p.name)}</span><span class="text-xs text-red-500">库存 ${p.current_stock} ${p.unit || '个'}（阈值 ${p.min_stock_alert}）</span></div>`).join('');
  const rl = document.getElementById('dash-recent-orders');
  const recent = allOrders.slice(0, 10);
  if (recent.length === 0) rl.innerHTML = '<p class="text-sm text-gray-400">暂无订单</p>';
  else rl.innerHTML = recent.map(o => {
    const sc = { pending: 'bg-yellow-100 text-yellow-700', shipped: 'bg-blue-100 text-blue-700', completed: 'bg-green-100 text-green-700', cancelled: 'bg-gray-100 text-gray-400' };
    return `<div class="flex items-center justify-between py-2 border-b border-gray-50"><div><p class="text-sm font-medium">${esc(o.order_no)}</p><p class="text-xs text-gray-400">${esc(o.customer_name)}</p></div><span class="text-xs px-2 py-1 rounded-full ${sc[o.status] || ''}">${statusText(o.status)}</span></div>`;
  }).join('');
}

// ============ 库存管理 ============
function renderInventory() {
  // 保存当前已选中的 checkbox（搜索刷新后恢复）
  const checkedIds = new Set([...document.querySelectorAll('.inv-chk:checked')].map(c => c.value));

  const kw = document.getElementById('inventory-search').value.trim().toLowerCase();
  const filtered = kw ? fuzzyProductSearch(kw) : allProducts;
  const isAdmin = ['super_admin', 'admin'].includes(currentRole);
  let head = '<tr>';
  if (isAdmin) head += '<th class="px-3 py-3 text-left"><input type="checkbox" id="inv-select-all" onchange="toggleInvSelectAll(this)" class="rounded"/></th>';
  ['产品名称', '简称', '规格', '当前库存', '预警阈值', '单位', '更新时间', isAdmin ? '操作' : ''].forEach(h => { head += `<th class="px-4 py-3 text-left font-medium">${h}</th>`; });
  head += '</tr>';
  document.getElementById('inventory-head').innerHTML = head;
  if (filtered.length === 0) { document.getElementById('inventory-body').innerHTML = ''; document.getElementById('inventory-empty').classList.remove('hidden'); return; }
  document.getElementById('inventory-empty').classList.add('hidden');
  document.getElementById('inventory-body').innerHTML = filtered.map(p => {
    const isLow = p.current_stock <= p.min_stock_alert;
    const chk = checkedIds.has(p.id) ? ' checked' : '';
    const chkHtml = isAdmin ? `<td class="px-3 py-3"><input type="checkbox" class="inv-chk rounded" value="${p.id}"${chk} onchange="updateBatchStockBtn()" /></td>` : '';
    const btnHtml = isAdmin ? `<button onclick="openRestockModal('${p.id}')" class="text-xs text-green-600 hover:underline mr-2">补货</button><button onclick="openProductModal('${p.id}')" class="text-xs text-blue-500 hover:underline mr-2">编辑</button><button onclick="deleteProduct('${p.id}')" class="text-xs text-red-500 hover:underline">删除</button>` : '';
    return `<tr class="${isLow ? 'stock-warn' : ''} border-b border-gray-50 hover:bg-gray-50">${chkHtml}<td class="px-4 py-3 font-medium">${esc(p.name)}</td><td class="px-4 py-3 text-gray-500">${esc(p.short_name || '-')}</td><td class="px-4 py-3 text-gray-400">${esc(p.sku || '-')}</td><td class="px-4 py-3 ${isLow ? 'text-red-600 font-bold' : 'text-green-600'}">${p.current_stock} ${esc(p.unit || '个')}</td><td class="px-4 py-3 text-xs text-gray-400">${p.min_stock_alert}</td><td class="px-4 py-3">${esc(p.unit || '个')}</td><td class="px-4 py-3 text-xs text-gray-400">${(p.updated_at || p.created_at || '').slice(0, 10)}</td><td class="px-4 py-3">${btnHtml}</td></tr>`;
  }).join('');
  updateBatchStockBtn();
}

function openProductModal(id) {
  document.getElementById('product-id').value = id || '';
  document.getElementById('product-modal-title').textContent = id ? '编辑产品' : '新增产品';
  if (id) {
    const p = allProducts.find(x => x.id === id);
    if (p) {
      originalStock = p.current_stock || 0;
      document.getElementById('product-name').value = p.name || '';
      document.getElementById('product-short-name').value = p.short_name || '';
      document.getElementById('product-sku').value = p.sku || '';
      document.getElementById('product-stock').value = p.current_stock || 0;
      document.getElementById('product-alert').value = p.min_stock_alert || 10;
      document.getElementById('product-unit').value = p.unit || '个';
    }
  } else {
    originalStock = 0;
    document.getElementById('product-name').value = '';
    document.getElementById('product-short-name').value = '';
    document.getElementById('product-sku').value = '';
    document.getElementById('product-stock').value = 0;
    document.getElementById('product-alert').value = 10;
    document.getElementById('product-unit').value = '个';
  }
  openModal('modal-product');
}

async function saveProduct() {
  const id = document.getElementById('product-id').value || null;
  const name = document.getElementById('product-name').value.trim();
  const shortName = document.getElementById('product-short-name').value.trim();
  const sku = document.getElementById('product-sku').value.trim();
  const stock = parseInt(document.getElementById('product-stock').value) || 0;
  const alertVal = parseInt(document.getElementById('product-alert').value) || 10;
  const unit = document.getElementById('product-unit').value.trim() || '个';
  if (!name) { showToast('请填写产品名称', 'warning'); return; }
  // 🔑 复合唯一性预检：名称+简称+规格+单位 完全一致视为同一产品
  const conflict = allProducts.find(p =>
    (p.name || '') === name &&
    (p.short_name || '') === shortName &&
    (p.sku || '') === sku &&
    (p.unit || '个') === unit &&
    p.id !== id
  );
  if (conflict) {
    showToast(`该产品已存在（${conflict.name}${conflict.sku ? ' ' + conflict.sku : ''}），请勿重复添加`, 'error');
    return;
  }
  const btn = document.getElementById('btn-save-product');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    // 编辑模式且库存有变化：写变动日志（p_skip_stock=true，库存由 upsert_product 管）
    if (id && stock !== originalStock) {
      const diff = stock - originalStock;
      const changeType = diff > 0 ? 'restock' : 'adjust';
      const { error: logErr } = await sb.rpc('adjust_inventory', {
        p_product_id: id,
        p_change_type: changeType,
        p_quantity: Math.abs(diff),
        p_remark: '编辑产品调整库存',
        p_feishu_user_id: feishuUid,
        p_skip_stock: true
      });
      if (logErr) console.warn('库存调整日志写入失败:', logErr.message);
    }
    // 保存产品（upsert_product 会覆盖库存值为 stock，与 adjust_inventory 调过的值一致）
    const { data, error } = await sb.rpc('upsert_product', { p_id: id, p_name: name, p_short_name: shortName, p_sku: sku || null, p_stock: stock, p_alert: alertVal, p_unit: unit, p_feishu_user_id: feishuUid });
    if (error) throw error;
    closeModal('modal-product');
    await Promise.all([loadProducts(), loadInventoryLogs()]);
    renderInventory();
    showToast(id ? '产品已更新' : '产品已添加', 'success');
  } catch (err) { showToast('保存失败:' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '保存'; }
}

async function deleteProduct(id) {
  if (!confirm('确认删除该产品？删除后不可恢复！')) return;
  try {
    const { error } = await sb.rpc('delete_product', { p_id: id, p_feishu_user_id: feishuUid });
    if (error) throw error;
    await loadProducts(); renderInventory();
    showToast('产品已删除', 'success');
  } catch (err) { showToast('删除失败:' + err.message, 'error'); }
}

// ============ 自定义日期选择器 ============
let _dpState = { targetId: null, viewYear: 0, viewMonth: 0 };
const _dpCallbacks = { 'order-date-from': () => renderOrders(), 'order-date-to': () => renderOrders(), 'order-date': () => {} };

function openDatePicker(inputId) {
  closeDatePicker();
  const input = document.getElementById(inputId);
  if (!input) return;
  const wrapId = 'wrap-' + inputId;
  const wrap = document.getElementById(wrapId) || input.parentElement;
  // 解析当前值
  const val = input.value || '';
  const parts = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const now = new Date();
  _dpState.viewYear = parts ? parseInt(parts[1]) : now.getFullYear();
  _dpState.viewMonth = parts ? parseInt(parts[2]) - 1 : now.getMonth();
  _dpState.targetId = inputId;
  // 创建面板
  const panel = document.createElement('div');
  panel.className = 'date-picker-panel';
  panel.id = '_dp_panel';
  wrap.style.position = 'relative';
  wrap.appendChild(panel);
  renderDPCalendar();
  // 点击外部关闭（用 mousedown 抢先于 blur，检查目标是否在面板或 input 内）
  _dpState._handler = function(e) {
    const p = document.getElementById('_dp_panel');
    if (!p) return;
    if (p.contains(e.target) || e.target === input) return;
    closeDatePicker();
  };
  document.addEventListener('mousedown', _dpState._handler, true);
}

function closeDatePicker() {
  const p = document.getElementById('_dp_panel');
  if (p) p.remove();
  if (_dpState._handler) {
    document.removeEventListener('mousedown', _dpState._handler, true);
    _dpState._handler = null;
  }
  _dpState.targetId = null;
}

function renderDPCalendar() {
  const panel = document.getElementById('_dp_panel');
  if (!panel) return;
  const y = _dpState.viewYear, m = _dpState.viewMonth;
  const firstDay = new Date(y, m, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const input = document.getElementById(_dpState.targetId);
  const selectedStr = input ? input.value : '';
  const weekLabels = ['日', '一', '二', '三', '四', '五', '六'];
  let html = '<div class="dp-header"><button onclick="dpNav(-1)">&#9664;</button><span>' + y + '年' + (m + 1) + '月</span><button onclick="dpNav(1)">&#9654;</button></div>';
  html += '<div class="dp-weekdays">' + weekLabels.map(w => '<span>' + w + '</span>').join('') + '</div>';
  html += '<div class="dp-days">';
  // 上月填充
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevDays - i;
    html += '<div class="dp-day other-month" onclick="dpPick(' + y + ',' + (m - 1) + ',' + d + ')">' + d + '</div>';
  }
  // 本月
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    let cls = 'dp-day';
    if (ds === todayStr) cls += ' today';
    if (ds === selectedStr) cls += ' selected';
    html += '<div class="' + cls + '" onclick="dpPick(' + y + ',' + m + ',' + d + ')">' + d + '</div>';
  }
  // 下月填充
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - totalCells % 7) % 7;
  for (let d = 1; d <= remaining; d++) {
    html += '<div class="dp-day other-month" onclick="dpPick(' + y + ',' + (m + 1) + ',' + d + ')">' + d + '</div>';
  }
  html += '</div>';
  panel.innerHTML = html;
}

function dpNav(dir) {
  _dpState.viewMonth += dir;
  if (_dpState.viewMonth < 0) { _dpState.viewMonth = 11; _dpState.viewYear--; }
  if (_dpState.viewMonth > 11) { _dpState.viewMonth = 0; _dpState.viewYear++; }
  renderDPCalendar();
}

function dpPick(y, m, d) {
  // 修正月份溢出
  const date = new Date(y, m, d);
  const ds = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  const input = document.getElementById(_dpState.targetId);
  if (input) {
    input.value = ds;
    input.dispatchEvent(new Event('change'));
  }
  closeDatePicker();
  // 回调
  const cb = _dpCallbacks[_dpState.targetId];
  if (cb) cb();
}

// ============ 订单管理 ============
function renderOrders() {
  const kw = document.getElementById('order-search').value.trim().toLowerCase();
  const statusFilter = document.getElementById('order-status-dropdown').dataset.value || '';
  const ownerFilter = document.getElementById('order-owner-filter')?.value || '';
  const countryFilter = document.getElementById('order-country-filter')?.value.trim().toLowerCase() || '';
  const dateFrom = document.getElementById('order-date-from').value;
  const dateTo = document.getElementById('order-date-to').value;
  const sortField = document.getElementById('order-sort-dropdown').dataset.sortField || 'created_at';
  const sortDir = document.getElementById('order-sort-dropdown').dataset.sortDir || 'desc';
  let filtered = allOrders;
  if (statusFilter) filtered = filtered.filter(o => o.status === statusFilter);
  if (ownerFilter) filtered = filtered.filter(o => o.owner_name === ownerFilter);
  if (countryFilter) filtered = filtered.filter(o => (o.country || '').toLowerCase().includes(countryFilter));
  if (kw) filtered = filtered.filter(o => (o.order_no || '').toLowerCase().includes(kw) || (o.customer_name || '').toLowerCase().includes(kw));
  if (dateFrom) filtered = filtered.filter(o => (o.created_at || '').slice(0, 10) >= dateFrom);
  if (dateTo) filtered = filtered.filter(o => (o.created_at || '').slice(0, 10) <= dateTo);
  // 排序（日期字段按时间戳排序，金额按数值排序）
  filtered.sort((a, b) => {
    let va, vb;
    if (sortField === 'amount') {
      const tA = (allOrderItems.filter(i => i.order_id === a.id).reduce((s, i) => s + (i.unit_price || 0) * i.quantity, 0));
      const tB = (allOrderItems.filter(i => i.order_id === b.id).reduce((s, i) => s + (i.unit_price || 0) * i.quantity, 0));
      va = tA; vb = tB;
    } else if (sortField === 'created_at') {
      va = new Date(a.created_at || 0).getTime();
      vb = new Date(b.created_at || 0).getTime();
    } else {
      va = (a[sortField] || '').toString();
      vb = (b[sortField] || '').toString();
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  const phoneHidden = isPhoneHidden();
  const isAdmin = ['super_admin', 'admin'].includes(currentRole);
  if (filtered.length === 0) { document.getElementById('orders-list').innerHTML = ''; document.getElementById('orders-empty').classList.remove('hidden'); return; }
  document.getElementById('orders-empty').classList.add('hidden');
  document.getElementById('orders-list').innerHTML = filtered.map(o => {
    const items = allOrderItems.filter(i => i.order_id === o.id);
    let totalUSD = items.reduce((s, i) => s + (i.unit_price || 0) * i.quantity, 0);
    // 防护：如果 items 计算为 0 但 orders 表有值，回退到 total_amount
    if (totalUSD === 0 && items.length > 0 && (o.total_amount || 0) > 0) {
      totalUSD = o.total_amount;
    }
    const cur = o.settlement_currency || 'USD';
    const rate = o.exchange_rate || 1; // 1 cur = ? USD
    const sym = curSym(cur);
    const totalCur = totalUSD / rate;
    const phoneHtml = phoneHidden ? (o.customer_phone ? '***' : '') : esc(o.customer_phone || '');
    const addrHtml = phoneHidden ? (o.customer_address ? '***' : '') : esc(o.customer_address || '');
    const sc = { pending: 'border-yellow-300 bg-yellow-50', shipped: 'border-blue-300 bg-blue-50', completed: 'border-green-300 bg-green-50', cancelled: 'border-gray-200 bg-gray-50' };
    const sc2 = { pending: 'text-yellow-600', shipped: 'text-blue-600', completed: 'text-green-600', cancelled: 'text-gray-400' };
    const canShip = o.status === 'pending' && isAdmin;
    const shipBtn = canShip ? `<button onclick="openShipModal('${o.id}')" class="text-xs text-green-600 hover:underline mr-2">🚚 发货</button>` : '';
    const trackHtml = o.tracking_no ? `<p class="text-xs text-green-600">📦 单号：${esc(o.tracking_no)}</p>` : '';
    const canEdit = isAdmin && !['shipped','completed'].includes(o.status);
    const btnHtml = canEdit ? `<button onclick="openOrderModal('${o.id}')" class="text-xs text-blue-500 hover:underline mr-2">编辑</button><button onclick="deleteOrder('${o.id}')" class="text-xs text-red-500 hover:underline">删除</button>` : '';
    const deliveredBtn = (o.status === 'shipped' && isAdmin) ? `<button onclick="markDelivered('${o.id}')" class="text-xs text-blue-600 hover:underline mr-2">📦 已送达</button>` : '';
    const cnyHtml = o.total_cny > 0 ? `<span class="text-xs text-gray-400">≈ ¥${parseFloat(o.total_cny).toFixed(2)}</span>` : '';
    const shippingCur = rate > 0 ? ((o.shipping_fee || 0) * rate / rate).toFixed(2) : (o.shipping_fee || 0);
    // shipping_fee 存的是结算货币金额，直接用
    const handlingCur = rate > 0 ? ((o.handling_fee || 0)).toFixed(2) : '0.00';
    return `<div class="order-card border ${sc[o.status] || 'border-gray-200'} rounded-xl p-4 bg-white shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="font-bold text-base">${esc(o.order_no)}</span>
          <span class="text-xs px-2 py-0.5 rounded-full ${sc2[o.status] || ''} font-medium bg-opacity-50">${statusText(o.status)}</span>
          ${cur !== 'USD' ? '<span class="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">' + cur + '</span>' : ''}
        </div>
        <span class="text-sm text-gray-700 font-semibold">${(o.created_at || '').slice(0, 10)}</span>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mb-3">
        <span>👤 ${esc(o.customer_name)}</span>
        <span>📞 ${phoneHtml || '—'}</span>
        ${o.country ? '<span>🌍 ' + esc(o.country) + '</span>' : ''}
        ${o.payment_method ? '<span class="text-purple-500">' + PAYMENT_LABELS[o.payment_method] + '</span>' : ''}
        ${o.owner_name ? '<span class="text-blue-400">归属：' + esc(o.owner_name) + '</span>' : ''}
      </div>
      ${o.customer_address ? '<div class="text-xs text-gray-400 mb-2 truncate">📍 ' + addrHtml + '</div>' : ''}
      ${trackHtml}
      <div class="border-t border-gray-100 mt-2 pt-2 space-y-1 overflow-hidden">${items.map(i => { const p = allProducts.find(x => x.id === i.product_id); const spec = p && p.sku ? ' ' + esc(p.sku) : ''; const lineCur = ((i.unit_price || 0) * i.quantity / rate); return `<div class="flex items-center justify-between text-xs min-w-0"><span class="truncate">${esc(p ? p.name : '未知产品')}${spec} × ${i.quantity}</span><span class="text-gray-500 shrink-0 ml-2">${sym}${lineCur.toFixed(2)}</span></div>`; }).join('')}</div>
      <div class="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-bold text-sm text-green-700">${sym}${totalCur.toFixed(2)}</span>
          ${o.shipping_fee > 0 ? '<span class="text-xs text-orange-500">运费' + sym + parseFloat(o.shipping_fee).toFixed(2) + '</span>' : ''}
          ${o.handling_fee > 0 ? '<span class="text-xs text-red-400" title="从利润扣除">手续费-' + sym + parseFloat(o.handling_fee).toFixed(2) + '</span>' : ''}
          ${cnyHtml}
        </div>
        <div class="flex items-center gap-1">${shipBtn}${deliveredBtn}${btnHtml}</div>
      </div>
    </div>`;
  }).join('');
}

function statusText(s) { return { pending: '待处理', shipped: '已发货', completed: '已完成', cancelled: '已取消' }[s] || s; }

function openShipModal(orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;
  document.getElementById('ship-modal-title').textContent = '发货 — ' + o.order_no;
  document.getElementById('ship-order-no').textContent = o.order_no;
  document.getElementById('ship-tracking-no').value = o.tracking_no || '';
  document.getElementById('btn-confirm-ship').dataset.orderId = orderId;
  openModal('modal-ship');
  setTimeout(() => document.getElementById('ship-tracking-no')?.focus(), 100);
}

async function confirmShip() {
  const btn = document.getElementById('btn-confirm-ship');
  const orderId = btn.dataset.orderId;
  if (!orderId) return;
  const trackingNo = document.getElementById('ship-tracking-no').value.trim();
  if (!trackingNo) { showToast('请输入快递单号', 'warning'); return; }
  btn.disabled = true; btn.textContent = '提交中…';
  try {
    const o = allOrders.find(x => x.id === orderId);
    if (!o) throw new Error('订单不存在');
    const { error } = await sb.rpc('upsert_order', {
      p_id: orderId,
      p_order_no: o.order_no,
      p_customer_name: o.customer_name || '',
      p_customer_phone: o.customer_phone || '',
      p_customer_address: o.customer_address || o.address || '',
      p_country: o.country || '',
      p_product_summary: o.product_summary || '',
      p_total_quantity: o.total_quantity || 0,
      p_total_amount: o.total_amount || 0,
      p_status: 'shipped',
      p_feishu_user_id: o.feishu_user_id || feishuUid,
      p_items: o.items || [],
      p_shipping_fee: String(o.shipping_fee || 0),
      p_payment_method: o.payment_method || null,
      p_handling_fee: o.handling_fee || 0,
      p_order_date: o.order_date || null,
      p_remark: o.remark || '',
      p_tracking_no: trackingNo,
      p_settlement_currency: o.settlement_currency || 'USD',
      p_exchange_rate: o.exchange_rate || 1,
      p_total_cny: o.total_cny || 0
    });
    if (error) throw error;
    const idx = allOrders.findIndex(o => o.id === orderId);
    if (idx >= 0) { allOrders[idx].status = 'shipped'; allOrders[idx].tracking_no = trackingNo; }
    closeModal('modal-ship');
    renderOrders();
    showToast('已标记为已发货', 'success');
  } catch (e) {
    showToast('操作失败：' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '确认发货';
  }
}

function toggleTrackingRow() {
  const status = document.getElementById('order-status')?.value;
  document.getElementById('order-tracking-row')?.classList.toggle('hidden', status !== 'shipped');
}

async function openOrderModal(id) {
  editingOrderId = id || null;
  document.getElementById('order-modal-title').textContent = id ? '编辑订单' : '新增订单';
  document.getElementById('order-id').value = id || '';
  document.getElementById('order-status-row').classList.toggle('hidden', !id);
  document.getElementById('order-items-container').innerHTML = '';
  // 清理所有产品行的 AbortController
  document.querySelectorAll('#order-items-container div[id^="item-row-"]').forEach(r => { if (r._ac) r._ac.abort(); });
  orderItemCounter = 0;
  // 默认填入今天日期
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('order-date').value = today;
  // 默认结算货币 USD
  document.getElementById('order-settlement-currency').value = 'USD';
  _settlementCurrency = 'USD';
  if (id) {
    const o = allOrders.find(x => x.id === id);
    if (o) {
      document.getElementById('order-customer-name').value = o.customer_name || '';
      document.getElementById('order-customer-phone').value = o.customer_phone || '';
      document.getElementById('order-customer-email').value = o.customer_email || '';
      document.getElementById('order-customer-addr').value = o.customer_address || '';
      document.getElementById('order-customer-country').value = o.country || '';
      document.getElementById('order-customer-country-input').value = o.country || '';
      document.getElementById('order-status').value = o.status || 'pending';
      document.getElementById('order-remark').value = o.remark || '';
      document.getElementById('order-shipping-fee').value = o.shipping_fee || '';
      document.getElementById('order-tracking-no').value = o.tracking_no || '';
      document.getElementById('order-payment-method').value = o.payment_method || '';
      // 回填结算货币和汇率
      _settlementCurrency = o.settlement_currency || 'USD';
      document.getElementById('order-settlement-currency').value = _settlementCurrency;
      _orderExchangeRate = o.exchange_rate || 1;
      // 回填订单日期（取 created_at 的日期部分）
      if (o.created_at) document.getElementById('order-date').value = o.created_at.slice(0, 10);
      document.getElementById('order-tracking-row').classList.toggle('hidden', o.status !== 'shipped');
      document.getElementById('order-owner-select').value = o.owner_name || '';
      let items = allOrderItems.filter(i => i.order_id === id);
      // 如果 items 为空（可能数据未加载），重新加载
      if (items.length === 0) {
        await loadOrders();
        items = allOrderItems.filter(i => i.order_id === id);
      }
      items.forEach(i => addOrderItemRow(i));
    }
  } else {
    document.getElementById('order-customer-name').value = '';
    document.getElementById('order-customer-phone').value = '';
    document.getElementById('order-customer-email').value = '';
    document.getElementById('order-customer-addr').value = '';
    document.getElementById('order-status').value = 'pending';
    document.getElementById('order-remark').value = '';
    document.getElementById('order-shipping-fee').value = '';
    document.getElementById('order-payment-method').value = '';
    addOrderItemRow();
  }
  // 加载汇率后重新计算
  await loadOrderExchangeRate();
  recalcOrderTotal();
  openModal('modal-order');
}

function addOrderItemRow(existing) {
  const idx = orderItemCounter++;
  const div = document.createElement('div');
  div.id = 'item-row-' + idx;
  div.className = 'flex items-center gap-2';
  div.innerHTML =
    `<div class="relative flex-1 min-w-0" id="ps-wrap-${idx}">
       <input type="text" id="ps-search-${idx}" placeholder="搜索产品名/规格…" class="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" autocomplete="off" />
       <input type="hidden" id="item-product-${idx}" value="" />
       <div id="ps-drop-${idx}" class="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto z-50 hidden"></div>
     </div>`
    + `<input type="number" id="item-qty-${idx}" min="1" value="${existing ? existing.quantity : 1}" placeholder="数量" class="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center" />`
    + `<input type="number" id="item-price-${idx}" min="0" step="0.01" value="${existing ? existing.unit_price : 0}" placeholder="单价" class="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center" />`
    + `<button onclick="removeOrderItemRow('item-row-${idx}')" class="text-red-400 hover:text-red-600 text-lg flex-shrink-0">×</button>`;
  document.getElementById('order-items-container').appendChild(div);

  const searchInput = document.getElementById('ps-search-' + idx);
  const dropEl = document.getElementById('ps-drop-' + idx);
  const hiddenInput = document.getElementById('item-product-' + idx);

  function renderDrop(list) {
    if (list.length === 0) { dropEl.classList.add('hidden'); return; }
    dropEl.innerHTML = list.map(p => {
      const label = `${esc(p.name)}${p.sku ? '（' + esc(p.sku) + '）' : ''}`;
      return `<div class="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 border-b border-gray-50 last:border-0" data-pid="${p.id}">
        <span class="font-medium">${label}</span>
        <span class="text-gray-400 ml-1">库存:${p.current_stock}${p.unit}</span>
      </div>`;
    }).join('');
    dropEl.classList.remove('hidden');
    dropEl.querySelectorAll('[data-pid]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const pid = el.dataset.pid;
        const p = allProducts.find(x => x.id === pid);
        hiddenInput.value = pid;
        searchInput.value = p ? `${p.name}${p.sku ? '（' + p.sku + '）' : ''}` : '';
        dropEl.classList.add('hidden');
      });
    });
  }

  searchInput.addEventListener('focus', () => {
    const kw = searchInput.value.trim();
    const list = kw ? fuzzyProductSearch(kw) : allProducts;
    renderDrop(list);
  });
  searchInput.addEventListener('input', () => {
    const kw = searchInput.value.trim();
    if (!kw) { dropEl.classList.add('hidden'); hiddenInput.value = ''; searchInput.value = ''; return; }
    const list = fuzzyProductSearch(kw);
    renderDrop(list);
  });
  // 点击外部关闭下拉（用 AbortController 便于清理）
  const ac = new AbortController();
  div._ac = ac;
  document.addEventListener('click', function(e) {
    if (!div.contains(e.target)) { dropEl.classList.add('hidden'); }
  }, { signal: ac.signal });

  if (existing && existing.product_id) {
    const p = allProducts.find(x => x.id === existing.product_id);
    if (p) {
      hiddenInput.value = p.id;
      searchInput.value = `${p.name}${p.sku ? '（' + p.sku + '）' : ''}`;
    }
  }
}

function removeOrderItemRow(rowId) { const e = document.getElementById(rowId); if (e) { if (e._ac) e._ac.abort(); e.remove(); } }

function checkOrderDup(name, addr) {
  const today = new Date().toISOString().slice(0, 10);
  return allOrders.find(o => o.customer_name === name && o.customer_address === addr && (o.created_at || '').startsWith(today));
}

async function saveOrder() {
  const isEdit = !!editingOrderId;
  const name = document.getElementById('order-customer-name').value.trim();
  const phone = document.getElementById('order-customer-phone').value.trim();
  const email = document.getElementById('order-customer-email').value.trim();
  const addr = document.getElementById('order-customer-addr').value.trim();
  const country = (document.getElementById('order-customer-country-input')?.value || document.getElementById('order-customer-country')?.value || '').trim();
  const ownerName = document.getElementById('order-owner-select')?.value || '';
  const remark = document.getElementById('order-remark').value.trim();
  if (!name || !phone || !addr) { showToast('请填写客户姓名、联系电话和收货地址', 'warning'); return; }
  const itemRows = document.querySelectorAll('#order-items-container > div');
  const items = [];
  for (let i = 0; i < itemRows.length; i++) {
    const row = itemRows[i];
    const hidden = row.querySelector('input[type="hidden"]');
    const inputs = row.querySelectorAll('input[type="number"]');
    const qty = parseInt(inputs[0]?.value) || 0;
    const price = parseFloat(inputs[1]?.value) || 0;
    if (hidden && hidden.value && qty > 0) { items.push({ product_id: hidden.value, quantity: qty, unit_price: price }); }
  }
  if (items.length === 0) { showToast('请至少添加一个产品', 'warning'); return; }
  if (!isEdit) {
    const dup = checkOrderDup(name, addr);
    if (dup && !confirm(`今天已有该客户的订单（${dup.order_no}），是否继续创建？`)) return;
  }
  const btn = document.getElementById('btn-save-order'); btn.disabled = true; btn.textContent = '保存中…';
  try {
    const orderDate = document.getElementById('order-date')?.value || '';
    const orderNo = isEdit ? null : await genOrderNo(orderDate);
    const status = isEdit ? document.getElementById('order-status').value : 'pending';
    const trackingNo = document.getElementById('order-tracking-no')?.value.trim() || null;
    const shippingFee = String(parseFloat(document.getElementById('order-shipping-fee')?.value) || 0);
    const paymentMethod = document.getElementById('order-payment-method')?.value || '';
    const handlingFee = parseFloat(document.getElementById('order-handling-fee')?.textContent?.replace(/[^0-9.]/g, '')) || 0;
    const productSummary = items.map(i => {
      const p = allProducts.find(x => x.id === i.product_id);
      return (p ? p.name : '未知产品') + '×' + i.quantity;
    }).join('，');
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);
    const totalAmt = items.reduce((s, i) => s + (i.unit_price || 0) * i.quantity, 0);
    // 结算货币相关
    const settlementCurrency = document.getElementById('order-settlement-currency')?.value || 'USD';
    const exchangeRate = _orderExchangeRate; // 1 结算货币 = ? USD
    const shippingUSD = (parseFloat(shippingFee) || 0) * exchangeRate;
    const handlingUSD = handlingFee * exchangeRate;
    // 总额 = 货物 + 运费，不含手续费（手续费从利润扣）
    const grandTotalUSD = totalAmt + shippingUSD;
    const totalCNY = grandTotalUSD * _orderUsdToCny;
    // 新增订单时生成 UUID
    const newOrderId = editingOrderId || crypto.randomUUID();
    const { data, error } = await sb.rpc('upsert_order', {
      p_id: newOrderId,
      p_order_no: orderNo,
      p_customer_name: name,
      p_customer_phone: phone,
      p_customer_address: addr,
      p_country: country || null,
      p_product_summary: productSummary,
      p_total_quantity: totalQty,
      p_total_amount: totalAmt,
      p_status: status,
      p_feishu_user_id: feishuUid,
      p_items: items,
      p_shipping_fee: shippingFee,
      p_payment_method: paymentMethod || null,
      p_handling_fee: handlingFee || 0,
      p_order_date: orderDate || null,
      p_remark: remark || '',
      p_tracking_no: trackingNo || null,
      p_settlement_currency: settlementCurrency,
      p_exchange_rate: exchangeRate,
      p_total_cny: parseFloat(totalCNY.toFixed(2))
    });
    if (error) throw error;
    closeModal('modal-order');
    await Promise.all([loadProducts(), loadOrders(), loadInventoryLogs()]);
    renderOrders(); renderInventory();
    showToast(isEdit ? '订单已更新' : '订单已创建', 'success');
  } catch (err) { showToast('保存失败:' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '保存订单'; }
}

async function deleteOrder(id) {
  if (!confirm('确认删除该订单？库存将自动回滚！')) return;
  try {
    const { error } = await sb.rpc('delete_order', { p_order_id: id, p_feishu_user_id: feishuUid });
    if (error) throw error;
    await Promise.all([loadProducts(), loadOrders(), loadInventoryLogs()]);
    renderOrders(); renderInventory();
    showToast('订单已删除，库存已回滚', 'success');
  } catch (err) { showToast('删除失败:' + err.message, 'error'); }
}

async function markDelivered(id) {
  if (!confirm('确认标记为"已送达"？')) return;
  try {
    const o = allOrders.find(x => x.id === id);
    if (!o) throw new Error('订单不存在');
    const { error } = await sb.rpc('upsert_order', {
      p_id: id,
      p_order_no: o.order_no,
      p_customer_name: o.customer_name || '',
      p_customer_phone: o.customer_phone || '',
      p_customer_address: o.customer_address || o.address || '',
      p_country: o.country || '',
      p_product_summary: o.product_summary || '',
      p_total_quantity: o.total_quantity || 0,
      p_total_amount: o.total_amount || 0,
      p_status: 'completed',
      p_feishu_user_id: o.feishu_user_id || feishuUid,
      p_items: o.items || [],
      p_shipping_fee: String(o.shipping_fee || 0),
      p_payment_method: o.payment_method || null,
      p_handling_fee: o.handling_fee || 0,
      p_order_date: o.order_date || null,
      p_remark: o.remark || '',
      p_settlement_currency: o.settlement_currency || 'USD',
      p_exchange_rate: o.exchange_rate || 1,
      p_total_cny: o.total_cny || 0
    });
    if (error) throw error;
    o.status = 'completed';
    renderOrders();
    showToast('已标记为已送达', 'success');
  } catch (e) { showToast('操作失败：' + e.message, 'error'); }
}

// ============ 批量上传订单 ============
function openBatchOrderModal() { openModal('modal-batch-order'); }
async function handleBatchOrderPaste() {
  const text = document.getElementById('batch-order-paste').value.trim();
  if (!text) { showToast('请先粘贴文本', 'warning'); return; }
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const previewBody = document.getElementById('batch-order-body');
  const previewHead = document.getElementById('batch-order-head');
  const previewDiv = document.getElementById('batch-order-preview');
  const errorsDiv = document.getElementById('batch-order-errors');
  const headers = ['客户姓名', '联系电话', '收货地址', '产品名称', '规格', '数量', '单价', '备注'];
  previewHead.innerHTML = '<tr>' + headers.map(h => `<th class="px-2 py-1 text-left bg-gray-50">${h}</th>`).join('') + '</tr>';
  const results = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(/[,\uff0c]/).map(c => c.trim());
    if (cols.length < 4) { errors.push(`第${i + 1}行：格式错误，至少需要4列`); continue; }
    const pName = cols[3] || '';
    const pSpec = (cols.length >= 5 ? cols[4] : '');
    const qtyIdx = cols.length >= 6 ? 5 : 4;
    const priceIdx = cols.length >= 7 ? 6 : (cols.length >= 6 ? 5 : -1);
    const remarkIdx = cols.length >= 8 ? 7 : (cols.length >= 7 ? 6 : (cols.length >= 6 ? 5 : -1));
    // 模糊匹配产品
    const match = fuzzyFindProduct(pName, pSpec);
    if (!match) { errors.push(`第${i + 1}行：产品"${pName}"${pSpec ? '/' + pSpec : ''}未找到`); continue; }
    if (match.method === 'multiple') {
      const names = match.product.map(x => x.name + (x.sku ? '(' + x.sku + ')' : '')).join('、');
      errors.push(`第${i + 1}行：匹配到多个产品（${names}），请更精确地指定名称或规格`); continue;
    }
    const product = match.product;
    const quantity = parseInt(cols[qtyIdx]) || 1;
    const unitPrice = priceIdx >= 0 ? (parseFloat(cols[priceIdx]) || 0) : 0;
    const remark = remarkIdx >= 0 ? cols[remarkIdx] : '';
    results.push({ customer_name: cols[0], customer_phone: cols[1] || '', customer_address: cols[2] || '', product_name: product.name, product_sku: product.sku || '', product_id: product.id, quantity, unit_price: unitPrice, remark: (match.method === '模糊匹配' ? '[模糊]' : '') + (remark || '') });
  }
  if (results.length > 0) {
    previewBody.innerHTML = results.slice(0, 5).map(r => {
      const vals = [r.customer_name, r.customer_phone, r.customer_address, r.product_name, r.product_sku, r.quantity, r.unit_price, r.remark];
      return `<tr class="border-b border-gray-50">${headers.map((_, i) => `<td class="px-2 py-1">${esc(vals[i] !== undefined ? vals[i] : '')}</td>`).join('')}</tr>`;
    }).join('');
    previewDiv.classList.remove('hidden');
  }
  document.getElementById('batch-order-count').textContent = `解析到 ${results.length} 条，共 ${lines.length} 行`;
  if (errors.length > 0) { errorsDiv.textContent = errors.slice(0, 5).join('；'); if (errors.length > 5) errorsDiv.textContent += '…等' + errors.length + '个错误'; errorsDiv.classList.remove('hidden'); }
  else { errorsDiv.textContent = ''; errorsDiv.classList.add('hidden'); }
  if (results.length > 0 && confirm(`确认导入 ${results.length} 条订单？`)) { await batchImportOrders(results); }
}

async function batchImportOrders(results) {
  let success = 0, fail = 0;
  for (const r of results) {
    try {
      const dup = allOrders.find(o => o.customer_name === r.customer_name && o.customer_address === r.customer_address && (o.created_at || '').startsWith(new Date().toISOString().slice(0, 10)));
      if (dup) { fail++; continue; }
      const orderNo = await genOrderNo();
      const items = [{ product_id: r.product_id, quantity: r.quantity, unit_price: r.unit_price || 0 }];
      const productSummary = (allProducts.find(x => x.id === r.product_id)?.name || '未知产品') + '×' + r.quantity;
      const { data, error } = await sb.rpc('upsert_order', {
        p_id: null,
        p_order_no: orderNo,
        p_customer_name: r.customer_name,
        p_customer_phone: r.customer_phone || '',
        p_customer_address: r.customer_address || '',
        p_country: null,
        p_product_summary: productSummary,
        p_total_quantity: r.quantity,
        p_total_amount: r.quantity * (r.unit_price || 0),
        p_status: 'pending',
        p_feishu_user_id: feishuUid,
        p_items: items,
        p_shipping_fee: '0',
        p_payment_method: null,
        p_handling_fee: 0,
        p_order_date: null,
        p_remark: r.remark || '',
        p_tracking_no: null,
        p_settlement_currency: 'USD',
        p_exchange_rate: 1,
        p_total_cny: 0
      });
      if (error) throw error;
      success++;
    } catch (e) { fail++; console.error(e); }
  }
  closeModal('modal-batch-order');
  await Promise.all([loadProducts(), loadOrders(), loadInventoryLogs()]);
  renderOrders(); renderInventory();
  showToast(`导入完成：成功 ${success} 条` + (fail > 0 ? `，失败 ${fail} 条` : ''), success > 0 ? 'success' : 'error');
}

// ============ 导出订单（CSV/TXT/复制）===========
function exportOrders(format) {
  const statusFilter = document.getElementById('order-status-dropdown')?.dataset?.value || '';
  let orders = allOrders;
  if (statusFilter) orders = orders.filter(o => o.status === statusFilter);
  if (orders.length === 0) { showToast('暂无订单可导出', 'warning'); return; }
  const headers = ['订单号', '客户姓名', '联系电话', '国家', '收货地址', '产品明细', '总金额', '状态', '创建时间'];
  const rows = orders.map(o => {
    const items = allOrderItems.filter(i => i.order_id === o.id);
    const detail = items.map(i => { const p = allProducts.find(x => x.id === i.product_id); const spec = p && p.sku ? ' ' + p.sku : ''; return (p ? p.name + spec : '') + '×' + i.quantity; }).join('; ');
    const total = items.reduce((s, i) => s + (i.unit_price || 0) * i.quantity, 0);
    return [o.order_no, o.customer_name, o.customer_phone || '', o.country || '', o.customer_address || '', detail, total.toFixed(2), statusText(o.status), (o.created_at || '').slice(0, 10)];
  });

  if (format === 'copy') {
    const text = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('已复制 ' + orders.length + ' 条订单到剪贴板', 'success')).catch(() => showToast('复制失败，请重试', 'error'));
    return;
  }

  if (format === 'txt') {
    const text = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, '订单导出_' + new Date().toISOString().slice(0, 10) + '.txt');
    showToast('已导出 ' + orders.length + ' 条订单', 'success');
    return;
  }

  // CSV
  const BOM = '\uFEFF';
  const csv = [headers.join(','), ...rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(','))].join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, '订单导出_' + new Date().toISOString().slice(0, 10) + '.csv');
  showToast('已导出 ' + orders.length + ' 条订单', 'success');
}

// ============ 变动日志 ============
function renderLogs() {
  // 仅 super_admin 可见"清除日志"按钮
  const btnClear = document.getElementById('btn-clear-logs');
  if (btnClear) btnClear.classList.toggle('hidden', currentRole !== 'super_admin');

  const list = document.getElementById('logs-list');
  if (allInventoryLogs.length === 0) { list.innerHTML = '<p class="text-sm text-gray-400">暂无日志记录</p>'; return; }
  list.innerHTML = allInventoryLogs.map(l => {
    const p = allProducts.find(x => x.id === l.product_id);
    const typeText = { order_out: '订单出库', restock: '补货入库', adjust: '库存调整', return: '退货入库' };
    return `<div class="flex items-start gap-3 p-3 bg-white rounded-lg border border-gray-100"><div class="flex-1"><p class="text-sm font-medium">${esc(p ? p.name : '已删除产品')}</p><p class="text-xs text-gray-400">${typeText[l.change_type] || l.change_type} ${l.quantity > 0 ? '+' + l.quantity : l.quantity} ${p ? p.unit || '个' : ''}</p>${l.remark ? `<p class="text-xs text-gray-400 mt-0.5">${esc(l.remark)}</p>` : ''}</div><div class="text-right"><p class="text-xs text-gray-400">${esc(l.creator_name || '')}</p><p class="text-xs text-gray-400">${(l.created_at || '').slice(0, 16).replace('T', ' ')}</p></div></div>`;
  }).join('');
}

async function clearInventoryLogs() {
  if (!confirm('确认清除所有测试日志？此操作不可恢复！')) return;
  try {
    const { error } = await sb.rpc('clear_inventory_logs');
    if (error) throw error;
    allInventoryLogs = [];
    renderLogs();
    showToast('日志已清除', 'success');
  } catch (e) {
    console.error('clearInventoryLogs error:', e);
    showToast('清除失败：' + e.message, 'error');
  }
}

// ============ 用户管理（超管）===========
function renderUsers() {
  const list = document.getElementById('users-list');
  if (allProfiles.length === 0) { list.innerHTML = '<p class="text-sm text-gray-400">暂无用户数据</p>'; return; }
  list.innerHTML = allProfiles.map(u => {
    const roleText = { super_admin: '<span class="text-red-600 font-medium">超级管理员</span>', admin: '<span class="text-blue-600">管理员</span>', employee: '<span class="text-gray-500">员工</span>' };
    const isSelf = u.id === currentUser?.id;
    const isAli = u.feishu_user_id === '592631' || u.feishu_user_id === 'ALI_592631' || u.feishu_user_id === 'ou_dc1cda75f061ec9e607c2b78bd68f0f1';
    // 超管不能改自己的角色；ALI(592631)锁定为超管不可改；其他人最大只能设为 admin
    let roleSelector;
    if (isSelf || isAli) {
      roleSelector = '';
    } else {
      roleSelector = `<select onchange="changeUserRole('${u.id}',this.value)" class="ml-2 text-xs border border-gray-200 rounded px-1 py-0.5"><option value="employee" ${u.role === 'employee' ? 'selected' : ''}>员工</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option></select>`;
    }
    return `<div class="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-100"><div class="flex items-center gap-3"><div class="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">${(u.name || '?')[0]}</div><div><p class="text-sm font-medium">${esc(u.name)}</p><p class="text-xs text-gray-400">${esc(u.feishu_user_id)}</p></div></div><div class="flex items-center">${roleText[u.role] || u.role || ''}${roleSelector}</div></div>`;
  }).join('');
}

async function changeUserRole(userId, newRole) {
  if (!confirm('确认修改该用户角色？')) return;
  try {
    const target = allProfiles.find(u => u.id === userId);
    if (!target) throw new Error('用户不存在');
    const { error } = await sb.rpc('change_user_role', { p_target_feishu_id: target.feishu_user_id, p_new_role: newRole, p_operator_feishu_id: feishuUid });
    if (error) throw error;
    await loadProfiles(); renderUsers();
    showToast('角色已更新', 'success');
  } catch (err) { showToast('修改失败:' + err.message, 'error'); }
}


// ============ 批量导入产品 ============
function openBatchProductModal() {
  document.getElementById('batch-product-paste').value = '';
  document.getElementById('batch-product-review').classList.add('hidden');
  document.getElementById('batch-product-errors').textContent = '';
  openModal('modal-batch-product');
}

async function handleBatchProductPaste() {
  const text = document.getElementById('batch-product-paste').value.trim();
  if (!text) { showToast('请先粘贴文本', 'warning'); return; }
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const headerSet = new Set(['产品名称', '简称', '规格', '库存数量', '预警阈值', '单位', '产品', '规格', '简称', '库存', '预警', '单位']);
  const errors = [];
  const products = [];
  lines.forEach((line, idx) => {
    const parts = line.split(',').map(s => s.trim());
    // 自动剔除表头行
    if (headerSet.has(parts[0])) return;
    if (!parts[0]) { errors.push('第' + (idx+1) + '行：产品名称不能为空'); return; }
    products.push({
      name: parts[0],
      short_name: parts[1] || '',
      sku: parts[2] || '',
      stock: parseInt(parts[3]) || 0,
      alert: parseInt(parts[4]) || 10,
      unit: parts[5] || '个'
    });
  });

  // 去重合并：名称+简称+规格+单位完全一致才合并，库存累加
  const merged = {};
  const deduped = [];
  products.forEach(p => {
    const key = (p.name || '') + '\x00' + (p.short_name || '') + '\x00' + (p.sku || '') + '\x00' + (p.unit || '');
    if (merged[key]) {
      merged[key].stock += p.stock;
    } else {
      merged[key] = { ...p };
      deduped.push(merged[key]);
    }
  });
  if (products.length !== deduped.length) {
    showToast('已自动合并 ' + (products.length - deduped.length) + ' 条重复产品', 'warning');
  }
  products.length = 0;
  products.push(...deduped);

  // 检测与数据库已有记录匹配（名称+简称+规格+单位完全一致），并提示
  const conflicts = products.filter(p => {
    return allProducts.find(x =>
      (x.name || '') === p.name &&
      (x.short_name || '') === p.short_name &&
      (x.sku || '') === p.sku &&
      (x.unit || '个') === p.unit
    );
  });
  if (conflicts.length > 0) {
    const names = conflicts.map(p => p.name + (p.sku ? '(' + p.sku + ')' : '')).join('、');
    errors.push('以下产品与已有记录完全匹配，将累加库存：' + names);
  }

  // 显示预览
  const head = document.getElementById('batch-product-head');
  const body = document.getElementById('batch-product-body');
  head.innerHTML = '<tr>' + ['产品名称','简称','规格','库存','预警阈值','单位'].map(h => '<th class="px-2 py-1 text-left">' + h + '</th>').join('') + '</tr>';
  body.innerHTML = products.map(p => '<tr class="border-b border-gray-100">' +
    [p.name, p.short_name, p.sku, p.stock, p.alert, p.unit].map(v => '<td class="px-2 py-1">' + esc(v) + '</td>').join('') + '</tr>').join('');
  document.getElementById('batch-product-count').textContent = '共 ' + products.length + ' 条，点击"确认导入"写入数据库';
  document.getElementById('batch-product-errors').textContent = errors.length ? errors.join('; ') : '';
  document.getElementById('batch-product-review').classList.remove('hidden');

  // 确认导入按钮
  const btnArea = document.getElementById('batch-product-review');
  let confirmBtn = document.getElementById('btn-confirm-batch-product');
  if (!confirmBtn) {
    confirmBtn = document.createElement('button');
    confirmBtn.id = 'btn-confirm-batch-product';
    confirmBtn.className = 'btn-touch mt-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium';
    btnArea.appendChild(confirmBtn);
  }
  confirmBtn.onclick = () => saveBatchProducts(products);
  confirmBtn.textContent = '确认导入 ' + products.length + ' 条';
}

async function saveBatchProducts(products) {
  const btn = document.getElementById('btn-confirm-batch-product');
  btn.disabled = true; btn.textContent = '导入中…';
  let ok = 0, fail = 0;
  for (const p of products) {
    try {
      // 按 名称+简称+规格+单位 复合键查找已有产品
      const existing = allProducts.find(x =>
        (x.name || '') === p.name &&
        (x.short_name || '') === p.short_name &&
        (x.sku || '') === p.sku &&
        (x.unit || '个') === p.unit
      );
      if (existing) {
        // 已有产品：不改库存（保持原值），库存变动通过 adjust_inventory 写日志
        const { error } = await sb.rpc('upsert_product', {
          p_id: existing.id,
          p_name: p.name,
          p_short_name: p.short_name || null,
          p_sku: p.sku || null,
          p_stock: existing.current_stock || 0,
          p_alert: p.alert || existing.min_stock_alert || 10,
          p_unit: p.unit || existing.unit || '个',
          p_feishu_user_id: feishuUid
        });
        if (error) throw error;
        // 库存有变动时写日志+调库存
        if (p.stock !== 0) {
          const changeType = p.stock > 0 ? 'restock' : 'adjust';
          const { error: logErr } = await sb.rpc('adjust_inventory', {
            p_product_id: existing.id,
            p_change_type: changeType,
            p_quantity: Math.abs(p.stock),
            p_remark: '批量导入累加库存',
            p_feishu_user_id: feishuUid
          });
          if (logErr) console.warn('写日志失败:', logErr.message);
        }
      } else {
        // 新产品：直接 upsert 写入初始库存（无变动，不写日志）
        const { error } = await sb.rpc('upsert_product', {
          p_id: null,
          p_name: p.name,
          p_short_name: p.short_name || null,
          p_sku: p.sku || null,
          p_stock: p.stock,
          p_alert: p.alert || 10,
          p_unit: p.unit || '个',
          p_feishu_user_id: feishuUid
        });
        if (error) throw error;
      }
      ok++;
    } catch (e) { fail++; console.warn('批量导入失败:', p.name, e.message); }
  }
  btn.disabled = false;
  closeModal('modal-batch-product');
  await Promise.all([loadProducts(), loadInventoryLogs()]);
  renderInventory();
  let msg = '导入完成：成功 ' + ok + ' 条';
  if (fail) msg += '，失败 ' + fail + ' 条';
  showToast(msg, fail ? 'warning' : 'success');
}

// ============ 补货 ============
function openRestockModal(productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  document.getElementById('restock-product-id').value = productId;
  document.getElementById('restock-product-name').textContent = p.name + (p.sku ? '（' + p.sku + '）' : '');
  document.getElementById('restock-current-stock').textContent = p.current_stock + ' ' + (p.unit || '个');
  document.getElementById('restock-qty').value = '';
  openModal('modal-restock');
}

async function submitRestock() {
  const productId = document.getElementById('restock-product-id').value;
  const qty = parseInt(document.getElementById('restock-qty').value);
  if (!qty || qty <= 0) { showToast('请输入有效的补货数量', 'warning'); return; }
  const btn = document.getElementById('btn-restock');
  btn.disabled = true; btn.textContent = '提交中…';
  try {
    const p = allProducts.find(x => x.id === productId);
    if (!p) throw new Error('产品不存在');
    // 1. 先调 adjust_inventory：调库存 + 写日志
    const { error: logErr } = await sb.rpc('adjust_inventory', {
      p_product_id: productId,
      p_change_type: 'restock',
      p_quantity: qty,
      p_remark: '单独补货',
      p_feishu_user_id: feishuUid
      // p_skip_stock 默认 false，会更新库存
    });
    if (logErr) throw logErr;
    // 2. 再调 upsert_product 更新产品其他信息，p_stock 传 null 避免覆盖库存
    const { error } = await sb.rpc('upsert_product', {
      p_id: productId,
      p_name: p.name,
      p_short_name: p.short_name || null,
      p_sku: p.sku || null,
      p_stock: null,
      p_alert: p.min_stock_alert || 10,
      p_unit: p.unit || '个',
      p_feishu_user_id: feishuUid
    });
    if (error) throw error;
    closeModal('modal-restock');
    await Promise.all([loadProducts(), loadInventoryLogs()]);
    renderInventory();
    showToast('补货成功，新库存：' + ((p.current_stock || 0) + qty), 'success');
  } catch (err) { showToast('补货失败：' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '确认补货'; }
}

// ============ 批量调整库存（多选模式） ============
let batchStockMode = 'increase';

function toggleInvSelectAll(el) {
  document.querySelectorAll('.inv-chk').forEach(c => { c.checked = el.checked; });
  updateBatchStockBtn();
}

function getSelectedProductIds() {
  return [...document.querySelectorAll('.inv-chk:checked')].map(c => c.value);
}

function updateBatchStockBtn() {
  const btn = document.getElementById('batch-stock-btn');
  if (!btn) return;
  const count = getSelectedProductIds().length;
  btn.textContent = count > 0 ? `批量调整 (${count})` : '批量调整';
  btn.classList.toggle('bg-green-600', count > 0);
  btn.classList.toggle('hover:bg-green-700', count > 0);
  btn.classList.toggle('bg-gray-600', count === 0);
  btn.classList.toggle('hover:bg-gray-700', count === 0);
}

function setBatchStockMode(mode) {
  batchStockMode = mode;
  const incBtn = document.getElementById('bs-mode-inc');
  const decBtn = document.getElementById('bs-mode-dec');
  const qtyInput = document.getElementById('batch-stock-qty');
  const label = document.getElementById('bs-qty-label');
  if (mode === 'increase') {
    incBtn.className = 'flex-1 btn-touch py-2 rounded-lg border-2 border-green-500 bg-green-50 text-green-700 text-sm font-medium';
    decBtn.className = 'flex-1 btn-touch py-2 rounded-lg border-2 border-gray-200 text-gray-500 text-sm font-medium';
    label.textContent = '增加数量';
  } else {
    incBtn.className = 'flex-1 btn-touch py-2 rounded-lg border-2 border-gray-200 text-gray-500 text-sm font-medium';
    decBtn.className = 'flex-1 btn-touch py-2 rounded-lg border-2 border-red-500 bg-red-50 text-red-700 text-sm font-medium';
    label.textContent = '减少数量';
  }
  qtyInput.value = 1;
  renderBatchStockPreview();
}

function openBatchStockModal() {
  const ids = getSelectedProductIds();
  if (ids.length === 0) { showToast('请先勾选要调整的产品', 'warning'); return; }
  const products = ids.map(id => allProducts.find(p => p.id === id)).filter(Boolean);
  document.getElementById('batch-stock-selected-info').textContent = `已选择 ${products.length} 个产品`;
  batchStockMode = 'increase';
  setBatchStockMode('increase');
  document.getElementById('batch-stock-qty').value = 1;
  window._batchStockProducts = products;
  renderBatchStockPreview();
  openModal('modal-batch-stock');
}

function renderBatchStockPreview() {
  const products = window._batchStockProducts || [];
  const qty = parseInt(document.getElementById('batch-stock-qty').value) || 0;
  if (products.length === 0 || qty <= 0) {
    document.getElementById('batch-stock-preview').classList.add('hidden');
    return;
  }
  const head = document.getElementById('batch-stock-head');
  const body = document.getElementById('batch-stock-body');
  head.innerHTML = '<tr>' + ['产品名称', '规格', '单位', '当前库存', '调整数量', '调整后库存'].map(h => '<th class="px-2 py-1 text-left bg-gray-50">' + h + '</th>').join('') + '</tr>';
  body.innerHTML = products.map(p => {
    const actualQty = batchStockMode === 'increase' ? qty : -qty;
    const newStock = (p.current_stock || 0) + actualQty;
    const qtyClass = actualQty > 0 ? 'text-green-600' : 'text-red-600';
    const qtyText = actualQty > 0 ? '+' + actualQty : '' + actualQty;
    const newStockClass = newStock < 0 ? 'text-red-600' : (newStock <= p.min_stock_alert ? 'text-orange-600' : 'text-green-600');
    return '<tr class="border-b border-gray-100">' +
      '<td class="px-2 py-1 font-medium">' + esc(p.name) + '</td>' +
      '<td class="px-2 py-1">' + esc(p.sku || '-') + '</td>' +
      '<td class="px-2 py-1">' + esc(p.unit || '个') + '</td>' +
      '<td class="px-2 py-1">' + (p.current_stock || 0) + '</td>' +
      '<td class="px-2 py-1 font-bold ' + qtyClass + '">' + qtyText + '</td>' +
      '<td class="px-2 py-1 font-bold ' + newStockClass + '">' + newStock + '</td>' +
      '</tr>';
  }).join('');
  document.getElementById('batch-stock-count').textContent = '共 ' + products.length + ' 个产品';
  document.getElementById('batch-stock-preview').classList.remove('hidden');
}

async function saveBatchStock() {
  const products = window._batchStockProducts || [];
  const qty = parseInt(document.getElementById('batch-stock-qty').value) || 0;
  if (qty <= 0) { showToast('请输入有效的调整数量', 'warning'); return; }
  const actualQty = batchStockMode === 'increase' ? qty : -qty;
  const btn = document.getElementById('btn-confirm-batch-stock');
  btn.disabled = true; btn.textContent = '调整中…';
  let ok = 0, fail = 0;
  for (const p of products) {
    try {
      const newStock = (p.current_stock || 0) + actualQty;
      const changeType = actualQty > 0 ? 'restock' : 'adjust';
      const remark = actualQty > 0 ? '批量补货' : '批量减库存';
      const { error } = await sb.rpc('adjust_inventory', {
        p_product_id: p.id,
        p_change_type: changeType,
        p_quantity: Math.abs(actualQty),
        p_remark: remark,
        p_feishu_user_id: feishuUid
      });
      if (error) throw error;
      ok++;
    } catch (e) { fail++; console.error('批量调整失败:', p.name, e.message); showToast(p.name + ' 调整失败:' + e.message, 'error'); }
  }
  closeModal('modal-batch-stock');
  document.querySelectorAll('.inv-chk:checked').forEach(c => { c.checked = false; });
  const selAll = document.getElementById('inv-select-all');
  if (selAll) selAll.checked = false;
  await Promise.all([loadProducts(), loadInventoryLogs()]);
  renderInventory();
  let msg = '调整完成：成功 ' + ok + ' 条';
  if (fail) msg += '，失败 ' + fail + ' 条';
  showToast(msg, fail ? 'warning' : 'success');
  btn.disabled = false; btn.textContent = '确认调整';
}

// ============ 报价助手 ============
const QUOTE_PRODUCTS = [
  { name:'Retatrutide', code:'RT5', spec:'5mg*10vials', price:34 },
  { name:'Retatrutide', code:'RT10', spec:'10mg*10vials', price:57 },
  { name:'Retatrutide', code:'RT15', spec:'15mg*10vials', price:80 },
  { name:'Retatrutide', code:'RT20', spec:'20mg*10vials', price:100 },
  { name:'Retatrutide', code:'RT30', spec:'30mg*10vials', price:133 },
  { name:'Retatrutide', code:'RT40', spec:'40mg*10vials', price:180 },
  { name:'Retatrutide', code:'RT50', spec:'50mg*10vials', price:225 },
  { name:'Retatrutide', code:'RT60', spec:'60mg*10vials', price:270 },
  { name:'Tirzepatide', code:'TR5', spec:'5mg*10vials', price:25 },
  { name:'Tirzepatide', code:'TR10', spec:'10mg*10vials', price:41 },
  { name:'Tirzepatide', code:'TR15', spec:'15mg*10vials', price:53 },
  { name:'Tirzepatide', code:'TR20', spec:'20mg*10vials', price:68 },
  { name:'Tirzepatide', code:'TR30', spec:'30mg*10vials', price:88 },
  { name:'Tirzepatide', code:'TR40', spec:'40mg*10vials', price:105 },
  { name:'Tirzepatide', code:'TR50', spec:'50mg*10vials', price:135 },
  { name:'Tirzepatide', code:'TR60', spec:'60mg*10vials', price:155 },
  { name:'Semaglutide', code:'SM5', spec:'5mg*10vials', price:25 },
  { name:'Semaglutide', code:'SM10', spec:'10mg*10vials', price:41 },
  { name:'Semaglutide', code:'SM15', spec:'15mg*10vials', price:53 },
  { name:'Semaglutide', code:'SM20', spec:'20mg*10vials', price:68 },
  { name:'Semaglutide', code:'SM30', spec:'30mg*10vials', price:88 },
  { name:'Cagrilintide', code:'CGL5', spec:'5mg*10vials', price:56 },
  { name:'Cagrilintide', code:'CGL10', spec:'10mg*10vials', price:89 },
  { name:'Mazdutide', code:'MDT10', spec:'10mg*10vials', price:139 },
  { name:'5-Amino-1MQ', code:'5AM', spec:'5mg*10vials', price:68 },
  { name:'5-Amino-1MQ', code:'10AM', spec:'10mg*10vials', price:100 },
  { name:'5-Amino-1MQ', code:'50AM', spec:'50mg*10vials', price:230 },
  { name:'SLU-PP-322', code:'322', spec:'5mg*10vials', price:94 },
  { name:'Adipotide', code:'AP5', spec:'5mg*10vials', price:158 },
  { name:'GHK-CU', code:'CU50', spec:'50mg*10vials', price:19 },
  { name:'GHK-CU', code:'CU100', spec:'100mg*10vials', price:27 },
  { name:'GHK-CU', code:'AHK-CU50', spec:'50mg*10vials', price:22 },
  { name:'GHK-CU', code:'AHK-CU100', spec:'100mg*10vials', price:30 },
  { name:'SNAP-8', code:'NP810', spec:'10mg*10vials', price:58 },
  { name:'Melanotan I', code:'MT1', spec:'10mg*10vials', price:60 },
  { name:'Melanotan II', code:'MT2', spec:'10mg*10vials', price:62 },
  { name:'Glutathione', code:'GTT1500', spec:'1500mg*10vials', price:71 },
  { name:'LL37', code:'LL37', spec:'5mg*10vials', price:123 },
  { name:'Selank', code:'SK5', spec:'5mg*10vials', price:38 },
  { name:'Selank', code:'SK10', spec:'10mg*10vials', price:62 },
  { name:'Semax', code:'XA5', spec:'5mg*10vials', price:38 },
  { name:'Semax', code:'XA10', spec:'10mg*10vials', price:65 },
  { name:'DSIP', code:'DS5', spec:'5mg*10vials', price:53 },
  { name:'DSIP', code:'DS10', spec:'10mg*10vials', price:92 },
  { name:'DSIP', code:'DS15', spec:'15mg*10vials', price:108 },
  { name:'VIP', code:'VIP5', spec:'5mg*10vials', price:79 },
  { name:'VIP', code:'VIP10', spec:'10mg*10vials', price:135 },
  { name:'Oxytocin', code:'OT2', spec:'2mg*10vials', price:75 },
  { name:'Oxytocin', code:'OT5', spec:'5mg*10vials', price:103 },
  { name:'Oxytocin', code:'OT10', spec:'10mg*10vials', price:286 },
  { name:'NAD+', code:'NJ100', spec:'100mg*10vials', price:24 },
  { name:'NAD+', code:'NJ500', spec:'500mg*10vials', price:45 },
  { name:'NAD+', code:'NJ1000', spec:'1000mg*10vials', price:74 },
  { name:'Thymosin Alpha-1', code:'TA5', spec:'5mg*10vials', price:112 },
  { name:'Thymosin Alpha-1', code:'TA10', spec:'10mg*10vials', price:191 },
  { name:'SS31', code:'2S10', spec:'10mg*10vials', price:90 },
  { name:'SS31', code:'2S50', spec:'50mg*10vials', price:280 },
  { name:'Thymalin', code:'TY10', spec:'10mg*10vials', price:99 },
  { name:'Thymalin', code:'TY20', spec:'20mg*10vials', price:188 },
  { name:'BPC157', code:'BC5', spec:'5mg*10vials', price:33 },
  { name:'BPC157', code:'BC10', spec:'10mg*10vials', price:48 },
  { name:'Ipamorelin', code:'IP2', spec:'2mg*10vials', price:28 },
  { name:'Ipamorelin', code:'IP5', spec:'5mg*10vials', price:40 },
  { name:'Ipamorelin', code:'IP10', spec:'10mg*10vials', price:68 },
  { name:'TB500', code:'TB2', spec:'2mg*10vials', price:42 },
  { name:'TB500', code:'TB5', spec:'5mg*10vials', price:75 },
  { name:'TB500', code:'TB10', spec:'10mg*10vials', price:115 },
  { name:'Tesamorelin', code:'TSM5', spec:'5mg*10vials', price:95 },
  { name:'Tesamorelin', code:'TSM10', spec:'10mg*10vials', price:168 },
  { name:'Sermorelin', code:'SMO5', spec:'5mg*10vials', price:68 },
  { name:'Sermorelin', code:'SMO10', spec:'10mg*10vials', price:122 },
  { name:'Gonadorelin', code:'GND2', spec:'2mg*10vials', price:78 },
  { name:'Hexarelin', code:'HX5', spec:'5mg*10vials', price:110 },
  { name:'GHRP-2', code:'G25', spec:'5mg*10vials', price:60 },
  { name:'GHRP-6', code:'G65', spec:'5mg*10vials', price:60 },
  { name:'CJC1295 without DAC', code:'CND5', spec:'5mg*10vials', price:80 },
  { name:'CJC1295 without DAC', code:'CND10', spec:'10mg*10vials', price:130 },
  { name:'CJC1295 with DAC', code:'CD5', spec:'5mg*10vials', price:135 },
  { name:'CJC1295 with DAC', code:'CD10', spec:'10mg*10vials', price:180 },
  { name:'HGH 191AA', code:'H10', spec:'10iu*10vials', price:65 },
  { name:'HGH 191AA', code:'H12', spec:'12iu*10vials', price:76 },
  { name:'HGH 191AA', code:'H24', spec:'24iu*10vials', price:120 },
  { name:'HGH 191AA', code:'H36', spec:'36iu*10vials', price:162 },
  { name:'AOD9604', code:'5AD', spec:'5mg*10vials', price:96 },
  { name:'AOD9604', code:'AD10', spec:'10mg*10vials', price:168 },
  { name:'IGF-1LR3', code:'IGF-01', spec:'0.1mg*10vials', price:35 },
  { name:'IGF-1LR3', code:'IGF-1', spec:'1mg*10vials', price:147 },
  { name:'HCG', code:'HCG5000', spec:'5000iu*10vials', price:92 },
  { name:'HCG', code:'HCG10000', spec:'10000iu*10vials', price:150 },
  { name:'KPV', code:'KP5', spec:'5mg*10vials', price:50 },
  { name:'KPV', code:'KP10', spec:'10mg*10vials', price:88 },
  { name:'PT-141', code:'P41', spec:'10mg*10vials', price:63 },
  { name:'Epithalon', code:'EPI10', spec:'10mg*10vials', price:53 },
  { name:'Epithalon', code:'EPI50', spec:'50mg*10vials', price:173 },
  { name:'Pinealon', code:'PN10', spec:'10mg*10vials', price:98 },
  { name:'Bronchogen', code:'BR20', spec:'20mg*10vials', price:126 },
  { name:'Cardiogen', code:'CRG20', spec:'20mg*10vials', price:136 },
  { name:'ARA 290', code:'RA10', spec:'10mg*10vials', price:74 },
  { name:'KissPeptin-1', code:'KS5', spec:'5mg*10vials', price:53 },
  { name:'KissPeptin-10', code:'KS10', spec:'10mg*10vials', price:113 },
  { name:'MOTS-c', code:'MS10', spec:'10mg*10vials', price:62 },
  { name:'MOTS-c', code:'MS40', spec:'40mg*10vials', price:160 },
  { name:'BPC157+TB500 5mg+5mg', code:'BB10', spec:'10mg*10vials', price:86 },
  { name:'BPC157+TB500 10mg+10mg', code:'BB20', spec:'20mg*10vials', price:147 },
  { name:'BPC157+TB500+GHK+KPV', code:'KLOW80', spec:'80mg*10vials', price:210 },
  { name:'BPC157+TB500+GHK', code:'BBG70', spec:'70mg*10vials', price:165 },
  { name:'Cagrilintide+Semaglutide', code:'CS10', spec:'10mg*10vials', price:178 },
  { name:'Lipo-c', code:'LC216', spec:'10mg*10vials', price:108 },
  { name:'SUPER Human Blend', code:'SHB', spec:'10mg*10vials', price:98 },
  { name:'Healthy Hair Skin Nails', code:'HHB', spec:'10mg*10vials', price:98 },
  { name:'RelaxatlonPM', code:'RP226', spec:'10mg*10vials', price:98 },
  { name:'CJC1295 no DAC+IPA', code:'CP10', spec:'10mg*10vials', price:133 },
  { name:'Lemon Bottle', code:'LemonBottle', spec:'10ml*10vials', price:56 },
  { name:'BAC Water', code:'WA3', spec:'3ml*10vials', price:7 },
  { name:'BAC Water', code:'WA10', spec:'10ml*10vials', price:9 },
  { name:'Acetic Acid 0.6%', code:'AA', spec:'3ml*10vials', price:8 },
  { name:'L-carnitine 600mg', code:'LC600', spec:'10ml*10vials', price:26 },
  { name:'B-12', code:'B-12V', spec:'10mg*10vials', price:30 },
];

// 报价会话历史（用于导出报价单）
let quoteHistory = [];

// ============ 报价模糊匹配 ============
function quoteFuzzyFind(input) {
  const kw = normalizeStr(input);
  if (!kw) return [];
  // 1. 代码完全匹配（最高优先级）
  let hits = QUOTE_PRODUCTS.filter(p => normalizeStr(p.code) === kw);
  if (hits.length > 0) return hits;
  // 2. 名称/代码前缀匹配
  hits = QUOTE_PRODUCTS.filter(p => normalizeStr(p.name).startsWith(kw) || normalizeStr(p.code).startsWith(kw));
  if (hits.length > 0) return hits;
  // 3. 名称/代码包含匹配
  hits = QUOTE_PRODUCTS.filter(p => normalizeStr(p.name).includes(kw) || normalizeStr(p.code).includes(kw));
  if (hits.length > 0) return hits;
  // 4. 子序列模糊匹配
  const subHits = QUOTE_PRODUCTS.map(p => {
    const ns = normalizeStr(p.name);
    const cs = normalizeStr(p.code);
    const score = Math.max(fuzzySubseqScore(kw, ns), fuzzySubseqScore(kw, cs));
    return { product: p, score };
  }).filter(x => x.score > 0.3).sort((a, b) => b.score - a.score).map(x => x.product);
  if (subHits.length > 0) return subHits;
  // 5. 推荐相似产品（名称包含任意单词）
  const kwWords = kw.split(/[^a-z0-9]+/).filter(w => w.length >= 2);
  if (kwWords.length > 0) {
    const recs = QUOTE_PRODUCTS.map(p => {
      const ns = normalizeStr(p.name);
      let score = 0;
      kwWords.forEach(w => { if (ns.includes(w)) score++; });
      return { product: p, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.product);
    return recs;
  }
  return [];
}

// ============ 形近字母替换表 ============
const SHAPE_SIMILAR = [
  ['c','k'], ['s','z'], ['g','j'], ['d','t'], ['i','y']
];

// 对字符串尝试形近字母替换，最多3轮，返回所有变体
function shapeVariants(kw) {
  const result = new Set([kw]);
  let current = [kw];
  for (let r = 0; r < 3; r++) {
    const next = [];
    current.forEach(s => {
      SHAPE_SIMILAR.forEach(([a, b]) => {
        [a, b].forEach(ch => {
          if (s.includes(ch)) {
            const replaced = s.split(ch).join(ch === a ? b : a);
            if (!result.has(replaced)) {
              result.add(replaced);
              next.push(replaced);
            }
          }
        });
      });
    });
    if (next.length === 0) break;
    current = next;
  }
  return [...result];
}

// ============ 功能关键词联想映射 ============
const FUNCTION_KEYWORDS = {
  'fat loss':      ['5-Amino-1MQ', 'AOD9604', 'Lipo-c'],
  'weight loss':   ['5-Amino-1MQ', 'AOD9604', 'Lipo-c'],
  'skin':          ['GHK-CU', 'AHK-CU', 'Healthy Hair skin nails Blend'],
  'hair':          ['GHK-CU', 'AHK-CU', 'Healthy Hair skin nails Blend'],
  'nails':         ['GHK-CU', 'AHK-CU', 'Healthy Hair skin nails Blend'],
  'sleep':         ['DSIP', 'RelaxationPM', 'Selank'],
  'relax':         ['DSIP', 'RelaxationPM', 'Selank'],
  'muscle':        ['BPC157', 'TB500', 'Ipamorelin'],
  'recovery':      ['BPC157', 'TB500', 'Ipamorelin'],
  'anti-aging':   ['NAD+', 'SS31', 'MOTS-c', 'Epithalon'],
  'tan':           ['Melanotan I', 'Melanotan II'],
  'melanotan':    ['Melanotan I', 'Melanotan II'],
  'growth hormone':['HGH 191AA', 'Tesamorelin', 'Sermorelin'],
  'hgh':          ['HGH 191AA', 'Tesamorelin', 'Sermorelin'],
};




// ============ 同义词归一化 ============
// 在归一化前，把常见同义词替换成标准写法
function normalizeSynonyms(raw) {
  let s = raw;
  // without / no 等同
  s = s.replace(/\bno\b/gi, 'without');
  // with 去掉（CJC with DAC → CJC DAC，让 with/without 都统一到产品名不含 with 的版本去匹配）
  s = s.replace(/\bwith\b/gi, ' ');
  // 多个空格合并
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ============ 主匹配函数（8步严格顺序）============
function quoteFindByNameOrCode(input) {
  let raw = (input || '').toLowerCase();
  // 同义词归一化
  raw = normalizeSynonyms(raw);

  // ===== 第一步：归一化 =====
  const kw = normalizeStr(raw);
  if (!kw) return [];

  // 辅助：按名称查产品（返回该产品所有规格）
  function findFamily(name) {
    const n = normalizeStr(name);
    return QUOTE_PRODUCTS.filter(p => normalizeStr(p.name) === n);
  }

  let hits;

  // ===== 第二步：代码优先匹配 =====
  // 2a. 精确匹配
  hits = QUOTE_PRODUCTS.filter(p => normalizeStr(p.code) === kw);
  if (hits.length > 0) return hits;
  // 2b. 代码前缀匹配（如 RT → RT5/RT10/RT15...，返回该系列产品全部规格）
  if (kw.length >= 2) {
    hits = QUOTE_PRODUCTS.filter(p => normalizeStr(p.code).startsWith(kw));
    if (hits.length > 0) {
      // 同系列产品，直接返回全部
      return hits;
    }
  }

  // ===== 第三步：编辑距离匹配 =====
  // 阈值：输入≤3字符时为1，否则为2（避免短输入误匹配太多）
  const editThreshold = kw.length <= 3 ? 1 : 2;
  const editResults = QUOTE_PRODUCTS.map(p => {
    const ns = normalizeStr(p.name);
    const cs = normalizeStr(p.code);
    const d = Math.min(levenshteinDist(kw, ns), levenshteinDist(kw, cs));
    return { product: p, dist: d };
  }).filter(x => x.dist <= editThreshold).sort((a, b) => a.dist - b.dist);

  // 命中时按产品名分组，返回每个产品的全规格
  if (editResults.length > 0) {
    const top = editResults[0].dist; // 取最短距离
    const best = editResults.filter(x => x.dist === top);
    const familyNames = [...new Set(best.map(x => x.product.name))];
    if (familyNames.length === 1) {
      return findFamily(familyNames[0]); // 单产品 → 返回全规格
    }
    // 多产品 → 每个返回全规格
    const all = [];
    familyNames.forEach(n => all.push(...findFamily(n)));
    return all;
  }

  // ===== 第四步：前缀/缩写匹配 =====
  // 4a. 缩写直接映射
  const ABBR_DIRECT = {
    'cagri': 'Cagrilintide', 'mots': 'MOTS-c', 'bpc': 'BPC157',
    'tb': 'TB500', 'sema': 'Semaglutide', 'tirze': 'Tirzepatide',
    'reta': 'Retatrutide', 'ss': 'SS31', 'ghk': 'GHK-CU',
    'pt141': 'PT-141', 'pt': 'PT-141', 'ipa': 'Ipamorelin',
    'epi': 'Epithalon', 'sk': 'Selank', 'pn': 'Pinealon',
    'cr': 'Cardiogen',
    // 组合产品别名
    'klow': 'BPC157+TB500+GHK+KPV', 'bbg': 'BPC157+TB500+GHK',
    'lipoc': 'Lipo-c', 'shb': 'SUPER Human Blend',
    'lemon': 'Lemon Bottle', 'lemonbottle': 'Lemon Bottle',
    'bac': 'BAC Water',
  };
  if (ABBR_DIRECT[kw]) {
    const found = findFamily(ABBR_DIRECT[kw]);
    if (found.length > 0) return found;
  }
  // 4b. 前缀匹配（长度≥3）
  if (kw.length >= 3) {
    hits = QUOTE_PRODUCTS.filter(p => normalizeStr(p.name).startsWith(kw) || normalizeStr(p.code).startsWith(kw));
    if (hits.length > 0) return hits;
  }

  // ===== 第五步：形近字母替换（最多3轮） =====
  const variants = shapeVariants(kw);
  for (const v of variants) {
    if (v === kw) continue;
    // 精确匹配产品名或代码 → 返回全规格
    hits = QUOTE_PRODUCTS.filter(p => normalizeStr(p.name) === v || normalizeStr(p.code) === v);
    if (hits.length > 0) {
      const names = [...new Set(hits.map(p => p.name))];
      const all = [];
      names.forEach(n => all.push(...findFamily(n)));
      return all;
    }
    // 包含匹配 → 返回全规格
    hits = QUOTE_PRODUCTS.filter(p => {
      const pn = normalizeStr(p.name);
      const pc = normalizeStr(p.code);
      return pn.includes(v) || v.includes(pn) || pc.includes(v) || v.includes(pc);
    });
    if (hits.length > 0) {
      const names = [...new Set(hits.map(p => p.name))];
      const all = [];
      names.forEach(n => all.push(...findFamily(n)));
      return all;
    }
  }

  // ===== 第六步：数字+字母重组 =====
  const numPart = raw.match(/(\d+)/);
  const letterPart = raw.replace(/[^a-z]/g, '');
  if (numPart && letterPart.length >= 2) {
    const reassembled = letterPart + numPart[1];
    hits = QUOTE_PRODUCTS.filter(p => normalizeStr(p.code) === reassembled);
    if (hits.length > 0) return hits;
    const reassembled2 = numPart[1] + letterPart;
    hits = QUOTE_PRODUCTS.filter(p => normalizeStr(p.code) === reassembled2);
    if (hits.length > 0) return hits;
  }

  // ===== 第七步：功能关键词联想 =====
  for (const [kwText, productNames] of Object.entries(FUNCTION_KEYWORDS)) {
    if (raw.includes(kwText)) {
      const matched = [];
      productNames.forEach(n => {
        const found = findFamily(n);
        found.forEach(p => { if (!matched.includes(p)) matched.push(p); });
      });
      if (matched.length > 0) return matched.sort((a, b) => a.price - b.price).slice(0, 3);
    }
  }

  // ===== 第八步：兜底 =====
  return [];
}

// 兜底推荐：未找到匹配时，推荐名称类似或同功能的产品（1-3个）
function quoteFallbackRecommend(input) {
  const kw = normalizeStr(input);
  if (!kw) return [];
  // 按编辑距离推荐最相近的1-3个
  return QUOTE_PRODUCTS.map(p => ({
    product: p,
    dist: Math.min(levenshteinDist(kw, normalizeStr(p.name)), levenshteinDist(kw, normalizeStr(p.code)))
  })).sort((a, b) => a.dist - b.dist).slice(0, 3).map(x => x.product);
}

// ============ 渲染报价结果 ============
function renderQuoteResult(lines) {
  const el = document.getElementById('quote-result');
  if (!lines || lines.length === 0) {
    el.innerHTML = '<div class="text-center text-sm text-gray-400 mt-8">未找到匹配产品</div>';
    return;
  }
  el.innerHTML = lines.map(line => {
    if (line.startsWith('___')) return '<hr class="my-2 border-gray-200">';
    if (line.startsWith('**')) return `<div class="text-xs font-bold text-gray-500 mt-3">${esc(line.replace(/\*\*/g, ''))}</div>`;
    if (line.startsWith('💡')) return `<div class="text-xs text-blue-500 mt-1">${esc(line.slice(1).trim())}</div>`;
    return `<div class="text-sm font-mono whitespace-pre-line">${esc(line)}</div>`;
  }).join('');
  el.scrollTop = 0;
}

// ============ 主搜索入口 ============
function handleQuoteSearch() {
  const input = document.getElementById('quote-input').value.trim();
  if (!input) return;
  const result = parseQuoteInput(input);
  const el = document.getElementById('quote-result');
  renderQuoteResult(result);
  // 查询完自动显示货物价格汇总（USD）
  updateSummary(el, 'USD', 1);
}

// ============ 汇率换算下拉 ============
function toggleCurrencyDropdown() {
  const dd = document.getElementById('currency-dropdown');
  dd.classList.toggle('hidden');
  // 点击其他区域关闭
  const close = (e) => {
    if (!document.getElementById('currency-dropdown-wrap').contains(e.target)) {
      dd.classList.add('hidden');
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function appendCurrency(currency) {
  document.getElementById('currency-dropdown').classList.add('hidden');
  const el = document.getElementById('quote-result');
  if (!el || !el.textContent.trim() || el.textContent.includes('请输入询价内容')) {
    showToast('请先查询报价', 'warning');
    return;
  }
  const rates = await getExchangeRates();
  const rate = rates[currency];
  if (!rate) { showToast('汇率获取失败', 'error'); return; }
  const symbol = { EUR: '€', AUD: 'A$', CAD: 'C$' }[currency];
  // 先清除之前的所有换算后缀（匹配 =€, =A$, =C$ 开头的数字）
  el.querySelectorAll('div.text-sm.font-mono').forEach(div => {
    div.textContent = div.textContent.replace(/=(?:€|A\$|C\$)[\d\.]+/g, '');
  });
  // 再追加新币种换算
  el.querySelectorAll('div.text-sm.font-mono').forEach(div => {
    const text = div.textContent;
    const usdMatches = [...text.matchAll(/USD([\d\.]+)/g)];
    if (usdMatches.length > 0) {
      const lastMatch = usdMatches[usdMatches.length - 1];
      const usdVal = parseFloat(lastMatch[1]);
      const converted = (usdVal * rate).toFixed(2);
      const insertPos = lastMatch.index + lastMatch[0].length;
      div.textContent = text.slice(0, insertPos) + `=${symbol}${converted}` + text.slice(insertPos);
    }
  });
  // 汇总跟随货币
  updateSummary(el, currency, rate);
  showToast(`已换算为 ${currency}（1 USD = ${symbol}${rate.toFixed(4)}）`, 'success');
}

// ============ 货物价格汇总 ============
function calcSummary(el) {
  const divs = el.querySelectorAll('div.text-sm.font-mono');
  let totalUSD = 0;
  let count = 0;
  divs.forEach(div => {
    const text = div.textContent;
    let subtotal = null;
    const eqMatch = text.match(/= USD([\d\.]+)/);
    if (eqMatch) {
      subtotal = parseFloat(eqMatch[1]);
    } else {
      const usdMatches = [...text.matchAll(/USD([\d\.]+)/g)];
      if (usdMatches.length > 0) {
        subtotal = parseFloat(usdMatches[usdMatches.length - 1][1]);
      }
    }
    if (subtotal !== null) { totalUSD += subtotal; count++; }
  });
  return { totalUSD, count };
}

function updateSummary(el, currency, rate) {
  const { totalUSD, count } = calcSummary(el);
  if (count === 0) return;
  const existing = el.querySelector('.quote-summary');
  if (existing) existing.remove();
  const labels = { USD: ['USD', ''], EUR: ['€', 'EUR'], AUD: ['A$', 'AUD'], CAD: ['C$', 'CAD'] };
  const [sym, code] = labels[currency] || ['USD', ''];
  const displayTotal = currency === 'USD' ? totalUSD : (totalUSD * rate).toFixed(2);
  const displayLabel = currency === 'USD' ? 'USD' : `${code}`;
  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'quote-summary mt-4 pt-3 border-t-2 border-green-200 bg-green-50 rounded-lg p-3';
  summaryDiv.innerHTML = `
    <div class="font-bold text-sm text-green-700 mb-1">📊 货物价格汇总</div>
    <div class="text-xs text-gray-500 mb-1">共 ${count} 项</div>
    <div class="text-base font-bold text-green-700">${sym} ${displayTotal}</div>
  `;
  el.appendChild(summaryDiv);
  el.scrollTop = el.scrollHeight;
}

function showTotalSummary() {
  const el = document.getElementById('quote-result');
  if (!el || !el.textContent.trim() || el.textContent.includes('请输入询价内容')) {
    showToast('请先查询报价', 'warning');
    return;
  }
  const { totalUSD, count } = calcSummary(el);
  if (count === 0) { showToast('未找到可汇总的报价', 'warning'); return; }
  updateSummary(el, 'USD', 1);
}

// ============ 输入解析 ============
function parseQuoteInput(input) {
  const lines = [];
  // 多个产品用换行、中文逗号、英文逗号、分号分隔
  const rawQueries = input.split(/[\n\u3001,;]+/).map(s => s.trim()).filter(Boolean);

  // 组合产品别名映射：用户输入 → 组合产品名（用于整体匹配优先）
  const COMBO_ALIASES = {
    'bpc+tb': 'BPC157+TB500', 'bpc157+tb500': 'BPC157+TB500', 'bpc157+tb': 'BPC157+TB500',
    'bbg': 'BPC157+TB500+GHK', 'bpc+tb+ghk': 'BPC157+TB500+GHK', 'bpc157+tb500+ghk': 'BPC157+TB500+GHK',
    'klow': 'BPC157+TB500+GHK+KPV', 'bpc+tb+ghk+kpv': 'BPC157+TB500+GHK+KPV',
    'cagri+sema': 'Cagrilintide+Semaglutide', 'cagrilintide+semaglutide': 'Cagrilintide+Semaglutide',
    'cs': 'Cagrilintide+Semaglutide',
    'cjc+ipa': 'CJC1295 no DAC+IPA', 'cjc1295+ipa': 'CJC1295 no DAC+IPA', 'cjc1295nodac+ipa': 'CJC1295 no DAC+IPA',
    'cp': 'CJC1295 no DAC+IPA',
  };

  const queries = [];
  rawQueries.forEach(q => {
    // === 策略：先尝试整体匹配组合产品，不行再拆分 ===
    // 1. 剥离尾部数量和规格，得到核心搜索词
    let coreQ = q;
    coreQ = coreQ.replace(/\s*[xX×*]\s*\d+\s*(?:boxes|box|vials?|瓶|盒|支|个|pcs|packs?)?\s*$/i, '');
    coreQ = coreQ.replace(/\s+\d+\s*(?:boxes|box|vials?|瓶|盒|支|个|pcs|packs?)\s*$/i, '');
    coreQ = coreQ.replace(/\s+\d+\s*(?:mg|iu|ml|mcg|g)\s*$/gi, '');
    coreQ = coreQ.replace(/^[-–—•]\s*/, '').trim();
    const kw = normalizeStr(coreQ);

    // 2. 检查是否命中组合产品别名
    let isCombo = false;
    const comboName = COMBO_ALIASES[kw];
    if (comboName) {
      // 找到组合产品别名，作为整体处理
      queries.push({ raw: q, isCombo: true, comboName });
      isCombo = true;
    }

    // 3. 如果没命中别名，检查输入是否包含空格分隔的 '+' 且两侧都能匹配到已知产品名
    if (!isCombo && /\s\+\s/.test(q)) {
      // 按空格+加号+空格拆分原始输入（保留各部分原始文本）
      const rawParts = q.split(/\s\+\s/);
      const allPartsKnown = rawParts.length >= 2 && rawParts.every(p => {
        if (!p.trim()) return false;
        // 剥离该部分的规格和数量，得到纯产品名
        let cleanP = p.replace(/\s*\d+\s*(?:mg|iu|ml|mcg|g)\s*$/gi, '');
        cleanP = cleanP.replace(/\s*\d+\s*(?:vials?|boxes|瓶|盒|支|个)\s*$/gi, '');
        cleanP = cleanP.replace(/\s*[xX×*]\s*\d+\s*(?:vials?|boxes|瓶|盒|支|个)?\s*$/gi, '');
        cleanP = cleanP.replace(/\s+\d+\s*$/, ''); // 尾部纯数字
        cleanP = normalizeStr(cleanP);
        if (!cleanP || cleanP.length < 2) return false;
        // 检查是否为已知产品名/代码/别名
        return QUOTE_PRODUCTS.some(qp => {
          const pn = normalizeStr(qp.name);
          const pc = normalizeStr(qp.code);
          return pn.includes(cleanP) || cleanP.includes(pn) || pc.startsWith(cleanP) || cleanP.startsWith(pc);
        }) || Object.keys(ABBR_DIRECT).some(k => normalizeStr(k) === cleanP || cleanP.includes(normalizeStr(k)));
      });
      if (allPartsKnown) {
        // 整体匹配组合产品
        queries.push({ raw: q, isCombo: true, comboName: null, comboKw: kw });
        isCombo = true;
      }
    }

    // 4. 非组合产品：按原逻辑处理（含拆分）
    if (!isCombo) {
      // 仅在 '+' 两侧有空格分隔且两侧都是有效产品词时才拆分
      // 避免 NAD+、CJC1295+ 等 '+' 作为产品名一部分被误拆
      const plusParts = q.split(/\s*\+\s*/);
      const hasSpaceAround = /\s\+\s/.test(q); // '+' 两侧都有空格才考虑拆分
      const shouldSplit = hasSpaceAround && plusParts.length >= 2 && plusParts.every(p => /[a-zA-Z]/.test(p) && p.trim().length > 1);
      if (shouldSplit) {
        plusParts.forEach(p => { if (p.trim()) queries.push({ raw: p.trim(), isCombo: false }); });
      } else {
        queries.push({ raw: q, isCombo: false });
      }
    }
  });

  queries.forEach((entry, idx) => {
    if (idx > 0) lines.push('___'); // 分隔线
    let q = entry.raw;

    // === 0. 预处理：去掉列表前缀 ===
    q = q.replace(/^[-–—•]\s*/, '').trim();

    // === 1. 提取规格数字 ===
    let specNum = null;
    const specMatch = q.match(/(\d+)\s*(mg|iu|ml|mcg|g)\b/i);
    if (specMatch) {
      specNum = parseInt(specMatch[1]);
    }

    // === 3. 提取数量 qty ===
    let qty = 0;
    // 格式A：产品 X 3 boxes / 产品 x3 / NAD+ 1000mg X 3
    let m = q.match(/^(.+?)\s*[xX×*]\s*(\d+)\s*(?:boxes|box|vials?|瓶|盒|支|个|pcs|packs?)?\s*$/i);
    if (m) qty = parseInt(m[2]);
    // 格式A2：产品 X 10 3 → X 后面两个数字，第二个是数量（如 SS-31 50mg X 10 3 → qty=3）
    if (!qty) { m = q.match(/\s*[xX×*]\s*\d+\s+(\d+)\s*$/); if (m) qty = parseInt(m[1]); }
    // 格式B：产品 3 boxes / 产品 2 vials
    if (!qty) { m = q.match(/^(.+?)\s+(\d+)\s*(?:boxes|box|vials?|瓶|盒|支|个|pcs|packs?)\s*$/i); if (m) qty = parseInt(m[2]); }
    // 格式B2：尾部独立数字作为数量（如 "SS-31 50mg 3" → qty=3，但要排除规格数字）
    if (!qty) { m = q.match(/^(.+?\d+(?:mg|iu|ml|mcg|g)?)\s+(\d+)\s*$/i); if (m && parseInt(m[2]) !== parseInt((m[1].match(/(\d+)\s*(?:mg|iu|ml|mcg|g)/i)||[])[1])) qty = parseInt(m[2]); }
    // 格式C：3x产品 / 3*产品
    if (!qty) { m = q.match(/^(\d+)\s*[xX×*]\s*(.+)$/); if (m) qty = parseInt(m[1]); }
    // 格式D：3支产品 / 3盒产品
    if (!qty) { m = q.match(/^(\d+)\s*(?:盒|支|瓶|个|packs?)\s*(.+)$/i); if (m) qty = parseInt(m[1]); }
    // 格式E：数量产品无分隔 3HGH36
    if (!qty) { m = q.match(/^(\d+)([a-zA-Z].*)$/); if (m) qty = parseInt(m[1]); }
    // 格式F：3 NAD+（数量 + 空格 + 以字母开头的名称）
    if (!qty) { m = q.match(/^(\d+)\s+([a-zA-Z+].*)$/); if (m) qty = parseInt(m[1]); }

    // === 4. 剥离尾部数量和规格，得到产品名 searchInput ===
    let searchInput = q;
    // 剥离尾部数量标记：X 3 boxes / x3 / 3 boxes
    searchInput = searchInput.replace(/\s*[xX×*]\s*\d+\s*(?:boxes|box|vials?|瓶|盒|支|个|pcs|packs?)?\s*$/i, '');
    searchInput = searchInput.replace(/\s+\d+\s*(?:boxes|box|vials?|瓶|盒|支|个|pcs|packs?)\s*$/i, '');
    // 剥离尾部规格：1000mg / 10iu / 2ml
    searchInput = searchInput.replace(/\s+\d+\s*(?:mg|iu|ml|mcg|g)\s*$/gi, '');
    searchInput = searchInput.trim();
    if (!searchInput) searchInput = q;

    // === 4.5 组合产品优先匹配 ===
    if (entry.isCombo) {
      const comboSearch = entry.comboName || entry.comboKw || searchInput;
      // 剥离 comboSearch 中的规格数字，只保留产品名部分用于匹配
      let cleanComboSearch = normalizeStr(comboSearch);
      cleanComboSearch = cleanComboSearch.replace(/\d+\s*(?:mg|iu|ml|mcg|g)/gi, '').replace(/\s+/g, '').replace(/\+$/, '').trim();
      let comboHits = [];

      // 方法1：直接包含匹配（别名或代码精确匹配）
      comboHits = QUOTE_PRODUCTS.filter(p => {
        const pn = normalizeStr(p.name);
        return pn.includes(cleanComboSearch) || pn.includes(normalizeStr(comboSearch)) || normalizeStr(p.code) === normalizeStr(comboSearch);
      });

      // 方法2：按 + 拆分，检查两侧产品名是否分别匹配组合产品名的各部分
      if (comboHits.length === 0 && cleanComboSearch.includes('+')) {
        const inputParts = cleanComboSearch.split('+').map(s => s.trim()).filter(Boolean);
        if (inputParts.length >= 2) {
          comboHits = QUOTE_PRODUCTS.filter(p => {
            const pn = normalizeStr(p.name);
            // 也按 + 拆分产品名
            const prodParts = pn.split('+').map(s => s.trim()).filter(Boolean);
            if (prodParts.length < 2) return false;
            // 检查输入的每个部分是否能在产品名的某个部分中找到匹配
            return inputParts.every(ip => {
              return prodParts.some(pp => pp.includes(ip) || ip.includes(pp));
            });
          });
        }
      }
      // 规格过滤（组合产品可能有不同规格，如 BB10/BB20）
      if (specNum && comboHits.length >= 1) {
        const specHits = comboHits.filter(p => {
          const firstNum = (p.spec || '').match(/(\d+)/);
          return firstNum && parseInt(firstNum[1]) === specNum;
        });
        if (specHits.length > 0) {
          comboHits = specHits;
        } else {
          // 静默替换最接近规格
          const nearest = comboHits.map(p => {
            const firstNum = (p.spec || '').match(/(\d+)/);
            const dose = firstNum ? parseInt(firstNum[1]) : 0;
            return { product: p, diff: Math.abs(dose - specNum) };
          }).sort((a, b) => a.diff - b.diff);
          if (nearest.length > 0) comboHits = [nearest[0].product];
        }
      }
      if (comboHits.length > 0) {
        if (comboHits.length === 1) {
          const p = comboHits[0];
          if (qty > 0) {
            lines.push(`${p.name}：${p.code} ${p.spec} USD${p.price} x${qty} = USD${p.price * qty}`);
          } else {
            lines.push(`${p.name}：${p.code} ${p.spec} USD${p.price}`);
          }
        } else {
          comboHits.forEach(p => {
            lines.push(`${p.name}：${p.code} ${p.spec} USD${p.price}`);
          });
        }
        addQuoteHistory(comboHits);
      } else {
        lines.push(`未找到组合产品：${q}`);
      }
      return;
    }

    // === 5. 核心搜索 + 规格过滤 ===    // === 6. 核心搜索 + 规格过滤（数量分支和普通分支共用） ===
    let hits = quoteFindByNameOrCode(searchInput);

    // 规格过滤：specNum 精确匹配 → 无匹配则报错并列出该产品所有规格
    if (specNum && hits.length >= 1) {
      const specHits = hits.filter(p => {
        const firstNum = (p.spec || '').match(/(\d+)/);
        return firstNum && parseInt(firstNum[1]) === specNum;
      });
      if (specHits.length > 0) {
        hits = specHits;
      } else {
        // 规格不存在：静默替换为最接近的规格
        const nearest = hits.map(p => {
          const firstNum = (p.spec || '').match(/(\d+)/);
          const dose = firstNum ? parseInt(firstNum[1]) : 0;
          return { product: p, diff: Math.abs(dose - specNum) };
        }).sort((a, b) => a.diff - b.diff);
        if (nearest.length > 0) hits = [nearest[0].product];
      }
    }

    // === 7. 输出结果 ===
    if (hits.length === 0) {
      lines.push(`未找到产品：${q}`);
      const recs = recommendSimilar(searchInput);
      if (recs.length > 0) {
        lines.push(`💡 你可能想找：`);
        recs.forEach(p => { lines.push(`${p.name}：${p.code} ${p.spec} USD${p.price}`); });
      }
    } else if (hits.length === 1) {
      const p = hits[0];
      if (qty > 0) {
        lines.push(`${p.name}：${p.code} ${p.spec} USD${p.price} x${qty} = USD${p.price * qty}`);
      } else {
        lines.push(`${p.name}：${p.code} ${p.spec} USD${p.price}`);
      }
      addQuoteHistory(hits);
    } else {
      // 按产品名分组
      const groups = {};
      hits.forEach(p => { if (!groups[p.name]) groups[p.name] = []; groups[p.name].push(p); });
      const groupKeys = Object.keys(groups);
      if (groupKeys.length === 1) {
        // 同一产品多规格：列出全部
        groups[groupKeys[0]].forEach(p => {
          lines.push(`${p.name}：${p.code} ${p.spec} USD${p.price}`);
        });
        addQuoteHistory(hits);
      } else {
        // 不同产品：列出全部
        groupKeys.forEach(name => {
          groups[name].forEach(p => { lines.push(`${p.name}：${p.code} ${p.spec} USD${p.price}`); });
        });
        addQuoteHistory(hits);
      }
    }
  });

  return lines;
}

// ============ 推荐相似产品 ============
function recommendSimilar(input) {
  const kw = normalizeStr(input);
  const scored = QUOTE_PRODUCTS.map(p => {
    const ns = normalizeStr(p.name);
    const cs = normalizeStr(p.code);
    let score = 0;
    if (ns.includes(kw) || kw.includes(ns)) score += 3;
    if (cs.includes(kw) || kw.includes(cs)) score += 2;
    score += fuzzySubseqScore(kw, ns) * 2;
    score += fuzzySubseqScore(kw, cs);
    // 编辑距离打分（距离越小分越高）
    const dName = levenshteinDist(kw, ns);
    const threshold = (kw.length >= 8 || ns.length >= 8) ? 4 : 2;
    if (dName <= threshold) score += (threshold - dName + 1) * 1.5;
    // 别名词匹配
    Object.keys(PRODUCT_ALIASES).forEach(alias => {
      if (kw.includes(alias) && (ns.includes(PRODUCT_ALIASES[alias]) || cs.includes(alias.toUpperCase()))) score += 5;
    });
    return { product: p, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  // 去重同名产品，取每个产品的最低价格规格作为代表
  const seen = new Set();
  const result = [];
  scored.forEach(x => {
    if (!seen.has(x.product.name)) {
      seen.add(x.product.name);
      // 找该系列最便宜的
      const cheapest = QUOTE_PRODUCTS.filter(p => p.name === x.product.name).sort((a, b) => a.price - b.price)[0];
      result.push(cheapest);
    }
  });
  return result.slice(0, 3);
}

// ============ 会话历史管理 ============
function addQuoteHistory(products) {
  products.forEach(p => {
    if (!quoteHistory.find(h => h.code === p.code && h.spec === p.spec)) {
      quoteHistory.push({ ...p });
    }
  });
}

function resetQuote() {
  quoteHistory = [];
  const input = document.getElementById('quote-input');
  if (input) input.value = '';
  document.getElementById('quote-result').innerHTML = '<div class="text-center text-sm text-gray-300 mt-12">请输入询价内容<br><span class="text-xs text-gray-400 mt-2 block">支持：产品名、代码、数量询价、复合产品</span></div>';
  showToast('已重置', 'success');
}

// ============ 复制报价结果 ============
function copyQuoteResult() {
  const el = document.getElementById('quote-result');
  if (!el || !el.textContent.trim()) {
    showToast('暂无报价结果可复制', 'warning');
    return;
  }
  const text = el.innerText.trim();
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制到剪贴板', 'success');
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制到剪贴板', 'success');
  });
}




// ============ 页面初始化 ============
function renderQuotePage() {
  const el = document.getElementById('quote-result');
  if (el && (!el.innerHTML || el.innerHTML.includes('请输入询价内容'))) {
    el.innerHTML = '<div class="text-center text-sm text-gray-300 mt-12">请输入询价内容<br><span class="text-xs text-gray-400 mt-2 block">支持：产品名、代码、数量询价、复合产品</span></div>';
  }
}

// ============ 启动 ============
document.addEventListener('DOMContentLoaded', function() {
  const qtyInput = document.getElementById('batch-stock-qty');
  if (qtyInput) qtyInput.addEventListener('input', renderBatchStockPreview);
});
function populateOwnerSelects() {
  const filterSel = document.getElementById('order-owner-filter');
  if (filterSel) {
    const first = filterSel.options[0];
    filterSel.innerHTML = '';
    if (first) filterSel.appendChild(first);
    allProfiles.forEach(p => {
      const o = document.createElement('option');
      o.value = p.name; o.textContent = p.name;
      filterSel.appendChild(o);
    });
  }
  const modalSel = document.getElementById('order-owner-select');
  if (modalSel) {
    const first = modalSel.options[0];
    modalSel.innerHTML = '';
    if (first) modalSel.appendChild(first);
    allProfiles.forEach(p => {
      const o = document.createElement('option');
      o.value = p.name; o.textContent = p.name;
      modalSel.appendChild(o);
    });
  }
}

function exportShippingSheet(format) {
  const statusFilter = document.getElementById('order-status-dropdown')?.dataset?.value || '';
  let orders = allOrders.slice();
  if (statusFilter) orders = orders.filter(o => o.status === statusFilter);
  if (orders.length === 0) { showToast('暂无订单可导出', 'warning'); return; }
  const headers = ['订单号','客户姓名','联系电话','国家','收货地址','产品明细','订单日期'];
  const rows = orders.map(o => {
    const items = allOrderItems.filter(i => i.order_id === o.id);
    const detail = items.map(i => {
      const p = allProducts.find(x => x.id === i.product_id);
      const spec = p && p.sku ? ' ' + p.sku : '';
      return (p ? p.name + spec : '未知产品') + '×' + i.quantity;
    }).join('; ');
    return [o.order_no, o.customer_name, o.customer_phone || '', o.country || '', o.customer_address || '', detail, (o.created_at || '').slice(0, 10)];
  });

  if (format === 'copy') {
    const text = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('已复制 ' + orders.length + ' 条货运单到剪贴板', 'success')).catch(() => showToast('复制失败，请重试', 'error'));
    return;
  }

  if (format === 'txt') {
    const text = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, '货运单_' + new Date().toISOString().slice(0, 10) + '.txt');
    showToast('已导出 ' + orders.length + ' 条货运单', 'success');
    return;
  }

  // CSV
  const BOM = '\uFEFF';
  const csv = [headers.join(','), ...rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(','))].join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, '货运单_' + new Date().toISOString().slice(0, 10) + '.csv');
  showToast('已导出 ' + orders.length + ' 条货运单', 'success');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
}

// ============ 运费助手 ============
let shippingTemplates = [];
const SHIP_TPL_KEY = 'oi_shipping_templates';
const CURRENCY_SYMBOLS = { USD: '$', AUD: 'A$', CNY: '¥', EUR: '€', GBP: '£' };
const PAYMENT_LABELS = { bank_transfer: '🏦 银行转账', paypal: '🅿️ PayPal', wise: '💚 Wise', crypto: '🔗 加密货币' };
const CURRENCY_FULL = { USD: 'USD 美元', EUR: 'EUR 欧元', AUD: 'AUD 澳元', CAD: 'CAD 加元' };
function curSym(c) { return CURRENCY_SYMBOLS[c] || c + ' '; }

// ============ 结算货币 & 汇率 ============
let _settlementCurrency = 'USD';
let _orderExchangeRate = 1; // 结算货币→USD 的汇率（即 1 结算货币 = ? USD）
let _orderUsdToCny = 7.25; // 1 USD = ? CNY

function getCurrencyUsdRate(cur) {
  // 返回 1 cur = ? USD
  const rates = { USD: 1, EUR: 1/0.92, AUD: 1/1.53, CAD: 1/1.36 };
  return rates[cur] || 1;
}

// ============ 欧洲可邮寄国家白名单 ============
const EU_WHITELIST = [
  '丹麦','瑞典','芬兰','德国','奥地利','比利时','荷兰','波兰','西班牙',
  '捷克','法国','卢森堡','匈牙利','意大利','斯洛文尼亚','斯洛伐克',
  '保加利亚','爱沙尼亚','希腊','克罗地亚','爱尔兰','立陶宛','拉脱维亚','葡萄牙','罗马尼亚'
];
const ALL_COUNTRIES = [
  '澳大利亚','新西兰','美国','加拿大','英国','爱尔兰',
  '德国','法国','荷兰','比利时','卢森堡','意大利','西班牙','葡萄牙',
  '奥地利','瑞士','瑞典','丹麦','芬兰','挪威','波兰','捷克',
  '匈牙利','希腊','斯洛文尼亚','斯洛伐克','保加利亚','爱沙尼亚',
  '克罗地亚','立陶宛','拉脱维亚','罗马尼亚',
  '中国','日本','韩国','新加坡','马来西亚','泰国','越南','菲律宾',
  '印度尼西亚','印度','阿联酋','沙特阿拉伯','卡塔尔','以色列',
  '南非','巴西','墨西哥','阿根廷','智利','哥伦比亚'
];

function isEuropeanCountry(name) {
  const europeKeywords = ['丹麦','瑞典','挪威','芬兰','德国','法国','荷兰','比利时','卢森堡',
    '意大利','西班牙','葡萄牙','奥地利','瑞士','波兰','捷克','匈牙利',
    '希腊','斯洛文尼亚','斯洛伐克','保加利亚','爱沙尼亚','克罗地亚',
    '立陶宛','拉脱维亚','罗马尼亚','爱尔兰','英国'];
  return europeKeywords.some(k => name.includes(k));
}

function isCountryAllowed(name) {
  if (name.includes('澳大利亚') || name.includes('澳洲')) return true; // 澳大利亚无条件放行
  if (!isEuropeanCountry(name)) return true;  // 非欧洲，不限
  return EU_WHITELIST.some(w => name.includes(w));
}

function showCountryDropdown() {
  const panel = document.getElementById('country-dropdown');
  filterCountryDropdown();
  panel.classList.remove('hidden');
}

function filterCountryDropdown() {
  const input = document.getElementById('order-customer-country-input');
  const panel = document.getElementById('country-dropdown');
  const keyword = (input.value || '').trim().toLowerCase();
  let list = ALL_COUNTRIES.filter(c => isCountryAllowed(c));
  if (keyword) list = list.filter(c => c.toLowerCase().includes(keyword));
  if (list.length === 0) {
    panel.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">无匹配国家</div>';
  } else {
    panel.innerHTML = list.map(c =>
      `<div class="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm" data-country="${esc(c)}">${esc(c)}</div>`
    ).join('');
    panel.querySelectorAll('[data-country]').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        selectCountry(el.dataset.country);
      });
    });
  }
  panel.classList.remove('hidden');
}

function selectCountry(name) {
  document.getElementById('order-customer-country-input').value = name;
  document.getElementById('order-customer-country').value = name;
  document.getElementById('country-dropdown').classList.add('hidden');
}

function hideCountryDropdownDelay() {
  setTimeout(() => {
    document.getElementById('country-dropdown')?.classList.add('hidden');
  }, 200);
}

// ============ 产品重量库
let weightProducts = [];
const WEIGHT_PRODUCT_KEY = 'oi_weight_products';

function loadWeightProducts() {
  return sb.from('weight_products').select('*').order('type').then(({ data, error }) => {
    if (!error && data && data.length > 0) {
      weightProducts = data.map(p => ({
        id: p.id, name: p.name, type: p.type || 'product',
        net_weight: parseFloat(p.net_weight) || 0,
        gross_weight: parseFloat(p.gross_weight) || 0,
        capacity: parseInt(p.capacity) || 0
      }));
      localStorage.setItem(WEIGHT_PRODUCT_KEY, JSON.stringify(weightProducts));
    } else {
      // 回退到 localStorage
      try {
        const raw = localStorage.getItem(WEIGHT_PRODUCT_KEY);
        weightProducts = raw ? JSON.parse(raw) : [];
        let changed = false;
        weightProducts.forEach(p => {
          if (!p.type) {
            p.type = (p.capacity && p.capacity > 0) ? 'packaging' : 'product';
            changed = true;
          }
        });
        if (changed) saveWeightProductsToStorage();
      } catch (e) { weightProducts = []; }
    }
  }).catch(() => {
    try {
      const raw = localStorage.getItem(WEIGHT_PRODUCT_KEY);
      weightProducts = raw ? JSON.parse(raw) : [];
    } catch (e) { weightProducts = []; }
  });
}

function saveWeightProductsToStorage() {
  localStorage.setItem(WEIGHT_PRODUCT_KEY, JSON.stringify(weightProducts));
  // 同步到 Supabase
  sb.rpc('sync_weight_products', { p_data: JSON.stringify(weightProducts) }).then(() => {
    console.log('产品重量库已同步到云端');
  }).catch(err => {
    console.warn('产品重量库云端同步失败:', err);
  });
}

function renderWeightProducts() {
  const tbody = document.getElementById('weight-product-body');
  const empty = document.getElementById('weight-product-empty');
  if (weightProducts.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tbody.innerHTML = weightProducts.map(p => {
    const typeLabel = p.type === 'packaging'
      ? '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">外包装</span>'
      : '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">产品</span>';
    const capacityStr = (p.type === 'packaging' && p.capacity)
      ? p.capacity + '盒/箱'
      : '<span class="text-gray-300">—</span>';
    return `<tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
      <td class="px-3 py-2.5">${typeLabel}</td>
      <td class="px-3 py-2.5 font-medium">${esc(p.name)}</td>
      <td class="px-3 py-2.5 text-right">${p.net_weight}g</td>
      <td class="px-3 py-2.5 text-right">${p.gross_weight ? p.gross_weight + 'g' : '<span class="text-gray-300">—</span>'}</td>
      <td class="px-3 py-2.5 text-right text-xs text-gray-500">${capacityStr}</td>
      <td class="px-3 py-2.5 text-center">
        <button onclick="editWeightProduct('${p.id}')" class="text-blue-500 hover:text-blue-700 text-xs mr-2">编辑</button>
        <button onclick="deleteWeightProduct('${p.id}')" class="text-red-500 hover:text-red-700 text-xs">删除</button>
      </td>
    </tr>`;
  }).join('');
}

// 运费助手产品条目（单条逐条添加）
let shipEntries = []; // { id, productId, qty }
let lastShipTotal = 0;   // 最近一次核算的运费总金额
let lastShipCurrency = 'USD'; // 最近一次核算的币种
function addShipEntry() {
  const id = 'entry_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  shipEntries.push({ id, productId: '', qty: 1, packaging: '' });
  renderShipEntries();
}

function removeShipEntry(id) {
  shipEntries = shipEntries.filter(e => e.id !== id);
  renderShipEntries();
}

function onShipEntryProductChange(id, val) {
  const e = shipEntries.find(x => x.id === id);
  if (e) e.productId = val;
}

function onShipEntryQtyChange(id, val) {
  const e = shipEntries.find(x => x.id === id);
  if (e) e.qty = parseInt(val) || 1;
  updateShipTotal();
  updateChannelOptions();
}

function onShipEntryPackagingChange(id, val) {
  // 保留空函数以防旧调用（不再使用）
}

function onShipPackagingChange(pkgId) {
  const capInput = document.getElementById('ship-box-capacity');
  if (!pkgId) {
    capInput.value = '';
    updateChannelOptions();
    return;
  }
  const pkg = weightProducts.find(p => p.id === pkgId);
  capInput.value = pkg && pkg.capacity ? pkg.capacity : '';
  updateShipTotal();
  updateChannelOptions();
}

function updateShipTotal() {
  const total = shipEntries.reduce((s, e) => s + (e.qty || 0), 0);
  const el = document.getElementById('ship-total-boxes');
  if (el) el.textContent = total;
  const info = document.getElementById('ship-split-info');
  const pkgDisplay = document.getElementById('ship-auto-pkg');
  if (!info || total === 0) {
    if (info) info.classList.add('hidden');
    if (pkgDisplay) pkgDisplay.textContent = '';
    return;
  }

  // 自动选择箱子（和 calcShipping / autoCalcShipping 同逻辑）
  const packagingList = weightProducts.filter(w => w.type === 'packaging' && (w.capacity || 0) > 0);
  if (packagingList.length === 0) {
    info.classList.add('hidden');
    if (pkgDisplay) pkgDisplay.textContent = '无可用外包装';
    return;
  }
  packagingList.sort((a, b) => (a.capacity || 0) - (b.capacity || 0));
  const TOLERANCE = 5;
  let selectedPkg = packagingList.find(p => total <= (p.capacity || 0) + TOLERANCE);
  if (!selectedPkg) selectedPkg = packagingList[packagingList.length - 1];
  const boxCapacity = selectedPkg.capacity || 30;

  // 尽量少开箱
  let numBoxes = Math.ceil(total / (boxCapacity + TOLERANCE));
  if (numBoxes < 1) numBoxes = 1;

  // 更新自动选箱显示
  if (pkgDisplay) {
    pkgDisplay.textContent = `${selectedPkg.name}（容量${boxCapacity}盒）`;
  }

  const baseQty = Math.floor(total / numBoxes);
  const extra = total % numBoxes;
  const boxDetails = [];
  for (let b = 0; b < numBoxes; b++) {
    boxDetails.push(baseQty + (b < extra ? 1 : 0));
  }
  info.textContent = `总盒数 ${total}，分 ${numBoxes} 箱（${boxDetails.join('+')}）`;
  info.classList.remove('hidden');
}

function renderShipEntries() {
  const box = document.getElementById('ship-entries');
  if (!box) return;
  if (shipEntries.length === 0) {
    box.innerHTML = '<p class="text-xs text-gray-400">暂无产品条目，点击下方"新增条目"添加</p>';
    updateShipTotal();
    return;
  }
  box.innerHTML = shipEntries.map(entry => {
    const opts = weightProducts.filter(p => p.type !== 'packaging').map(p =>
      `<option value="${p.id}" ${entry.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');
    return `<div class="ship-entry flex flex-col sm:flex-row gap-2 items-start sm:items-end border border-gray-100 rounded-xl p-3 bg-gray-50">
      <div class="flex-1 min-w-0">
        <label class="block text-xs text-gray-500 mb-1">产品 *</label>
        <select onchange="onShipEntryProductChange('${entry.id}', this.value)" class="w-full px-2 py-2 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">请选择产品</option>
          ${opts}
        </select>
      </div>
      <div class="w-20 shrink-0">
        <label class="block text-xs text-gray-500 mb-1">盒数</label>
        <input type="number" min="1" value="${entry.qty}" onchange="onShipEntryQtyChange('${entry.id}', this.value)" class="w-full px-2 py-2 rounded-lg border border-gray-200 text-sm bg-white"/>
      </div>
      <button type="button" onclick="removeShipEntry('${entry.id}')" class="text-red-500 hover:text-red-700 text-xs shrink-0 px-2 py-2">删除</button>
    </div>`;
  }).join('');
  updateShipTotal();
  updateChannelOptions();
}

function openWeightProductModal(id) {
  const title = document.getElementById('weight-product-modal-title');
  const capWrap = document.getElementById('wp-capacity-wrap');
  const capHint = document.getElementById('wp-capacity-hint');
  if (id) {
    const p = weightProducts.find(x => x.id === id);
    if (!p) return;
    title.textContent = '编辑产品重量';
    document.getElementById('wp-id').value = p.id;
    document.getElementById('wp-name').value = p.name;
    document.getElementById('wp-net-weight').value = p.net_weight;
    document.getElementById('wp-gross-weight').value = p.gross_weight || '';
    const isPkg = p.type === 'packaging';
    document.querySelector('input[name="wp-type"][value="product"]').checked = !isPkg;
    document.querySelector('input[name="wp-type"][value="packaging"]').checked = isPkg;
    capWrap.classList.toggle('hidden', !isPkg);
    capHint.classList.toggle('hidden', !isPkg);
    document.getElementById('wp-capacity').value = isPkg ? (p.capacity || '') : '';
  } else {
    title.textContent = '新增产品重量';
    document.getElementById('wp-id').value = '';
    document.getElementById('wp-name').value = '';
    document.getElementById('wp-net-weight').value = '';
    document.getElementById('wp-gross-weight').value = '';
    document.querySelector('input[name="wp-type"][value="product"]').checked = true;
    document.querySelector('input[name="wp-type"][value="packaging"]').checked = false;
    capWrap.classList.add('hidden');
    capHint.classList.add('hidden');
    document.getElementById('wp-capacity').value = '';
  }
  openModal('modal-weight-product');
}

function onWeightProductTypeChange() {
  const isPkg = document.querySelector('input[name="wp-type"]:checked').value === 'packaging';
  document.getElementById('wp-capacity-wrap').classList.toggle('hidden', !isPkg);
  document.getElementById('wp-capacity-hint').classList.toggle('hidden', !isPkg);
}

function editWeightProduct(id) { openWeightProductModal(id); }

function deleteWeightProduct(id) {
  if (!confirm('确定删除该产品？')) return;
  weightProducts = weightProducts.filter(p => p.id !== id);
  saveWeightProductsToStorage();
  renderWeightProducts();
  showToast('已删除', 'success');
}

function saveWeightProduct() {
  const id = document.getElementById('wp-id').value;
  const name = document.getElementById('wp-name').value.trim();
  const netWeight = parseFloat(document.getElementById('wp-net-weight').value);
  const grossWeight = parseFloat(document.getElementById('wp-gross-weight').value) || 0;
  const type = document.querySelector('input[name="wp-type"]:checked').value;
  const capacity = type === 'packaging' ? (parseInt(document.getElementById('wp-capacity').value) || 0) : 0;
  if (!name) { showToast('请输入名称', 'warning'); return; }
  if (isNaN(netWeight) || netWeight < 0) { showToast('净重无效', 'warning'); return; }
  if (id) {
    const idx = weightProducts.findIndex(p => p.id === id);
    if (idx >= 0) weightProducts[idx] = { ...weightProducts[idx], name, type, net_weight: netWeight, gross_weight: grossWeight || 0, capacity };
  } else {
    weightProducts.push({ id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name, type, net_weight: netWeight, gross_weight: grossWeight || 0, capacity });
  }
  saveWeightProductsToStorage();
  closeModal('modal-weight-product');
  renderWeightProducts();
  showToast(id ? '已更新' : '已添加', 'success');
}

function loadShippingTemplates() {
  return sb.from('shipping_templates').select('*').order('country').then(({ data, error }) => {
    if (!error && data && data.length > 0) {
      shippingTemplates = data.map(t => ({
        id: t.id, country: t.country, channel: t.channel, currency: t.currency,
        spec_type: t.spec_type || '', delivery_time: t.delivery_time || '',
        first_weight: parseFloat(t.first_weight) || 0,
        first_price: parseFloat(t.first_price) || 0,
        add_weight: parseFloat(t.add_weight) || 0,
        add_price: parseFloat(t.add_price) || 0
      }));
      localStorage.setItem(SHIP_TPL_KEY, JSON.stringify(shippingTemplates));
    } else {
      // 回退到 localStorage
      try {
        const raw = localStorage.getItem(SHIP_TPL_KEY);
        shippingTemplates = raw ? JSON.parse(raw) : [];
        let migrated = false;
        shippingTemplates.forEach(t => {
          if (t.delivey_time !== undefined && t.delivery_time === undefined) {
            t.delivery_time = t.delivey_time;
            delete t.delivey_time;
            migrated = true;
          }
        });
        if (migrated) saveShippingTemplatesToStorage();
      } catch (e) { shippingTemplates = []; }
    }
  }).catch(() => {
    try {
      const raw = localStorage.getItem(SHIP_TPL_KEY);
      shippingTemplates = raw ? JSON.parse(raw) : [];
    } catch (e) { shippingTemplates = []; }
  });
}

function saveShippingTemplatesToStorage() {
  localStorage.setItem(SHIP_TPL_KEY, JSON.stringify(shippingTemplates));
  // 同步到 Supabase
  sb.rpc('sync_shipping_templates', { p_data: JSON.stringify(shippingTemplates) }).then(() => {
    console.log('运费模板已同步到云端');
  }).catch(err => {
    console.warn('运费模板云端同步失败:', err);
  });
}

function renderShippingPage() {
  // 初始化产品条目
  shipEntries = [];
  renderShipEntries();

  // 填充国家下拉
  const countrySel = document.getElementById('ship-country');
  const currentCountry = countrySel.value;
  const countries = [...new Set(shippingTemplates.map(t => t.country))];
  countrySel.innerHTML = '<option value="">请选择</option>' + countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  countrySel.value = currentCountry;
  updateChannelOptions();

  // 渲染模板表格
  renderShippingTemplates();

  // 渲染产品重量库
  renderWeightProducts();
}

function autoDetectSpecType(country) {
  if (!country) return '';
  const weights = [];
  for (const e of shipEntries) {
    if (!e.productId || !e.qty) continue;
    const p = weightProducts.find(w => w.id === e.productId && w.type !== 'packaging');
    if (!p) continue;
    const w = p.gross_weight || p.net_weight || 0;
    for (let i = 0; i < e.qty; i++) weights.push(w);
  }
  if (weights.length === 0) return '';

  // 澳大利亚判断放前面，避免被欧洲关键词误匹配
  const isAustralia = country.includes('澳大利亚') || country.includes('澳洲');
  const isEurope = !isAustralia && isEuropeanCountry(country);
  if (isAustralia) {
    // 自动选择箱子（和 calcShipping / autoCalcShipping 同逻辑）
    const packagingList = weightProducts.filter(w => w.type === 'packaging' && (w.capacity || 0) > 0);
    if (packagingList.length === 0) return '';
    packagingList.sort((a, b) => (a.capacity || 0) - (b.capacity || 0));
    const TOLERANCE = 5;
    let selectedPkg = packagingList.find(p => weights.length <= (p.capacity || 0) + TOLERANCE);
    if (!selectedPkg) selectedPkg = packagingList[packagingList.length - 1];
    const pkgWeight = selectedPkg.gross_weight || selectedPkg.net_weight || 0;
    const boxCapacity = selectedPkg.capacity || 30;
    let numBoxes = Math.ceil(weights.length / (boxCapacity + TOLERANCE));
    if (numBoxes < 1) numBoxes = 1;
    const totalWeight = weights.reduce((s, w) => s + w, 0) + pkgWeight * numBoxes;
    return (totalWeight >= 22000 && totalWeight <= 50000) ? '大件' : '小件';
  }
  return '';
}

function updateChannelOptions() {
  const country = document.getElementById('ship-country').value.trim();
  const channelSel = document.getElementById('ship-channel');
  const templates = shippingTemplates.filter(t => {
    if (!country) return false;
    const c = t.country || '';
    return c.includes(country) || country.includes(c);
  });
  if (templates.length === 0) {
    channelSel.innerHTML = '<option value="">无可用渠道</option>';
    return;
  }
  const detectedSpec = autoDetectSpecType(country);
  const filtered = detectedSpec
    ? templates.filter(t => t.spec_type === detectedSpec || !t.spec_type || t.spec_type === '')
    : templates;
  channelSel.innerHTML = filtered.map(t => {
    const label = (t.spec_type && t.spec_type !== '') ? `${t.channel}（${t.spec_type}）` : t.channel;
    return `<option value="${t.id}">${esc(label)}</option>`;
  }).join('');
  if (filtered.length === 1) {
    channelSel.value = filtered[0].id;
  } else if (detectedSpec) {
    const exact = filtered.find(t => t.spec_type === detectedSpec);
    if (exact) channelSel.value = exact.id;
  }
}

function renderShippingTemplates() {
  const tbody = document.getElementById('shipping-tpl-body');
  const empty = document.getElementById('shipping-tpl-empty');
  if (shippingTemplates.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tbody.innerHTML = shippingTemplates.map(t => {
    const sym = curSym(t.currency || 'USD');
    const specLabel = !t.spec_type ? '不限' : t.spec_type === '小件' ? '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">小件</span>' : '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700">大件</span>';
    return `<tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
    <td class="px-3 py-2.5 font-medium">${esc(t.country)}</td>
    <td class="px-3 py-2.5">${esc(t.channel)}</td>
    <td class="px-3 py-2.5">${specLabel}</td>
    <td class="px-3 py-2.5 text-sm text-gray-600">${esc(t.delivery_time || t.delivey_time || '-')}</td>
    <td class="px-3 py-2.5"><span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">${t.currency || 'USD'}</span></td>
    <td class="px-3 py-2.5 text-right">${t.first_weight || t.first_unit_qty || 0}g</td>
    <td class="px-3 py-2.5 text-right">${sym}${t.first_price.toFixed(2)}</td>
    <td class="px-3 py-2.5 text-right">${t.add_weight || t.add_unit_qty || 0}g</td>
    <td class="px-3 py-2.5 text-right">${sym}${t.add_price.toFixed(2)}</td>
    <td class="px-3 py-2.5 text-center">
      <button onclick="editShippingTemplate('${t.id}')" class="text-blue-500 hover:text-blue-700 text-xs mr-2">编辑</button>
      <button onclick="deleteShippingTemplate('${t.id}')" class="text-red-500 hover:text-red-700 text-xs">删除</button>
    </td>
  </tr>`;
  }).join('');
}

function openShippingTemplateModal(id) {
  const title = document.getElementById('shipping-tpl-modal-title');
  if (id) {
    const t = shippingTemplates.find(x => x.id === id);
    if (!t) return;
    title.textContent = '编辑运费模板';
    document.getElementById('stpl-id').value = t.id;
    document.getElementById('stpl-country').value = t.country;
    document.getElementById('stpl-channel').value = t.channel;
    document.getElementById('stpl-currency').value = t.currency || 'USD';
    document.getElementById('stpl-spec-type').value = t.spec_type || '';
    document.getElementById('stpl-delivery-time').value = t.delivery_time || t.delivey_time || '';
    document.getElementById('stpl-first-w').value = t.first_weight || t.first_unit_qty || '';
    document.getElementById('stpl-first-p').value = t.first_price;
    document.getElementById('stpl-add-w').value = t.add_weight || t.add_unit_qty || '';
    document.getElementById('stpl-add-p').value = t.add_price;
  } else {
    title.textContent = '新增运费模板';
    document.getElementById('stpl-id').value = '';
    document.getElementById('stpl-country').value = '';
    document.getElementById('stpl-channel').value = '';
    document.getElementById('stpl-currency').value = 'USD';
    document.getElementById('stpl-spec-type').value = '';
    document.getElementById('stpl-delivery-time').value = '';
    document.getElementById('stpl-first-w').value = '';
    document.getElementById('stpl-first-p').value = '';
    document.getElementById('stpl-add-w').value = '';
    document.getElementById('stpl-add-p').value = '';
  }
  updatePriceLabels();
  openModal('modal-shipping-tpl');
}

function updatePriceLabels() {
  const cur = document.getElementById('stpl-currency').value;
  const sym = curSym(cur);
  document.getElementById('lbl-first-p').textContent = `首重价格 (${sym}) *`;
  document.getElementById('lbl-add-p').textContent = `续重价格 (${sym}) *`;
}

function editShippingTemplate(id) { openShippingTemplateModal(id); }

function deleteShippingTemplate(id) {
  if (!confirm('确定删除该运费模板？')) return;
  shippingTemplates = shippingTemplates.filter(t => t.id !== id);
  saveShippingTemplatesToStorage();
  renderShippingPage();
  showToast('已删除', 'success');
}

function saveShippingTemplate() {
  const id = document.getElementById('stpl-id').value;
  const country = document.getElementById('stpl-country').value.trim();
  const channel = document.getElementById('stpl-channel').value.trim();
  const currency = document.getElementById('stpl-currency').value;
  const specType = document.getElementById('stpl-spec-type').value;
  const deliveryTime = document.getElementById('stpl-delivery-time').value.trim();
  const firstWeight = parseInt(document.getElementById('stpl-first-w').value);
  const firstPrice = parseFloat(document.getElementById('stpl-first-p').value);
  const addWeight = parseInt(document.getElementById('stpl-add-w').value);
  const addPrice = parseFloat(document.getElementById('stpl-add-p').value);

  if (!country) { showToast('请输入目的国家/地区', 'warning'); return; }
  if (!channel) { showToast('请输入渠道名称', 'warning'); return; }
  if (!firstWeight || firstWeight <= 0) { showToast('首重必须大于0', 'warning'); return; }
  if (isNaN(firstPrice) || firstPrice < 0) { showToast('首重价格无效', 'warning'); return; }
  if (!addWeight || addWeight <= 0) { showToast('续重单位必须大于0', 'warning'); return; }
  if (isNaN(addPrice) || addPrice < 0) { showToast('续重价格无效', 'warning'); return; }

  if (id) {
    const idx = shippingTemplates.findIndex(t => t.id === id);
    if (idx >= 0) {
      shippingTemplates[idx] = { ...shippingTemplates[idx], country, channel, currency, spec_type: specType, delivery_time: deliveryTime, first_weight: firstWeight, first_price: firstPrice, add_weight: addWeight, add_price: addPrice };
    }
  } else {
    shippingTemplates.push({
      id: 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      country, channel, currency, spec_type: specType, delivery_time: deliveryTime, first_weight: firstWeight, first_price: firstPrice, add_weight: addWeight, add_price: addPrice
    });
  }

  saveShippingTemplatesToStorage();
  closeModal('modal-shipping-tpl');
  renderShippingPage();
  showToast(id ? '已更新' : '已添加', 'success');
}

// ============ 订单自动报价 & 自动算运费 ============
function recalcOrderTotal() {
  let goodsTotalUSD = 0;
  const container = document.getElementById('order-items-container');
  if (!container) return;
  container.querySelectorAll('div[id^="item-row-"]').forEach(row => {
    const idx = row.id.replace('item-row-', '');
    const qty  = parseFloat(document.getElementById(`item-qty-${idx}`)?.value) || 0;
    const price = parseFloat(document.getElementById(`item-price-${idx}`)?.value) || 0;
    goodsTotalUSD += qty * price;
  });

  // 防护：汇率无效时重置为 1
  const rate = _orderExchangeRate || 1;
  if (!isFinite(rate) || rate <= 0) { _orderExchangeRate = 1; }

  const sym = curSym(_settlementCurrency);
  const goodsTotalCur = goodsTotalUSD / (_orderExchangeRate || 1); // 转为结算货币
  const gEl = document.getElementById('order-goods-total');
  if (gEl) gEl.textContent = `${sym}${goodsTotalCur.toFixed(2)}`;

  // 运费：用户填的是结算货币金额，需转为 USD 计算手续费
  const sFeeCur = parseFloat(document.getElementById('order-shipping-fee')?.value) || 0;
  const sFeeUSD = sFeeCur * (_orderExchangeRate || 1);
  const subtotalUSD = goodsTotalUSD + sFeeUSD;

  // 付款方式手续费（USD 计算，结果也转回结算货币）
  const method = document.getElementById('order-payment-method')?.value || '';
  const FEE_RATES = {
    bank_transfer: { rate: 0.025, fixed: 0 },
    paypal:        { rate: 0.044, fixed: 0.30 },
    wise:          { rate: 0.025, fixed: 0 },
    crypto:        { rate: 0.025, fixed: 0 }
  };
  const feeConfig = FEE_RATES[method];
  const handlingFeeUSD = feeConfig ? (subtotalUSD * feeConfig.rate + feeConfig.fixed) : 0;
  const handlingFeeCur = handlingFeeUSD / (_orderExchangeRate || 1);
  const hEl = document.getElementById('order-handling-fee');
  if (hEl) {
    if (feeConfig) {
      hEl.textContent = `-${sym}${handlingFeeCur.toFixed(2)}${feeConfig.fixed > 0 ? ` (含$${feeConfig.fixed}固定费)` : ''}（利润扣除）`;
      hEl.classList.remove('text-gray-400');
      hEl.classList.add('text-red-500');
    } else {
      hEl.textContent = method ? `-${sym}0.00（利润扣除）` : '请先选择付款方式';
      hEl.classList.remove('text-red-500');
      hEl.classList.add('text-gray-400');
    }
  }
  // 订单总额 = 货物 + 运费，不含手续费（手续费从利润扣）
  const grandTotalUSD = subtotalUSD;
  const grandTotalCur = grandTotalUSD / (_orderExchangeRate || 1);
  const totalCNY = grandTotalUSD * (_orderUsdToCny || 7.25);
  const tEl = document.getElementById('order-grand-total');
  if (tEl) tEl.textContent = `${_settlementCurrency} ${grandTotalCur.toFixed(2)}`;
  const cEl = document.getElementById('order-cny-total');
  if (cEl) cEl.textContent = `= ¥${totalCNY.toFixed(2)} CNY`;
}

async function autoQuoteOrder() {
  const container = document.getElementById('order-items-container');
  if (!container) return;
  const rows = container.querySelectorAll('div[id^="item-row-"]');
  if (rows.length === 0) { showToast('请先添加产品', 'warning'); return; }
  let filled = 0, skipped = 0;
  for (const row of rows) {
    const idx = row.id.replace('item-row-', '');
    const pid = document.getElementById(`item-product-${idx}`)?.value;
    if (!pid) continue;
    const product = allProducts.find(p => p.id === pid);
    if (!product) continue;

    // 匹配策略：SKU 精确匹配优先（一对一），再用 name/short_name 模糊匹配
    let hit = null;

    // 1. SKU 精确匹配（最可靠）
    if (product.sku) {
      const skuKw = normalizeStr(product.sku);
      const skuHit = QUOTE_PRODUCTS.find(p => normalizeStr(p.code) === skuKw);
      if (skuHit) hit = skuHit;
    }

    // 2. 产品名精确匹配 code（如 name="RT20" 直接匹配 code="RT20"）
    if (!hit) {
      const nameKw = normalizeStr(product.name);
      const codeHit = QUOTE_PRODUCTS.find(p => normalizeStr(p.code) === nameKw);
      if (codeHit) hit = codeHit;
    }

    // 3. short_name 精确匹配 code
    if (!hit && product.short_name) {
      const snKw = normalizeStr(product.short_name);
      const snHit = QUOTE_PRODUCTS.find(p => normalizeStr(p.code) === snKw);
      if (snHit) hit = snHit;
    }

    // 4. 模糊匹配（name/short_name），取第一个但记录警告
    if (!hit) {
      let matches = quoteFindByNameOrCode(product.name);
      if ((!matches || matches.length === 0) && product.short_name) {
        matches = quoteFindByNameOrCode(product.short_name);
      }
      if (matches && matches.length > 0) {
        hit = matches[0];
      }
    }

    if (!hit) { skipped++; continue; }
    const priceInput = document.getElementById(`item-price-${idx}`);
    if (priceInput) {
      priceInput.value = hit.price;
      filled++;
    }
  }
  recalcOrderTotal();
  if (filled > 0) {
    let msg = `已自动填充 ${filled} 个产品单价`;
    if (skipped > 0) msg += `，${skipped} 个未匹配`;
    showToast(msg, 'success');
  } else {
    showToast('未找到匹配报价，请手动输入单价', 'warning');
  }
}

async function autoCalcShipping() {
  // 强制从 Supabase/localStorage 加载最新模板
  await loadShippingTemplates();
  await loadWeightProducts();
  const country = document.getElementById('order-customer-country')?.value.trim();
  if (!country) { showToast('请先选择国家', 'warning'); return; }
  if (!isCountryAllowed(country)) {
    showToast(`"${country}"暂不支持邮寄，请更换国家`, 'warning'); return;
  }
  if (!shippingTemplates || shippingTemplates.length === 0) {
    showToast('未找到运费模板，请先在运费助手配置', 'warning'); return;
  }

  // 产品名称 → 重量库类别 映射规则
  function getWeightCategory(productName) {
    const n = (productName || '').toLowerCase();
    if (n.includes('acetic') || (n.includes('aa') && n.includes('3ml'))) return '3ML水';
    if (n.includes('bac') && (n.includes('wa3') || n.includes('ba3') || n.includes('3ml'))) return '3ML水';
    if (n.includes('bac') && (n.includes('wa10') || n.includes('ba10') || n.includes('10ml'))) return '10ML水';
    if (n.includes('nad') || n.includes('nj500') || n.includes('nj1000')) return '大冻干粉（NAD、HCG）10ML瓶';
    if (n.includes('glutathione') || n.includes('gtt1500')) return '大冻干粉（NAD、HCG）10ML瓶';
    return '冻干粉';
  }

  // 第一步：遍历订单项，构建每盒重量列表
  let totalVials = 0;
  let unmatchedProducts = [];
  const vialWeightList = [];
  const container = document.getElementById('order-items-container');
  container.querySelectorAll('div[id^="item-row-"]').forEach(row => {
    const idx = row.id.replace('item-row-', '');
    const pid = document.getElementById(`item-product-${idx}`)?.value;
    if (!pid) return;
    const product = allProducts.find(p => p.id === pid);
    if (!product) return;
    const category = getWeightCategory(product.name);
    const wp = weightProducts.find(w => w.type !== 'packaging' && w.name === category);
    if (!wp) {
      unmatchedProducts.push(product.name + `（需重量库有"${category}"）`);
      return;
    }
    const qty = parseInt(document.getElementById(`item-qty-${idx}`)?.value) || 0;
    const w = wp.gross_weight || wp.net_weight || 0;
    totalVials += qty;
    for (let i = 0; i < qty; i++) vialWeightList.push(w);
  });
  if (totalVials === 0) {
    const tip = unmatchedProducts.length > 0
      ? `请在产品重量库中添加以下类别：${unmatchedProducts.join('、')}`
      : '请在产品重量库中添加"冻干粉/3ML水/10ML水/大冻干粉"中的对应类别';
    showToast(tip, 'warning'); return;
  }

  // 第二步：自动选择外包装（找能装下的最小箱子，允许偏差5盒）
  const packagingList = weightProducts.filter(w => w.type === 'packaging' && (w.capacity || 0) > 0);
  if (packagingList.length === 0) {
    showToast('请先在产品重量库中添加外包装（需设置容量）', 'warning'); return;
  }
  packagingList.sort((a, b) => (a.capacity || 0) - (b.capacity || 0));
  let selectedPkg = packagingList.find(p => totalVials <= (p.capacity || 0) + 5);
  if (!selectedPkg) selectedPkg = packagingList[packagingList.length - 1];
  const boxCapacity = selectedPkg.capacity || 30;
  const pkgWeight = selectedPkg.gross_weight || selectedPkg.net_weight || 0;

  // 第三步：分箱（尽量少开箱，优先均分，约束：单箱重量 < 22KG）
  const MAX_BOX_WEIGHT = 21999;
  const TOLERANCE = 5; // 容量偏差：每箱最多可超装5盒

  // 先按重量排序，交叉分配（轻+重+轻+重）让每箱总重量尽量均衡
  const sorted = [...vialWeightList].sort((a, b) => a - b);
  const interleaved = [];
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) {
    if (lo === hi) { interleaved.push(sorted[lo]); break; }
    interleaved.push(sorted[lo++]);
    interleaved.push(sorted[hi--]);
  }

  // 从最少箱数开始尝试，每箱允许超装 TOLERANCE 盒，尽量少开箱
  let numBoxes = Math.ceil(totalVials / (boxCapacity + TOLERANCE));
  if (numBoxes < 1) numBoxes = 1;
  let boxes = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const baseQty = Math.floor(totalVials / numBoxes);
    let extra = totalVials % numBoxes;
    const shipments = [];
    let idx = 0;
    let valid = true;
    for (let b = 0; b < numBoxes; b++) {
      const qty = baseQty + (b < extra ? 1 : 0);
      if (qty > boxCapacity + TOLERANCE) { valid = false; break; }
      shipments.push(interleaved.slice(idx, idx + qty));
      idx += qty;
    }
    if (valid && shipments.length === numBoxes) {
      const allValid = shipments.every(ch =>
        ch.reduce((s, w) => s + w, 0) + pkgWeight <= MAX_BOX_WEIGHT
      );
      if (allValid) { boxes = shipments; break; }
    }
    numBoxes++;
  }

  // 降级：均分无法满足约束时退回到贪心算法
  if (boxes.length === 0) {
    boxes = [];
    let currentBox = [];
    let currentWeight = 0;
    for (const w of vialWeightList) {
      const wouldBeWeight = currentWeight + w + pkgWeight;
      if (currentBox.length >= boxCapacity + TOLERANCE || (currentBox.length > 0 && wouldBeWeight > MAX_BOX_WEIGHT)) {
        boxes.push(currentBox);
        currentBox = [];
        currentWeight = 0;
      }
      currentBox.push(w);
      currentWeight += w;
    }
    if (currentBox.length > 0) boxes.push(currentBox);
  }

  // 计算每箱实际重量（含箱子）
  const boxWeights = boxes.map(ch => ch.reduce((s, w) => s + w, 0) + pkgWeight);

  // 第四步：自动判断规格类型（大件/小件）
  let targetSpec = '';
  const isAustralia = country.includes('澳大利亚') || country.includes('澳洲');
  const isEurope = !isAustralia && isEuropeanCountry(country);
  if (isEurope) {
    // 欧洲：每箱重量 10-20KG → 大件（按平均每箱判断）
    const avgBoxWeight = boxWeights.reduce((s, w) => s + w, 0) / boxWeights.length;
    targetSpec = (avgBoxWeight >= 10000 && avgBoxWeight <= 20000) ? '大件' : '小件';
  } else if (isAustralia) {
    // 澳洲：总重量（含箱子）22-50KG → 大件
    const totalWeight = boxWeights.reduce((s, w) => s + w, 0);
    targetSpec = (totalWeight >= 22000 && totalWeight <= 50000) ? '大件' : '小件';
  }

  // 第五步：匹配运费模板（国家匹配 + 规格类型优先）
  console.log('[autoCalc] 订单国家:', JSON.stringify(country));
  console.log('[autoCalc] 所有模板:', shippingTemplates.map(t => t.country + '|' + (t.spec_type||'无')));
  let candidates = shippingTemplates.filter(t => {
    if (!t.country) return false;
    const match = t.country === country || t.country.startsWith(country) || country.startsWith(t.country) || t.country.includes(country) || country.includes(t.country);
    if (match) console.log('[autoCalc] 候选模板:', t.country, t.spec_type, t.channel);
    return match;
  });
  console.log('[autoCalc] 候选数:', candidates.length, 'targetSpec:', targetSpec);
  let tpl = null;
  if (targetSpec) {
    tpl = candidates.find(t => t.spec_type === targetSpec);
    if (!tpl) { tpl = candidates.find(t => !t.spec_type || t.spec_type === ''); console.log('[autoCalc] 未找到规格匹配，降级取无规格模板'); }
  }
  if (!tpl && candidates.length > 0) { tpl = candidates[0]; console.log('[autoCalc] 无规格要求，取第一个候选'); }
  if (!tpl) { showToast(`未找到"${country}"的运费模板（已有模板国家：` + shippingTemplates.map(t=>t.country).join('、') + `）`, 'warning'); return; }

  // 第六步：计费（每箱单独算首重+续重），原始币种为模板币种
  const tplCurrency = tpl.currency || 'USD';
  const firstW = tpl.first_unit_qty ?? tpl.first_weight ?? 0;
  const addW  = tpl.add_unit_qty ?? tpl.add_weight ?? 0;
  const firstP = tpl.first_price ?? 0;
  const addP  = tpl.add_price ?? 0;
  let totalFreightTpl = 0; // 模板币种的运费
  boxWeights.forEach(bw => {
    if (bw <= firstW) {
      totalFreightTpl += firstP;
    } else {
      const extraUnits = Math.ceil((bw - firstW) / addW);
      totalFreightTpl += firstP + extraUnits * addP;
    }
  });

  // 汇率换算：模板币种 → USD → 结算货币
  const rates = await getExchangeRates();
  const tplToUsd = tplCurrency === 'USD' ? 1 : (1 / (rates[tplCurrency] || 1));
  const totalFreightUSD = totalFreightTpl * tplToUsd;
  const totalFreightCur = totalFreightUSD / _orderExchangeRate;

  document.getElementById('order-shipping-fee').value = totalFreightCur.toFixed(2);
  recalcOrderTotal();
  const tplSym = curSym(tplCurrency);
  const curSymStr = curSym(_settlementCurrency);
  let msg = `运费估算：${tplSym}${totalFreightTpl.toFixed(2)}(${tplCurrency}) → ${curSymStr}${totalFreightCur.toFixed(2)}(${_settlementCurrency})`;
  msg += `（${tpl.country}·${tpl.channel}`;
  if (tpl.spec_type) msg += `·${tpl.spec_type}`;
  if (tpl.delivery_time) msg += `·${tpl.delivery_time}`;
  msg += `）`;
  msg += `；分${boxes.length}箱，用"${selectedPkg.name}"`;
  if (unmatchedProducts.length > 0) {
    msg += `；以下产品未匹配：${unmatchedProducts.join('、')}`;
    showToast(msg, 'warning');
  } else {
    showToast(msg, 'success');
  }
}

function curSym(currency) {
  return { USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', CNY: '¥', GBP: '£' }[currency] || currency;
}


// ============ 订单自动报价 & 自动算运费 结束 ============

function calcShipping() {
  const channelId = document.getElementById('ship-channel').value;

  if (!channelId) { showToast('请选择物流渠道', 'warning'); return; }
  if (shipEntries.length === 0) { showToast('请添加至少一个产品条目', 'warning'); return; }
  for (const e of shipEntries) {
    if (!e.productId) { showToast('请选择产品', 'warning'); return; }
  }

  // 自动选择外包装（和订单页 autoCalcShipping 同逻辑）
  const packagingList = weightProducts.filter(w => w.type === 'packaging' && (w.capacity || 0) > 0);
  if (packagingList.length === 0) { showToast('请先在产品重量库中添加外包装（需设置容量）', 'warning'); return; }
  packagingList.sort((a, b) => (a.capacity || 0) - (b.capacity || 0));

  // 展开所有盒
  let allBoxes = [];
  shipEntries.forEach(entry => {
    const p = weightProducts.find(x => x.id === entry.productId);
    if (!p) return;
    const w = p.gross_weight || p.net_weight || 0;
    for (let i = 0; i < entry.qty; i++) {
      allBoxes.push({ name: p.name, weight: w });
    }
  });
  const totalBoxes = allBoxes.length;

  // 找能装下的最小箱子（允许偏差5盒）
  let selectedPkg = packagingList.find(p => totalBoxes <= (p.capacity || 0) + 5);
  if (!selectedPkg) selectedPkg = packagingList[packagingList.length - 1];
  const boxCapacity = selectedPkg.capacity || 30;
  const pkgWeight = selectedPkg.gross_weight || selectedPkg.net_weight || 0;

  const tpl = shippingTemplates.find(t => t.id === channelId);
  if (!tpl) { showToast('渠道不存在', 'error'); return; }

  const sym = curSym(tpl.currency || 'USD');
  const firstW = tpl.first_unit_qty ?? tpl.first_weight ?? 0;
  const addW = tpl.add_unit_qty ?? tpl.add_weight ?? 0;

  // 分箱：尽量少开箱，允许每箱超装5盒，约束单箱重量 < 22KG
  const TOLERANCE = 5;
  const MAX_BOX_WEIGHT = 21999;

  // 按重量排序，交叉分配让每箱均衡
  const sortedItems = [...allBoxes].sort((a, b) => a.weight - b.weight);
  const interleaved = [];
  let lo = 0, hi = sortedItems.length - 1;
  while (lo <= hi) {
    if (lo === hi) { interleaved.push(sortedItems[lo]); break; }
    interleaved.push(sortedItems[lo++]);
    interleaved.push(sortedItems[hi--]);
  }

  let numBoxes = Math.ceil(totalBoxes / (boxCapacity + TOLERANCE));
  if (numBoxes < 1) numBoxes = 1;
  let shipments = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const baseQty = Math.floor(totalBoxes / numBoxes);
    let extra = totalBoxes % numBoxes;
    const tmpShipments = [];
    let idx = 0;
    let valid = true;
    for (let b = 0; b < numBoxes; b++) {
      const qty = baseQty + (b < extra ? 1 : 0);
      if (qty > boxCapacity + TOLERANCE) { valid = false; break; }
      tmpShipments.push(interleaved.slice(idx, idx + qty));
      idx += qty;
    }
    if (valid && tmpShipments.length === numBoxes) {
      const allValid = tmpShipments.every(ch =>
        ch.reduce((s, b) => s + b.weight, 0) + pkgWeight <= MAX_BOX_WEIGHT
      );
      if (allValid) { shipments = tmpShipments; break; }
    }
    numBoxes++;
  }

  // 降级：贪心算法
  if (shipments.length === 0) {
    shipments = [];
    let currentBox = [];
    let currentWeight = 0;
    for (const item of allBoxes) {
      const wouldBeWeight = currentWeight + item.weight + pkgWeight;
      if (currentBox.length >= boxCapacity + TOLERANCE || (currentBox.length > 0 && wouldBeWeight > MAX_BOX_WEIGHT)) {
        shipments.push(currentBox);
        currentBox = [];
        currentWeight = 0;
      }
      currentBox.push(item);
      currentWeight += item.weight;
    }
    if (currentBox.length > 0) shipments.push(currentBox);
  }

  // 逐箱计费
  let totalFreight = 0;
  let detailLines = [];
  const pkgName = selectedPkg.name;
  detailLines.push(`共 ${totalBoxes} 盒，分 ${shipments.length} 箱（每箱≤${boxCapacity + TOLERANCE}盒，外包装：${pkgName}）`);

  shipments.forEach((boxes, bIdx) => {
    const productWeight = boxes.reduce((s, b) => s + b.weight, 0);
    const weight = productWeight + pkgWeight;
    let freight = 0;
    if (weight <= firstW) {
      freight = tpl.first_price;
    } else {
      const extraUnits = Math.ceil((weight - firstW) / addW);
      freight = tpl.first_price + extraUnits * tpl.add_price;
    }
    totalFreight += freight;
    detailLines.push(`箱${bIdx + 1}（${boxes.length}盒 / ${weight.toFixed(1)}g）：${sym}${freight.toFixed(2)}`);
  });

  detailLines.push(`合计运费：${sym}${totalFreight.toFixed(2)}`);
  document.getElementById('ship-result-price').textContent = sym + totalFreight.toFixed(2);
  document.getElementById('ship-result-detail').innerHTML = detailLines.map(l => `<p>${esc(l)}</p>`).join('') +
    `<p class="mt-1 text-xs text-gray-400">${esc(tpl.country)} · ${esc(tpl.channel)} · ${tpl.currency || 'USD'}</p>`;
  // 保存本次结果，供汇率换算使用
  lastShipTotal = totalFreight;
  lastShipCurrency = tpl.currency || 'USD';
  document.getElementById('ship-currency-wrap').classList.remove('hidden');
  showToast(`总运费：${sym}${totalFreight.toFixed(2)}`, 'success');
}

function toggleShipCurrencyDropdown() {
  const dd = document.getElementById('ship-currency-dropdown');
  if (dd.classList.contains('hidden')) {
    // 展开：直接显示，无延迟
    dd.classList.remove('hidden');
    const close = (e) => {
      if (!document.getElementById('ship-currency-wrap').contains(e.target)) {
        dd.classList.add('hidden');
        document.removeEventListener('click', close);
      }
    };
    // 用 requestAnimationFrame 确保下拉已渲染后再监听点击，避免卡顿感
    requestAnimationFrame(() => document.addEventListener('click', close));
  } else {
    dd.classList.add('hidden');
  }
}

async function appendShipCurrency(currency) {
  document.getElementById('ship-currency-dropdown').classList.add('hidden');
  if (!lastShipTotal || lastShipTotal <= 0) { showToast('请先核算运费', 'warning'); return; }
  const rates = await getExchangeRates();
  const rate = rates[currency];
  if (!rate) { showToast('汇率获取失败', 'error'); return; }
  const symbols = { EUR: '€', AUD: 'A$', CAD: 'C$', CNY: '¥', GBP: '£' };
  const sym = symbols[currency] || '';
  // 将 lastShipTotal 从 lastShipCurrency 转换到 target currency
  let targetAmount;
  if (lastShipCurrency === 'USD') {
    targetAmount = lastShipTotal * rate;
  } else {
    const srcRate = rates[lastShipCurrency];
    if (!srcRate) { showToast('源币种汇率缺失', 'error'); return; }
    const usdAmount = lastShipTotal / srcRate;
    targetAmount = usdAmount * rate;
  }
  const detail = document.getElementById('ship-result-detail');
  detail.querySelectorAll('.ship-converted').forEach(el => el.remove());
  // 构建复制文本：运费=XXUSD=A$XX
  const srcSymbol = { USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', CNY: '¥', GBP: '£' }[lastShipCurrency] || '';
  const copyText = `运费=${srcSymbol}${lastShipTotal.toFixed(2)}${lastShipCurrency}=${sym}${targetAmount.toFixed(2)}`;
  // 创建带复制按钮的结果行
  const wrap = document.createElement('div');
  wrap.className = 'ship-converted mt-1 pt-1 border-t border-orange-100 flex items-center gap-2';
  const span = document.createElement('span');
  span.className = 'text-xs text-orange-700 font-medium';
  span.textContent = copyText;
  const btn = document.createElement('button');
  btn.className = 'text-xs px-2 py-0.5 rounded bg-orange-100 hover:bg-orange-200 text-orange-700 font-medium cursor-pointer';
  btn.textContent = '复制';
  btn.onclick = () => {
    navigator.clipboard.writeText(copyText).then(() => showToast('已复制', 'success')).catch(() => {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = copyText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('已复制', 'success');
    });
  };
  wrap.appendChild(span);
  wrap.appendChild(btn);
  detail.appendChild(wrap);
  showToast(`已换算（1 USD = ${sym}${rate.toFixed(4)}）`, 'success');
}

window.addEventListener('DOMContentLoaded', init);
