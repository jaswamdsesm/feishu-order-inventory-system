// 飞书群报价机器人 Edge Function
// 处理：消息事件回调 → 解析指令 → 查询报价+运费 → 回复飞书卡片
// 版本: 20260516b - 重量明细按产品分别显示
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const FEISHU_APP_ID = Deno.env.get('FEISHU_BOT_APP_ID') || '';
const FEISHU_APP_SECRET = Deno.env.get('FEISHU_BOT_APP_SECRET') || '';
const FEISHU_VERIFICATION_TOKEN = Deno.env.get('FEISHU_VERIFICATION_TOKEN') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
// 飞书 API 基地址
const FEISHU_API = 'https://open.feishu.cn/open-apis';
// 货币符号映射
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  AUD: 'A$',
  CAD: 'C$',
  CNY: '¥',
  GBP: '£'
};
// ========== 实时汇率 ==========
let _ratesCache = null;
let _ratesCacheTime = 0;
const RATES_CACHE_TTL = 30 * 60 * 1000; // 30 分钟缓存
async function getExchangeRates() {
  const now = Date.now();
  if (_ratesCache && now < _ratesCacheTime) return _ratesCache;
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await resp.json();
    if (data?.rates) {
      _ratesCache = data.rates; // { EUR: 0.92, AUD: 1.53, CNY: 7.25, ... }
      _ratesCacheTime = now + RATES_CACHE_TTL;
      return _ratesCache;
    }
  } catch (e) {
    console.warn('汇率获取失败', e);
  }
  return _ratesCache || {
    EUR: 0.92,
    AUD: 1.53,
    CAD: 1.36,
    CNY: 7.25,
    GBP: 0.79
  };
}
// USD 金额 → 目标币种
function usdToCurrency(usd, rates, targetCurrency) {
  if (!targetCurrency || targetCurrency === 'USD') return usd;
  const r = rates[targetCurrency];
  if (!r) return usd;
  return usd * r; // rates 里是 1 USD = X CNY，所以 USD→CNY = usd * rate
}
// 国家别名映射（支持模糊匹配）
const COUNTRY_ALIASES = {
  // 大洋洲
  '澳洲': '澳大利亚', '澳大利亚': '澳大利亚', '新西兰': '新西兰', 'nz': '新西兰',
  // 北美
  '美国': '美国', 'usa': '美国', 'us': '美国', '加拿大': '加拿大', 'ca': '加拿大',
  // 欧洲
  '英国': '英国', 'uk': '英国', '爱尔兰': '爱尔兰', 'ireland': '爱尔兰',
  '德国': '德国', 'germany': '德国', 'de': '德国',
  '法国': '法国', 'france': '法国', 'fr': '法国',
  '意大利': '意大利', 'italy': '意大利', 'it': '意大利',
  '西班牙': '西班牙', 'spain': '西班牙', 'es': '西班牙',
  '荷兰': '荷兰', 'netherlands': '荷兰', 'nl': '荷兰',
  '比利时': '比利时', 'belgium': '比利时', 'be': '比利时',
  '奥地利': '奥地利', 'austria': '奥地利', 'at': '奥地利',
  '瑞士': '瑞士', 'switzerland': '瑞士', 'ch': '瑞士',
  '瑞典': '瑞典', 'sweden': '瑞典', 'se': '瑞典',
  '丹麦': '丹麦', 'denmark': '丹麦', 'dk': '丹麦',
  '挪威': '挪威', 'norway': '挪威',
  '芬兰': '芬兰', 'finland': '芬兰',
  '波兰': '波兰', 'poland': '波兰',
  '葡萄牙': '葡萄牙', 'portugal': '葡萄牙',
  '希腊': '希腊', 'greece': '希腊',
  '捷克': '捷克', 'czech': '捷克',
  '匈牙利': '匈牙利', 'hungary': '匈牙利',
  '罗马尼亚': '罗马尼亚', 'romania': '罗马尼亚',
  '卢森堡': '卢森堡', 'luxembourg': '卢森堡',
  // 亚洲
  '日本': '日本', 'japan': '日本', 'jp': '日本',
  '韩国': '韩国', 'korea': '韩国', 'kr': '韩国',
  '新加坡': '新加坡', 'singapore': '新加坡', 'sg': '新加坡',
  '马来西亚': '马来西亚', 'malaysia': '马来西亚', 'my': '马来西亚',
  '泰国': '泰国', 'thailand': '泰国', 'th': '泰国',
  '菲律宾': '菲律宾', 'philippines': '菲律宾', 'ph': '菲律宾',
  '印度': '印度', 'india': '印度',
  '印尼': '印度尼西亚', '印度尼西亚': '印度尼西亚', 'indonesia': '印度尼西亚',
  '越南': '越南', 'vietnam': '越南',
  // 中东
  '阿联酋': '阿联酋', 'uae': '阿联酋', '沙特': '沙特阿拉伯', '沙特阿拉伯': '沙特阿拉伯',
};
// 币种别名
const CURRENCY_ALIASES = {
  '澳元': 'AUD',
  'aud': 'AUD',
  '澳大利亚元': 'AUD',
  '美元': 'USD',
  'usd': 'USD',
  '美金': 'USD',
  '欧元': 'EUR',
  'eur': 'EUR',
  '英镑': 'GBP',
  'gbp': 'GBP',
  '加元': 'CAD',
  'cad': 'CAD',
  '加拿大元': 'CAD',
  '人民币': 'CNY',
  'cny': 'CNY',
  'rmb': 'CNY'
};
// ========== 飞书 API 工具函数 ==========
let _tokenCache = null;
const _processedEvents = new Set();
const _processedMessages = new Set();
// 每 5 分钟清理一次已处理事件缓存，防止内存泄漏
setInterval(()=>{
  _processedEvents.clear();
  _processedMessages.clear();
}, 5 * 60 * 1000);
async function getAppAccessToken() {
  if (_tokenCache && Date.now() < _tokenCache.expire) return _tokenCache.token;
  const resp = await fetch(`${FEISHU_API}/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET
    })
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`获取 app_access_token 失败: ${data.msg}`);
  _tokenCache = {
    token: data.app_access_token,
    expire: Date.now() + (data.expire - 60) * 1000
  };
  return _tokenCache.token;
}
async function replyCard(messageId, card) {
  const token = await getAppAccessToken();
  const resp = await fetch(`${FEISHU_API}/im/v1/messages/${messageId}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      content: JSON.stringify(card),
      msg_type: 'interactive'
    })
  });
  const data = await resp.json();
  if (data.code !== 0) console.error('回复消息失败:', data);
  return data;
}
async function getAllQuoteProducts() {
  const { data, error } = await supabase.from('quote_products').select('id,name,code,spec,price').order('name');
  if (error) throw new Error('查询报价产品失败: ' + error.message);
  return data || [];
}
async function getShippingTemplates() {
  const { data, error } = await supabase.from('shipping_templates').select('*');
  if (error) throw new Error('查询运费模板失败: ' + error.message);
  return data || [];
}
async function getWeightProducts() {
  const { data, error } = await supabase.from('weight_products').select('*');
  if (error) throw new Error('查询产品重量失败: ' + error.message);
  return data || [];
}
function normalizeStr(s) {
  return s.toLowerCase().replace(/[-_\s.+]/g, '').replace(/（/g, '(').replace(/）/g, ')');
}
function parseCommand(text) {
  // 去掉 @机器人 部分
  let clean = text.replace(/@\S+\s*/g, '').trim();
  // 去掉首尾空白和标点
  clean = clean.replace(/^[：:，,。.！!\s]+|[：:，,。.！!\s]+$/g, '').trim();
  if (!clean) return {
    items: []
  };
  const result = {
    items: []
  };
  // 检查是否是结构化模式（包含 产品: xxx 或 关键字:xxx）
  const isStructured = /产品[:：]|数量[:：]|国家[:：]|币种[:：]|country[:：]|currency[:：]/i.test(clean);
  if (isStructured) {
    return parseStructured(clean);
  }
  return parseFreeform(clean);
}
function parseStructured(text) {
  const result = {
    items: []
  };
  // 提取国家
  const countryMatch = text.match(/国家[:：]\s*(.+)/i) || text.match(/country[:：]\s*(.+)/i);
  if (countryMatch) result.country = countryMatch[1].trim();
  // 提取币种
  const currencyMatch = text.match(/币种[:：]\s*(.+)/i) || text.match(/currency[:：]\s*(.+)/i);
  if (currencyMatch) {
    const raw = currencyMatch[1].trim().toUpperCase();
    result.currency = CURRENCY_ALIASES[raw] || raw;
  }
  // 提取产品（可能有多个）
  const productMatches = [
    ...text.matchAll(/产品[:：]\s*(\S+)(?:\s+数量[:：]\s*(\d+))?/gi)
  ];
  for (const m of productMatches){
    result.items.push({
      keyword: m[1],
      quantity: parseInt(m[2]) || 1
    });
  }
  // 如果没有匹配到"产品:xxx"格式，尝试从剩余文本解析
  if (result.items.length === 0) {
    // 去掉已识别的字段
    let remaining = text.replace(/国家[:：].+/gi, '').replace(/币种[:：].+/gi, '').replace(/数量[:：]\s*\d+/gi, '').replace(/产品[:：]/gi, '').trim();
    if (remaining) {
      // 按空格/逗号拆分
      const parts = remaining.split(/[\s,，、;；]+/).filter(Boolean);
      let i = 0;
      while(i < parts.length){
        const keyword = parts[i];
        const nextNum = i + 1 < parts.length && /^\d+$/.test(parts[i + 1]) ? parseInt(parts[i + 1]) : 1;
        if (nextNum > 1) i++;
        result.items.push({
          keyword,
          quantity: nextNum
        });
        i++;
      }
    }
  }
  return result;
}
function parseFreeform(text) {
  const result = {
    items: []
  };
  const parts = text.split(/[\s,，、;；]+/).filter(Boolean);
  // 预处理1：拆分 "WATER3ML" → "WATER" "3ML"，"BPC10MG" → "BPC" "10MG"
  // 只拆分 "字母+数字+单位(mg/iu/ml/mcg/g)" 模式，避免误拆 "Reta20"
  const splitParts = [];
  for (const p of parts) {
    // 先检查 "数字+盒+产品名" 模式（优先级最高）
    const qtyBoxMatch = p.match(/^(\d+)\s*(盒|box|boxes|pcs|set|vials?)\s*(.+)$/i);
    if (qtyBoxMatch) {
      splitParts.push(p); // 留给下一步处理
      continue;
    }
    // 拆分 "字母+数字+单位" → "字母" "数字+单位"
    const specAttached = p.match(/^([A-Za-z\u4e00-\u9fff]+)(\d+\s*(?:mg|iu|ml|mcg|g))$/i);
    if (specAttached) {
      splitParts.push(specAttached[1]);
      splitParts.push(specAttached[2]);
    } else {
      splitParts.push(p);
    }
  }
  // 预处理2：拆分 "5盒GHK" → "5盒" "GHK"，"3boxBPC" → "3box" "BPC"
  // 并重排 "5盒 GHK 50" → "GHK 50 5盒"（产品名+规格+数量）
  const expanded = [];
  for (let pi = 0; pi < splitParts.length; pi++) {
    const p = splitParts[pi];
    const qtyBoxMatch = p.match(/^(\d+)\s*(盒|box|boxes|pcs|set|vials?)\s*(.+)$/i);
    if (qtyBoxMatch) {
      // "5盒GHK" → 暂存数量 5盒，产品名 GHK 留到下一步
      const qtyStr = qtyBoxMatch[1] + qtyBoxMatch[2]; // "5盒"
      const restName = qtyBoxMatch[3];                  // "GHK"
      // 检查紧跟的下一个 part 是否是纯数字（规格，如 50）
      const nextPart = pi + 1 < splitParts.length ? splitParts[pi + 1] : null;
      if (nextPart && /^\d+$/.test(nextPart)) {
        // "5盒GHK 50" → "GHK 50" "5盒"
        expanded.push(restName);
        expanded.push(nextPart);  // 规格数字
        expanded.push(qtyStr);    // 数量
        pi++; // 跳过 nextPart
      } else {
        // "5盒GHK"（后面没规格数字）→ "GHK" "5盒"
        expanded.push(restName);
        expanded.push(qtyStr);
      }
    } else {
      expanded.push(p);
    }
  }
  let i = 0;
  // 预合并：将 "产品名 [产品名] 规格MG 数量" 模式合并为单个 keyword+qty
  // 例如 "BPC 10MG 8" → ["BPC 10MG", "8"]
  //       "BAC WATER 3ml 2盒" → ["BAC WATER 3ml", "2盒"]
  const merged = [];
  while(i < expanded.length){
    const part = expanded[i];
    const lower = part.toLowerCase();
    // 检查国家/币种不做合并
    if (COUNTRY_ALIASES[part] || COUNTRY_ALIASES[lower]) {
      merged.push(part);
      i++;
      continue;
    }
    if (CURRENCY_ALIASES[part] || CURRENCY_ALIASES[lower] || /^[A-Z]{3}$/.test(part)) {
      const mapped = CURRENCY_ALIASES[part] || CURRENCY_ALIASES[lower] || part.toUpperCase();
      if ([
        'USD',
        'EUR',
        'AUD',
        'CAD',
        'CNY',
        'GBP'
      ].includes(mapped)) {
        merged.push(part);
        i++;
        continue;
      }
    }
    // 检查下一个部分是否是规格（数字+mg/iu/ml/mcg/g，或后面紧跟"数字+盒"的纯数字）
    let isSpecPart = false;
    let specPart = '';
    if (i + 1 < expanded.length) {
      if (/^\d+\s*(?:mg|iu|ml|mcg|g)$/i.test(expanded[i + 1])) {
        isSpecPart = true;
        specPart = expanded[i + 1];
      } else if (/^\d+$/.test(expanded[i + 1]) && i + 2 < expanded.length && /^(\d+)\s*(盒|box|boxes|pcs|set|vials?)$/i.test(expanded[i + 2])) {
        // "GHK 50 5盒"：纯数字50后面跟着"5盒"，50是规格
        isSpecPart = true;
        specPart = expanded[i + 1];
      }
    }
    if (isSpecPart) {
      const afterSpec = i + 2 < expanded.length ? expanded[i + 2] : null;
      let qtyPart = null;
      let advance = 2;
      if (afterSpec && /^(\d+)\s*(盒|box|pcs|set|vials?)?$/i.test(afterSpec)) {
        qtyPart = afterSpec;
        advance = 3;
      } else if (afterSpec && /^\d+$/.test(afterSpec)) {
        qtyPart = afterSpec;
        advance = 3;
      }
      // 回溯：如果 merged 最后一个元素不是数量/国家/币种，把它合并进来
      // 例：merged=["BAC"]，当前 part="WATER"，则合并为 "BAC WATER 3ml"
      let keyword = part + ' ' + specPart;
      if (merged.length > 0) {
        const lastMerged = merged[merged.length - 1];
        const lastLower = lastMerged.toLowerCase();
        const isQty = /^(\d+)\s*(盒|box|pcs|set|vials?)?$/i.test(lastMerged);
        const isCountry = COUNTRY_ALIASES[lastMerged] || COUNTRY_ALIASES[lastLower];
        const isCurrency = (()=>{
          const m = CURRENCY_ALIASES[lastMerged] || CURRENCY_ALIASES[lastLower];
          return m && [
            'USD',
            'EUR',
            'AUD',
            'CAD',
            'CNY',
            'GBP'
          ].includes(m);
        })();
        if (!isQty && !isCountry && !isCurrency) {
          keyword = lastMerged + ' ' + keyword;
          merged.pop();
        }
      }
      merged.push(keyword);
      if (qtyPart) merged.push(qtyPart);
      i += advance;
      continue;
    }
    merged.push(part);
    i++;
  }
  i = 0;
  while(i < merged.length){
    const part = merged[i];
    const lower = part.toLowerCase();
    // 检查是否是国家
    if (!result.country && (COUNTRY_ALIASES[part] || COUNTRY_ALIASES[lower])) {
      result.country = COUNTRY_ALIASES[part] || COUNTRY_ALIASES[lower];
      i++;
      continue;
    }
    // 检查是否是币种
    if (!result.currency && (CURRENCY_ALIASES[part] || CURRENCY_ALIASES[lower] || /^[A-Z]{3}$/.test(part))) {
      const mapped = CURRENCY_ALIASES[part] || CURRENCY_ALIASES[lower] || part.toUpperCase();
      if ([
        'USD',
        'EUR',
        'AUD',
        'CAD',
        'CNY',
        'GBP'
      ].includes(mapped)) {
        result.currency = mapped;
        i++;
        continue;
      }
    }
    // 检查是否是"算运费"之类的指令后缀
    if (/运费|shipping|计算/.test(part) && result.items.length > 0) {
      i++;
      continue;
    }
    // 当作产品处理
    // 先检查当前 part 本身是否是"数量+盒"格式（如"5盒"来自预处理拆分）
    // 如果是，它修饰的是后面的产品名，peek 下一项
    if (/^(\d+)\s*(盒|box|boxes|pcs|set|vials?)$/i.test(part)) {
      const qtyNum = parseInt(part.match(/^(\d+)/)[1]);
      // 看下一项是否是产品名（不是国家/币种/数量/指令）
      const nextPart = i + 1 < merged.length ? merged[i + 1] : null;
      if (nextPart) {
        const nextLower = nextPart.toLowerCase();
        const nextIsCountry = COUNTRY_ALIASES[nextPart] || COUNTRY_ALIASES[nextLower];
        const nextIsQty = /^(\d+)\s*(盒|box|boxes|pcs|set|vials?)?$/i.test(nextPart);
        const nextIsSpec = /^\d+\s*(?:mg|iu|ml|mcg|g)$/i.test(nextPart);
        if (!nextIsCountry && !nextIsQty && !nextIsSpec) {
          // 下一项是产品名，跳过当前数量，让产品处理时自己拿不到 qty 就默认 1
          // 我们把它改成：先存下 qty，下一轮产品处理时用
          result.items.push({ keyword: nextPart, quantity: qtyNum });
          i += 2;
          continue;
        }
      }
      // 无法绑定到下一个产品，跳过这个孤立的数量标记
      i++;
      continue;
    }
    let keyword = part;
    // 看下一个是不是数量
    let qty = 1;
    if (i + 1 < merged.length) {
      const qtyMatch = merged[i + 1].match(/^(\d+)\s*(盒|box|pcs|set)?$/i);
      if (qtyMatch) {
        qty = parseInt(qtyMatch[1]);
        i++;
      }
    }
    // 如果当前没有数量且前面一个 item 是同产品（keyword 不同但都是产品名片段），合并数量
    // 典型场景："BAC" qty=1, "WATER 3ml" qty=2 → 都是 BAC Water，应合并为 qty=3
    // 这个去重在匹配阶段处理（见 handleMassage），这里先都 push
    result.items.push({
      keyword,
      quantity: qty
    });
    i++;
  }
  return result;
}
// ========== 产品匹配 ==========
// 产品名称别名映射（支持用户常见输入变体）
const PRODUCT_ALIASES = {
  'retatrutide': [
    'reta',
    'retra',
    're',
    'rt'
  ],
  'tirzepatide': [
    'tirz',
    'tr',
    'trz'
  ],
  'semaglutide': [
    'sema',
    'semaglu',
    'sm'
  ],
  'cagrilintide': [
    'cagr',
    'cgl'
  ],
  'mazdutide': [
    'mazd',
    'mdt'
  ],
  '5amino1mq': [
    '5amino',
    '5am',
    'am'
  ],
  'slupp332': [
    'slu',
    '332'
  ],
  'adipotide': [
    'adipo',
    'ap'
  ],
  'ghkcu': [
    'ghk',
    'cu'
  ],
  'ahkcu': [
    'ahk'
  ],
  'snap8': [
    'snap'
  ],
  'melanotani': [
    'mt1'
  ],
  'melanotanii': [
    'mt2'
  ],
  'glutathione': [
    'gtt'
  ],
  'll37': [
    'll'
  ],
  'selank': [
    'sk'
  ],
  'semax': [
    'xa'
  ],
  'dsip': [
    'ds'
  ],
  'vip': [
    'vip'
  ],
  'oxytocin': [
    'ot'
  ],
  'nad': [
    'nj'
  ],
  'thymosinalpha1': [
    'ta'
  ],
  'ss31': [
    '2s'
  ],
  'thymalin': [
    'ty'
  ],
  'bpc157': [
    'bpc'
  ],
  'ipamorelin': [
    'ipa',
    'ip'
  ],
  'tb500': [
    'tb'
  ],
  'tesamorelin': [
    'tsm'
  ],
  'sermorelin': [
    'smo'
  ],
  'gonadorelin': [
    'gnd'
  ],
  'hexarelin': [
    'hx'
  ],
  'ghrp2': [
    'g2'
  ],
  'ghrp6': [
    'g6'
  ],
  'cjc1295withoutdac': [
    'cnd',
    'cjcno'
  ],
  'cjc1295withdac': [
    'cd',
    'cjc'
  ],
  'hgh191aa': [
    'hgh',
    'h'
  ],
  'aod9604': [
    'aod',
    'ad'
  ],
  'igf1lr3': [
    'igf'
  ],
  'hcg': [
    'hcg'
  ],
  'kpv': [
    'kp'
  ],
  'pt141': [
    'p41'
  ],
  'epithalon': [
    'epi',
    'epitalon'
  ],
  'pinealon': [
    'pn'
  ],
  'bronchogen': [
    'br'
  ],
  'cardiogen': [
    'crg'
  ],
  'ara290': [
    'ra'
  ],
  'kisspeptin1': [
    'ks'
  ],
  'kisspeptin10': [
    'ks'
  ],
  'motsc': [
    'ms'
  ],
  'bpc157tb500': [
    'bb'
  ],
  'bpc157tb500ghkkpv': [
    'klow'
  ],
  'bpc157tb500ghk': [
    'bbg'
  ],
  'cagrilintidesemaglutide': [
    'cs'
  ],
  'lipoc': [
    'lc'
  ],
  'superhumanblend': [
    'shb'
  ],
  'healthyhairskinnails': [
    'hhb'
  ],
  'relaxatlonpm': [
    'rp'
  ],
  'cjc1295nodacipa': [
    'cp'
  ],
  'lemonbottle': [
    'lemon'
  ],
  'bacwater': [
    'wa'
  ],
  'aceticacid06': [
    'aa'
  ],
  'lcarnitine600mg': [
    'lc'
  ],
  'b12': [
    'b12'
  ]
};
function findProduct(products, keyword) {
  let kw = normalizeStr(keyword);
  if (!kw) return null;
  // 0a. 剥离尾部规格单位（如 "bpc10mg" → "bpc10"，"reta20mg" → "reta20"）
  const specUnitMatch = kw.match(/(\d+)\s*(mg|iu|ml|mcg|g)\s*$/);
  if (specUnitMatch) {
    kw = kw.substring(0, kw.length - specUnitMatch[0].length);
  }
  // 0b. 提取可能的数字后缀（如 reta10 → reta + 10）
  const numMatch = kw.match(/^(\D+)(\d+)$/);
  const kwBase = numMatch ? numMatch[1] : kw;
  const kwNum = numMatch ? numMatch[2] : '';
  const specNum = specUnitMatch ? parseInt(specUnitMatch[1]) : null;
  console.log(`[findProduct] kw="${keyword}" → normalized="${kw}" kwBase="${kwBase}" kwNum="${kwNum}" specNum=${specNum}`);
  // 1. 代码完全匹配
  let hit = products.find((p)=>normalizeStr(p.code) === kw);
  if (hit) { console.log(`[findProduct] 命中@代码完全匹配: ${hit.code}(${hit.spec})`); return hit; }
  // 2. 名称完全匹配
  hit = products.find((p)=>normalizeStr(p.name) === kw);
  if (hit) { console.log(`[findProduct] 命中@名称完全匹配: ${hit.code}(${hit.spec})`); return hit; }
  // 3. 代码前缀匹配（有 specNum 时优先按 spec 筛选）
  let codePrefixHits = products.filter((p)=>normalizeStr(p.code).startsWith(kw));
  if (codePrefixHits.length > 0) {
    if (specNum !== null) {
      const specHit = codePrefixHits.find((p)=>{
        const firstNum = (p.spec || '').match(/(\d+)/);
        return firstNum && parseInt(firstNum[1]) === specNum;
      });
      if (specHit) { console.log(`[findProduct] 命中@代码前缀+spec匹配: ${specHit.code}(${specHit.spec})`); return specHit; }
    }
    if (kwNum) {
      const codeHit = codePrefixHits.find((p) => {
        const codeNum = normalizeStr(p.code).match(/(\d+)/);
        return codeNum && codeNum[1] === kwNum;
      });
      if (codeHit) { console.log(`[findProduct] 命中@代码前缀+codeNum匹配: ${codeHit.code}(${codeHit.spec})`); return codeHit; }
    }
    hit = codePrefixHits[0];
    console.log(`[findProduct] 命中@代码前缀匹配(默认): ${hit.code}(${hit.spec})`);
    return hit;
  }
  // 4. 名称前缀匹配
  const namePrefixHits = products.filter((p)=>normalizeStr(p.name).startsWith(kwBase) || normalizeStr(p.name).startsWith(kw));
  if (namePrefixHits.length > 0) {
    // 优先按规格数字精确匹配
    if (specNum !== null) {
      const specHit = namePrefixHits.find((p)=>{
        const firstNum = (p.spec || '').match(/(\d+)/);
        return firstNum && parseInt(firstNum[1]) === specNum;
      });
      if (specHit) return specHit;
    }
    // 再按代码数字精确匹配（如 reta5 → kwNum="5" → 匹配 RT5 而非 RT10/RT15）
    if (kwNum) {
      const codeHit = namePrefixHits.find((p) => {
        const codeNum = normalizeStr(p.code).match(/(\d+)/);
        return codeNum && codeNum[1] === kwNum;
      });
      if (codeHit) return codeHit;
    }
    return namePrefixHits[0];
  }
  // 5. 代码包含
  hit = products.find((p)=>normalizeStr(p.code).includes(kw));
  if (hit) return hit;
  // 6. 名称包含
  hit = products.find((p)=>normalizeStr(p.name).includes(kw));
  if (hit) return hit;
  // 7. 别名匹配：用户输入 reta10 → 匹配所有 Retatrutide 产品，再按数字筛选
  if (numMatch || specNum !== null) {
    // 先找 kwBase 对应的标准名称
    let matchedName = null;
    for (const [name, aliases] of Object.entries(PRODUCT_ALIASES)){
      if (aliases.includes(kwBase) || name.startsWith(kwBase) || name.includes(kwBase)) {
        matchedName = name;
        break;
      }
      // 别名本身也可能是部分匹配
      for (const alias of aliases){
        if (kwBase.startsWith(alias) || alias.startsWith(kwBase)) {
          matchedName = name;
          break;
        }
      }
      if (matchedName) break;
    }
    if (matchedName) {
      // 在所有产品中找名称匹配的产品
      const candidates = products.filter((p)=>{
        const n = normalizeStr(p.name).replace(/[^a-z0-9]/g, '');
        return n === matchedName || n.startsWith(matchedName) || matchedName.startsWith(n);
      });
      // 优先按规格数字（spec 字段）匹配
      if (specNum !== null) {
        const specHit = candidates.find((p)=>{
          const firstNum = (p.spec || '').match(/(\d+)/);
          return firstNum && parseInt(firstNum[1]) === specNum;
        });
        if (specHit) return specHit;
      }
      // 按代码数字精确匹配（避免 "5" 子串匹配到 RT15）
      if (kwNum) {
        hit = candidates.find((p) => {
          const codeNum = normalizeStr(p.code).match(/(\d+)/);
          return codeNum && codeNum[1] === kwNum;
        });
        if (hit) return hit;
      }
      // 如果没有精确数字匹配，返回该产品的第一个（或按数字最接近的）
      if (candidates.length > 0) {
        const targetNum = specNum || (kwNum ? parseInt(kwNum) : 0);
        if (targetNum > 0) {
          const withNum = candidates.map((p)=>{
            const codeNum = normalizeStr(p.code).match(/(\d+)/);
            return {
              product: p,
              num: codeNum ? parseInt(codeNum[1]) : 0
            };
          });
          withNum.sort((a, b)=>Math.abs(a.num - targetNum) - Math.abs(b.num - targetNum));
          return withNum[0].product;
        }
        return candidates[0];
      }
    }
  }
  // 8. 去掉空格和连字符后匹配
  const kwNoSpecial = kw.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  hit = products.find((p)=>{
    const codeClean = normalizeStr(p.code).replace(/[^a-z0-9]/g, '');
    const nameClean = normalizeStr(p.name).replace(/[^a-z0-9]/g, '');
    return codeClean === kwNoSpecial || nameClean === kwNoSpecial;
  });
  if (hit) return hit;
  return null;
}

/**
 * 查找同名产品的所有规格（用户未指定规格时调用）
 * 返回按 name 分组的产品数组，每组包含 name + specs[] 数组
 * 如果只找到单个规格也正常返回（单条也走规格列表展示）
 */
function findAllSpecs(products, keyword) {
  let kw = normalizeStr(keyword);
  if (!kw) return null;
  // 剥离尾部规格单位
  const specUnitMatch = kw.match(/(\d+)\s*(mg|iu|ml|mcg|g)\s*$/);
  if (specUnitMatch) {
    kw = kw.substring(0, kw.length - specUnitMatch[0].length);
  }
  // 提取数字后缀
  const numMatch = kw.match(/^(\D+)(\d+)$/);
  const kwBase = numMatch ? numMatch[1] : kw;
  const kwNum = numMatch ? numMatch[2] : '';
  console.log(`[findAllSpecs] kw="${keyword}" → kwBase="${kwBase}" kwNum="${kwNum}"`);

  let matched = null;

  // 1. 代码完全匹配 → 找同名产品
  let hit = products.find((p)=>normalizeStr(p.code) === kw);
  if (hit) {
    matched = hit.name;
    console.log(`[findAllSpecs] 命中@代码完全匹配: name=${matched}`);
  }

  // 2. 名称完全匹配
  if (!matched) {
    hit = products.find((p)=>normalizeStr(p.name) === kw);
    if (hit) {
      matched = hit.name;
      console.log(`[findAllSpecs] 命中@名称完全匹配: name=${matched}`);
    }
  }

  // 3. 代码前缀匹配
  if (!matched) {
    const prefixHits = products.filter((p)=>normalizeStr(p.code).startsWith(kw));
    if (prefixHits.length > 0) {
      matched = prefixHits[0].name;
      console.log(`[findAllSpecs] 命中@代码前缀: name=${matched}`);
    }
  }

  // 4. 名称前缀匹配
  if (!matched) {
    const nameHits = products.filter((p)=>normalizeStr(p.name).startsWith(kwBase) || normalizeStr(p.name).startsWith(kw));
    if (nameHits.length > 0) {
      matched = nameHits[0].name;
      console.log(`[findAllSpecs] 命中@名称前缀: name=${matched}`);
    }
  }

  // 5. 代码包含
  if (!matched) {
    hit = products.find((p)=>normalizeStr(p.code).includes(kw));
    if (hit) {
      matched = hit.name;
    }
  }

  // 6. 名称包含
  if (!matched) {
    hit = products.find((p)=>normalizeStr(p.name).includes(kw));
    if (hit) {
      matched = hit.name;
    }
  }

  // 7. 别名匹配
  if (!matched) {
    for (const [name, aliases] of Object.entries(PRODUCT_ALIASES)){
      if (aliases.includes(kwBase) || name.startsWith(kwBase) || name.includes(kwBase)) {
        matched = name;
        break;
      }
      for (const alias of aliases){
        if (kwBase.startsWith(alias) || alias.startsWith(kwBase)) {
          matched = name;
          break;
        }
      }
      if (matched) break;
    }
  }

  // 8. 去掉特殊字符匹配
  if (!matched) {
    const kwNoSpecial = kw.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    hit = products.find((p)=>{
      const codeClean = normalizeStr(p.code).replace(/[^a-z0-9]/g, '');
      const nameClean = normalizeStr(p.name).replace(/[^a-z0-9]/g, '');
      return codeClean === kwNoSpecial || nameClean === kwNoSpecial;
    });
    if (hit) matched = hit.name;
  }

  if (!matched) return null;

  // 如果用户输入带有数字后缀（如 reta20），检查是否有精确规格匹配
  // 如果有精确匹配则返回 null（让 findProduct 的精确规格逻辑处理）
  const targetNum = kwNum ? parseInt(kwNum) : (specUnitMatch ? parseInt(specUnitMatch[1]) : null);
  if (targetNum) {
    const allSpecs = products.filter((p)=>normalizeStr(p.name) === normalizeStr(matched));
    // 检查代码中是否有精确匹配该数字的规格
    const exactMatch = allSpecs.find((p)=>{
      const codeNum = normalizeStr(p.code).match(/(\d+)/);
      return codeNum && parseInt(codeNum[1]) === targetNum;
    });
    if (exactMatch) {
      // 有精确规格匹配，不应该走全部展示，返回 null 让原逻辑处理
      console.log(`[findAllSpecs] 有精确规格匹配(${exactMatch.code})，返回 null 让 findProduct 处理`);
      return null;
    }
  }

  // 收集同名产品的所有规格
  const normName = normalizeStr(matched);
  const allSpecs = products.filter((p)=>normalizeStr(p.name) === normName);
  if (allSpecs.length === 0) return null;

  // 按规格数字升序排列
  allSpecs.sort((a, b) => {
    const aNum = (a.spec || '').match(/(\d+)/);
    const bNum = (b.spec || '').match(/(\d+)/);
    const aVal = aNum ? parseInt(aNum[1]) : 0;
    const bVal = bNum ? parseInt(bNum[1]) : 0;
    return aVal - bVal;
  });
  console.log(`[findAllSpecs] 找到 ${allSpecs.length} 个规格 for ${matched}`);
  return { name: matched, specs: allSpecs };
}

// ========== 运费计算 ==========
function extractCountryFromTemplate(countryField) {
  // country 字段格式如 "澳洲小包DDP，澳大利亚" → 提取 "澳大利亚"
  // 或 "欧洲大件DDP，德国、奥地利..." → 提取逗号后的所有国家
  const match = countryField.match(/[，,]\s*(.+)$/);
  if (match) {
    // 可能包含多个国家，用顿号/逗号分隔
    const countries = match[1].split(/[、,，]/).map((s)=>s.trim()).filter(Boolean);
    return countries[0] || countryField;
  }
  return countryField;
}
function calculateShipping(items, templates, packagingList, country, currency) {
  // 过滤匹配国家的模板（从 country 字段中提取真正的国家名）
  const countryTemplates = templates.filter((t)=>{
    const extracted = extractCountryFromTemplate(t.country);
    // 支持多国家匹配：如 "德国、奥地利" 中包含 "德国"
    const countries = extracted.split(/[、,，]/).map((s)=>s.trim()).filter(Boolean);
    return countries.includes(country) || t.country === country || extracted === country;
  });
  // 如果精确匹配不到，尝试模糊匹配（country 是模板 country 字段的子串，或反之）
  let matchedTemplates = countryTemplates;
  if (matchedTemplates.length === 0) {
    matchedTemplates = templates.filter((t)=>{
      return t.country.includes(country) || country.includes(t.country) || t.country.includes(extractCountryFromTemplate(country)) || extractCountryFromTemplate(t.country).includes(country);
    });
  }
  if (matchedTemplates.length === 0) {
    // 列出所有可用国家帮助用户
    const availableCountries = [
      ...new Set(templates.map((t)=>extractCountryFromTemplate(t.country)))
    ];
    return {
      totalShipping: 0,
      shippingDetails: `未找到「${country}」的运费模板\n可用国家: ${availableCountries.join('、')}`
    };
  }
  // 展开所有盒
  const allBoxes = [];
  for (const item of items){
    const w = item.weightProduct ? item.weightProduct.gross_weight || item.weightProduct.net_weight || 0 : 0;
    for(let i = 0; i < item.qty; i++){
      allBoxes.push({
        name: item.product.name,
        weight: w
      });
    }
  }
  const totalBoxes = allBoxes.length;
  if (totalBoxes === 0) {
    return {
      totalShipping: 0,
      shippingDetails: '无产品可计算运费'
    };
  }
  // 选择最小的箱子
  packagingList.sort((a, b)=>(a.capacity || 0) - (b.capacity || 0));
  let selectedPkg = packagingList.find((p)=>totalBoxes <= (p.capacity || 0) + 5);
  if (!selectedPkg && packagingList.length > 0) selectedPkg = packagingList[packagingList.length - 1];
  const boxCapacity = selectedPkg?.capacity || 30;
  const pkgWeight = selectedPkg?.gross_weight || selectedPkg?.net_weight || 0;
  // 选择模板：优先选择币种匹配的，否则用第一个
  // 同时根据总重量判断大小件，优先选小件模板（小件更便宜）
  const totalWeight = allBoxes.reduce((s, b)=>s + b.weight, 0) + pkgWeight;
  // 大小件阈值：欧洲国家 >10kg 算大件，其他地区 >20kg 算大件
  const europeanCountry = /欧洲|德国|法国|意大利|西班牙|荷兰|比利时|奥地利|瑞士|瑞典|丹麦|挪威|芬兰|波兰|葡萄牙|爱尔兰|希腊|捷克|匈牙利|罗马尼亚/i.test(country);
  const bigItemThreshold = europeanCountry ? 10000 : 20000;
  const isSmall = totalWeight <= bigItemThreshold;
  // 判断模板是大小件的辅助函数（从 spec_type、channel、country 三个字段中检测关键词）
  const isSmallTpl = (t)=>/小件|小包|small/i.test(t.spec_type || '') || /小件|小包|small/i.test(t.channel || '') || /小件|小包|small/i.test(t.country || '');
  const isBigTpl = (t)=>/大件|大包|large/i.test(t.spec_type || '') || /大件|大包|large/i.test(t.channel || '') || /大件|大包|large/i.test(t.country || '');
  // 按优先级排序：大小件匹配（最高） > 币种匹配 > 第一个
  const sortedTemplates = [
    ...matchedTemplates
  ].sort((a, b)=>{
    const aSize = isSmall ? isSmallTpl(a) ? 0 : isBigTpl(a) ? 2 : 1 : isBigTpl(a) ? 0 : isSmallTpl(a) ? 2 : 1;
    const bSize = isSmall ? isSmallTpl(b) ? 0 : isBigTpl(b) ? 2 : 1 : isBigTpl(b) ? 0 : isSmallTpl(b) ? 2 : 1;
    if (aSize !== bSize) return aSize - bSize;
    // 币种匹配
    const aCurMatch = a.currency === currency ? 0 : 1;
    const bCurMatch = b.currency === currency ? 0 : 1;
    if (aCurMatch !== bCurMatch) return aCurMatch - bCurMatch;
    return 0;
  });
  let tpl = sortedTemplates[0];
  if (!tpl) {
    return {
      totalShipping: 0,
      shippingDetails: `未找到「${country}」的运费模板`
    };
  }
  const firstW = tpl.first_weight || 0;
  const addW = tpl.add_weight || 0;
  const firstP = tpl.first_price || 0;
  const addP = tpl.add_price || 0;
  const sym = CURRENCY_SYMBOLS[tpl.currency] || tpl.currency;
  // 分箱逻辑
  const TOLERANCE = 5;
  const MAX_BOX_WEIGHT = 21999;
  const sortedItems = [
    ...allBoxes
  ].sort((a, b)=>a.weight - b.weight);
  const interleaved = [];
  let lo = 0, hi = sortedItems.length - 1;
  while(lo <= hi){
    if (lo === hi) {
      interleaved.push(sortedItems[lo]);
      break;
    }
    interleaved.push(sortedItems[lo++]);
    interleaved.push(sortedItems[hi--]);
  }
  let numBoxes = Math.max(1, Math.ceil(totalBoxes / (boxCapacity + TOLERANCE)));
  let shipments = [];
  for(let attempt = 0; attempt < 20; attempt++){
    const baseQty = Math.floor(totalBoxes / numBoxes);
    const extra = totalBoxes % numBoxes;
    const tmp = [];
    let idx = 0;
    let valid = true;
    for(let b = 0; b < numBoxes; b++){
      const qty = baseQty + (b < extra ? 1 : 0);
      if (qty > boxCapacity + TOLERANCE) {
        valid = false;
        break;
      }
      tmp.push(interleaved.slice(idx, idx + qty));
      idx += qty;
    }
    if (valid && tmp.length === numBoxes) {
      const allValid = tmp.every((ch)=>ch.reduce((s, b)=>s + b.weight, 0) + pkgWeight <= MAX_BOX_WEIGHT);
      if (allValid) {
        shipments = tmp;
        break;
      }
    }
    numBoxes++;
  }
  // 贪心降级
  if (shipments.length === 0) {
    shipments = [];
    let currentBox = [];
    let currentWeight = 0;
    for (const item of allBoxes){
      if (currentBox.length >= boxCapacity + TOLERANCE || currentWeight + item.weight + pkgWeight > MAX_BOX_WEIGHT) {
        shipments.push(currentBox);
        currentBox = [];
        currentWeight = 0;
      }
      currentBox.push(item);
      currentWeight += item.weight;
    }
    if (currentBox.length > 0) shipments.push(currentBox);
  }
  // 计算每箱运费
  let totalShipping = 0;
  const boxDetails = [];
  const boxInfos = [];
  for(let i = 0; i < shipments.length; i++){
    const itemsWeight = shipments[i].reduce((s, b)=>s + b.weight, 0);
    const boxWeight = itemsWeight + pkgWeight;
    const grams = Math.ceil(boxWeight);
    const itemsGrams = Math.ceil(itemsWeight);
    let boxCost = 0;
    if (grams <= firstW) {
      boxCost = firstP;
    } else if (addW > 0) {
      boxCost = firstP + Math.ceil((grams - firstW) / addW) * addP;
    } else {
      boxCost = firstP;
    }
    totalShipping += boxCost;
    // 统计每箱产品名+重量（去重+计数）
    const nameWeightMap = new Map(); // name → {cnt, unitWeight}
    for (const b of shipments[i]){
      if (!nameWeightMap.has(b.name)) {
        nameWeightMap.set(b.name, { cnt: 0, unitWeight: b.weight });
      }
      const entry = nameWeightMap.get(b.name);
      entry.cnt++;
    }
    // 生成明细字符串：3盒Retatrutide 180g + 4盒BAC Water 640g
    let itemDescParts = [];
    for (const [name, { cnt, unitWeight }] of nameWeightMap.entries()) {
      itemDescParts.push(`${cnt}盒${name} ${cnt * unitWeight}g`);
    }
    const itemDesc = itemDescParts.join('+');
    // boxInfos.items：用于卡片显示的简短描述
    let itemShortParts = [];
    for (const [name, { cnt }] of nameWeightMap.entries()) {
      itemShortParts.push(`${name} ×${cnt}`);
    }
    boxInfos.push({
      boxNum: i + 1,
      count: shipments[i].length,
      productWeight: itemsGrams,
      pkgWeight: Math.ceil(pkgWeight),
      totalWeight: grams,
      cost: boxCost,
      items: itemShortParts,
      detail: `${itemDesc}+ ${selectedPkg ? selectedPkg.name : '箱子'}${Math.ceil(pkgWeight)}g`
    });
    boxDetails.push(`${itemDesc}+ ${selectedPkg ? selectedPkg.name : '箱子'}${Math.ceil(pkgWeight)}g → ${sym}${boxCost.toFixed(2)}`);
    console.log(`[运费明细v2] ${itemDesc}+ ${selectedPkg ? selectedPkg.name : '箱子'}${Math.ceil(pkgWeight)}g`);
  }
  return {
    totalShipping,
    tpl,
    shippingDetails: boxDetails.join('\n'),
    boxInfos,
    pkgName: selectedPkg?.name || '箱子'
  };
}
// ========== 构建飞书卡片 ==========
function buildQuoteCard(matchedItems, unmatchedItems, country, currency, shippingResult, rates, specListItems = []) {
  const userCurrency = currency || 'USD';
  const sym = CURRENCY_SYMBOLS[userCurrency] || userCurrency;
  const rate = rates?.[userCurrency] || 1;
  const cnyRate = rates?.['CNY'] || 7.25;
  const totalUSD = matchedItems.reduce((s, item)=>s + item.product.price * item.qty, 0);
  const totalInCurrency = userCurrency === 'USD' ? totalUSD : totalUSD * rate;
  const totalCNY = totalUSD * cnyRate;
  // ===== 客户可见部分（分割线上） =====
  const clientRows = [];
  // 产品明细
  for (const item of matchedItems){
    const subtotalCur = userCurrency === 'USD' ? item.product.price * item.qty : item.product.price * item.qty * rate;
    clientRows.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${item.product.name}** ${item.product.spec}  × ${item.qty} = ${sym}${subtotalCur.toFixed(2)}`
      }
    });
  }
  // 无规格查询：展示该产品的所有规格列表
  for (const specItem of specListItems){
    const specLines = specItem.specs.map((s)=>{
      const priceCur = userCurrency === 'USD' ? s.price : s.price * rate;
      return `${specItem.name}：${s.code} ${s.spec} ${sym}${priceCur.toFixed(2)}`;
    }).join('\n');
    clientRows.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: specLines
      }
    });
  }
  if (unmatchedItems.length > 0) {
    clientRows.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `⚠️ 未匹配: ${unmatchedItems.join('、')}`
      }
    });
  }
  // shipment 行 + TOTAL 行
  let shippingInUserCurrency = 0;
  let shippingInUSD = 0;
  let grandTotalUser = totalInCurrency;
  let grandTotalUSD = totalUSD;
  let grandTotalCNY = totalCNY;
  let tplCurrency = 'USD';
  let tplRate = 1;
  let userRate = rate;
  if (shippingResult && shippingResult.tpl) {
    const tpl = shippingResult.tpl;
    tplCurrency = tpl.currency || 'USD';
    tplRate = rates?.[tplCurrency] || 1; // 1 USD = tplRate tplCurrency
    // 运费原始金额在模板币种下
    const shippingInTplCurrency = shippingResult.totalShipping;
    // 转成 USD：tplCurrency → USD = shippingInTplCurrency / tplRate
    shippingInUSD = tplCurrency === 'USD' ? shippingInTplCurrency : shippingInTplCurrency / tplRate;
    // 转成用户币种：USD → userCurrency = shippingInUSD * userRate
    userRate = rates?.[userCurrency] || 1;
    shippingInUserCurrency = userCurrency === 'USD' ? shippingInUSD : shippingInUSD * userRate;
    grandTotalUser = totalInCurrency + shippingInUserCurrency;
    grandTotalUSD = totalUSD + shippingInUSD;
    grandTotalCNY = grandTotalUSD * (rates?.['CNY'] || 7.25);
    clientRows.push({
      tag: 'hr'
    });
    clientRows.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `shipment: ${sym}${shippingInUserCurrency.toFixed(2)}`
      }
    });
    clientRows.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**TOTAL: ${sym}${grandTotalUser.toFixed(2)}**`
      }
    });
  }
  // ===== 分割线 =====
  clientRows.push({
    tag: 'hr'
  });
  // ===== 内部参考部分（分割线下） =====
  const internalRows = [];
  // 货物合计
  internalRows.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `货物合计: ${sym}${totalInCurrency.toFixed(2)} (=$${totalUSD.toFixed(2)} USD=¥${totalCNY.toFixed(2)})`
    }
  });
  // 运费明细
  if (shippingResult && shippingResult.tpl) {
    const tpl = shippingResult.tpl;
    const channelLabel = tpl.spec_type || tpl.channel;
    internalRows.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `运费：${channelLabel}(${tpl.channel})`
      }
    });
    if (shippingResult.boxInfos && shippingResult.boxInfos.length > 0) {
      // 将每箱费用从模板币种转换为用户币种
      const convertBoxCost = (cost) => {
        if (tplCurrency === userCurrency) return cost;
        const costUSD = tplCurrency === 'USD' ? cost : cost / tplRate;
        return userCurrency === 'USD' ? costUSD : costUSD * userRate;
      };
      const boxLines = shippingResult.boxInfos.map((b)=>{
        const convertedCost = convertBoxCost(b.cost);
        const detail = b.detail || `${b.count}盒 ${b.productWeight}g`;
        return `${detail} → ${sym}${convertedCost.toFixed(2)}`;
      });
      internalRows.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `${shippingResult.boxInfos.length}箱发货 | ${boxLines.join('\n')}`
        }
      });
    }
    internalRows.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `总计 ${sym}${grandTotalUser.toFixed(2)}=¥${grandTotalCNY.toFixed(2)}`
      }
    });
  } else if (country) {
    internalRows.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: shippingResult?.shippingDetails || `未找到「${country}」的运费模板`
      }
    });
  }
  return {
    config: {
      wide_screen_mode: true
    },
    header: {
      title: {
        tag: 'plain_text',
        content: matchedItems.length > 0 ? '📋 报价单' : '❌ 查询失败'
      },
      template: matchedItems.length > 0 ? 'blue' : 'red'
    },
    elements: [
      ...clientRows,
      ...internalRows
    ]
  };
}
function buildHelpCard() {
  return {
    config: {
      wide_screen_mode: true
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '🤖 报价机器人使用说明'
      },
      template: 'green'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**📋 基本格式**\n`产品名 [规格] 数量 国家 币种`\n每行一个产品，或用空格分隔多个产品'
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**📊 单产品报价**\n`Reta20 3` → Retatrutide 20mg × 3盒\n`BAC 3ml 4` → BAC Water 3ml × 4盒\n`TSM 5mg 3` → Tesamorelin 5mg × 3盒'
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**📊 多产品报价**\n`Reta20 3`\n`BAC 3ml 4`\n`TSM 5mg 3`\n`5盒GHK 50`\n支持换行或空格分隔'
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**📦 报价 + 运费**\n末尾加 国家 和 币种 即可计算运费：\n`Reta20 3 澳洲 澳元`\n`BAC 10ml 4 葡萄牙 美元`\n`Reta10 2盒 德国 欧元`'
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**✏️ 输入规则**\n• **数量写法**：`3`、`3盒`、`5盒产品名` 均可\n• **规格写法**：`5mg`、`10mg`，或省略 mg 直接写 `50`（如 `GHK 50`）\n• **产品识别**：支持产品全称、缩写、代码（见下方列表）\n• **不需输入价格**：系统自动查询产品单价'
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**🌍 币种**\n美元(USD) 澳元(AUD) 欧元(EUR) 英镑(GBP) 加元(CAD) 人民币(CNY)\n支持中文或英文输入，默认 USD'
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**🏷️ 常用产品缩写**\n• Retatrutide: `Reta` / `RT`\n• Tirzepatide: `Tirz` / `TR`\n• Semaglutide: `Sema` / `SM`\n• Tesamorelin: `TSM`\n• BAC Water: `BAC`\n• GHK-Cu: `GHK`\n• 5-Amino-1MQ: `5AM` / `AM`\n• NAD: `NAD`\n• Melanotan: `MT1` / `MT2`\n• 更多产品直接输入名称即可匹配'
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**📝 结构化格式（可选）**\n`产品:Reta10 数量:2 国家:澳大利亚 币种:AUD`'
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**💡 提示**\n• 发送 `帮助` 或 `help` 随时查看本说明\n• 不确定产品名时输入部分名称即可模糊匹配\n• 输入 @报价助手 触发，或在群内直接发送指令'
        }
      }
    ]
  };
}
// ========== URL 验证（飞书事件订阅首次配置用） ==========
async function handleChallenge(body) {
  return new Response(JSON.stringify({
    challenge: body.challenge
  }), {
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
// ========== 主处理逻辑 ==========
async function handleMessage(text, messageId) {
  // message_id 级别去重，防止同一条消息被多次处理
  if (messageId && _processedMessages.has(messageId)) {
    console.log(`[去重] 跳过重复 message_id=${messageId}`);
    return;
  }
  if (messageId) _processedMessages.add(messageId);
  const trimmed = text.trim();
  // 帮助指令（去掉 @机器人 后的纯文本匹配）
  const cleanText = trimmed.replace(/^@\S+\s*/, '').trim();
  if (/^(帮助|help|？|\?|说明|usage)$/i.test(cleanText)) {
    await replyCard(messageId, buildHelpCard());
    return;
  }
  // 解析指令
  const cmd = parseCommand(trimmed);
  console.log(`[解析] 原始文本: "${trimmed}"`);
  console.log(`[解析] items: ${JSON.stringify(cmd.items)}, country: ${cmd.country}, currency: ${cmd.currency}`);
  if (cmd.items.length === 0) {
    await replyCard(messageId, {
      config: {
        wide_screen_mode: true
      },
      header: {
        title: {
          tag: 'plain_text',
          content: '❓ 无法识别'
        },
        template: 'red'
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: '未能识别你的指令，请发送 **帮助** 查看使用说明。\n\n示例：`Reta20 3 澳洲 澳元`'
          }
        }
      ]
    });
    return;
  }
  // 查询数据
  const [products, templates, weightProds, rates] = await Promise.all([
    getAllQuoteProducts(),
    getShippingTemplates(),
    getWeightProducts(),
    getExchangeRates()
  ]);
  // 匹配产品（同一产品多次出现时合并数量）
  const matchedMap = new Map();
  const unmatchedItems = [];
  // 产品 → 重量库映射规则
  function matchWeightProduct(product) {
    const pn = normalizeStr(product.name);
    const pc = normalizeStr(product.code);
    const ps = normalizeStr(product.spec || '');
    // BAC WATER 系列：name/spec 里可能有 3ml 或 10ml
    if (pn.includes('bac') || pc.includes('bac') || pn.includes('bacwater')) {
      if (ps.includes('3ml') || pn.includes('3ml')) return weightProds.find((w)=>w.type !== 'packaging' && normalizeStr(w.name).includes('3ml'));
      if (ps.includes('10ml') || pn.includes('10ml')) return weightProds.find((w)=>w.type !== 'packaging' && normalizeStr(w.name).includes('10ml'));
    }
    // NAD / HCG → 大冻干粉
    if (pn.includes('nad') || pn.includes('hcg')) {
      return weightProds.find((w)=>w.type !== 'packaging' && normalizeStr(w.name).includes('大冻干粉'));
    }
    // 其余 → 冻干粉
    return weightProds.find((w)=>w.type !== 'packaging' && normalizeStr(w.name).includes('冻干粉') && !normalizeStr(w.name).includes('大'));
  }
  const specListItems = []; // 无规格查询的产品列表
  for (const item of cmd.items){
    const product = findProduct(products, item.keyword);
    console.log(`[匹配] keyword="${item.keyword}" qty=${item.quantity} → ${product ? `产品:${product.name}(${product.code}) id=${product.id}` : '未匹配'}`);
    if (product) {
      // findProduct 找到了，检查是否应该展示全部规格而非单个
      // 条件：该产品同名下有 >1 个规格，且 findProduct 匹配到的是"名称匹配"（非代码精确匹配）
      const kwNorm = normalizeStr(item.keyword);
      const normName = normalizeStr(product.name);
      const sameNameSpecs = products.filter((p)=>normalizeStr(p.name) === normName);
      // 判断是否是精确规格匹配：keyword 包含的数字是否精确匹配某个规格的 code 数字
      const kwNumMatch = kwNorm.match(/(\d+)/);
      let isExactSpecMatch = false;
      if (kwNumMatch) {
        const kwNum = parseInt(kwNumMatch[1]);
        // 检查 product.code 的数字是否精确等于 keyword 中的数字
        const codeNum = normalizeStr(product.code).match(/(\d+)/);
        if (codeNum && parseInt(codeNum[1]) === kwNum) {
          isExactSpecMatch = true;
        }
        // 检查 keyword 数字是否匹配 spec 中的数字
        const specNum = (product.spec || '').match(/(\d+)/);
        if (specNum && parseInt(specNum[1]) === kwNum) {
          isExactSpecMatch = true;
        }
      }
      // 如果同名有多个规格，且不是精确规格匹配，走规格列表（无论 qty 是多少）
      if (sameNameSpecs.length > 1 && !isExactSpecMatch) {
        // 检查 keyword 是否就是产品名本身（或别名）
        const codeExact = products.find((p)=>normalizeStr(p.code) === kwNorm);
        const nameExact = products.find((p)=>normalizeStr(p.name) === kwNorm);
        // 如果 keyword 恰好等于某个产品 code（如 BPC157 恰好是一个 code），且只有一个规格同名的代码匹配，走单个展示
        if (codeExact && codeExact.id === product.id && sameNameSpecs.length === 1) {
          // 精确 code 匹配且无其他同代码规格，走单个
          const pid = product.id;
          if (!matchedMap.has(pid)) {
            const weightProduct = matchWeightProduct(product);
            matchedMap.set(pid, { product, qty: item.quantity, weightProduct });
          }
        } else {
          // 走全部规格展示
          sameNameSpecs.sort((a, b) => {
            const aNum = (a.spec || '').match(/(\d+)/);
            const bNum = (b.spec || '').match(/(\d+)/);
            const aVal = aNum ? parseInt(aNum[1]) : 0;
            const bVal = bNum ? parseInt(bNum[1]) : 0;
            return aVal - bVal;
          });
          console.log(`[匹配] keyword="${item.keyword}" → 规格列表(${sameNameSpecs.length}个，非精确规格匹配)`);
          specListItems.push({ name: product.name, specs: sameNameSpecs });
        }
        continue;
      }
      const pid = product.id;
      if (matchedMap.has(pid)) {
        matchedMap.get(pid).qty += item.quantity;
      } else {
        const weightProduct = matchWeightProduct(product);
        matchedMap.set(pid, {
          product,
          qty: item.quantity,
          weightProduct
        });
      }
    } else {
      // findProduct 未匹配，尝试查找该产品的所有规格
      const specList = findAllSpecs(products, item.keyword);
      if (specList && specList.specs.length > 0) {
        console.log(`[匹配] keyword="${item.keyword}" → 规格列表(${specList.specs.length}个)`);
        specListItems.push(specList);
        continue;
      }
      unmatchedItems.push(item.keyword);
    }
  }
  const matchedItems = [
    ...matchedMap.values()
  ];
  // 运费计算
  let shippingResult;
  if (cmd.country && matchedItems.length > 0) {
    const packagingList = weightProds.filter((w)=>w.type === 'packaging' && (w.capacity || 0) > 0);
    const currency = cmd.currency || templates.find((t)=>t.country === cmd.country)?.currency || 'AUD';
    shippingResult = calculateShipping(matchedItems, templates, packagingList, cmd.country, currency);
  }
  // 构建并回复卡片
  const card = buildQuoteCard(matchedItems, unmatchedItems, cmd.country, cmd.currency, shippingResult, rates, specListItems);
  await replyCard(messageId, card);
}
// ========== Deno Serve ==========
Deno.serve(async (req)=>{
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Feishu-Verification'
      }
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405
    });
  }
  try {
    const body = await req.json();
    // 记录所有请求用于调试
    console.log('收到请求:', JSON.stringify(body));
    // 飞书 URL 验证
    if (body.type === 'url_verification') {
      return handleChallenge(body);
    }
    // 飞书事件回调
    if (body.header?.event_type === 'im.message.receive_v1') {
      // 校验 Verification Token（飞书要求）
      if (FEISHU_VERIFICATION_TOKEN && body.header?.token !== FEISHU_VERIFICATION_TOKEN) {
        console.error('Verification token mismatch');
        return new Response(JSON.stringify({
          code: -1,
          msg: 'token mismatch'
        }), {
          status: 403,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
      const event = body.event;
      const eventId = body.header?.event_id;
      const messageId = event.message?.message_id;
      console.log(`[事件] event_id=${eventId} message_id=${messageId} sender_app=${event.sender?.sender_id?.app_id}`);
      // 过滤机器人自己发的消息，防止消息风暴
      if (event.sender?.sender_id?.app_id) {
        console.log(`[过滤] 跳过机器人自身消息`);
        return new Response(JSON.stringify({
          code: 0
        }), {
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
      // 事件去重：内存级（单实例）+ 数据库级（跨实例）
      if (eventId && _processedEvents.has(eventId)) {
        console.log(`[去重-内存] 跳过重复 event_id=${eventId}`);
        return new Response(JSON.stringify({ code: 0 }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (eventId) _processedEvents.add(eventId);

      // 数据库级去重：INSERT OR IGNORE，确保多实例下只处理一次
      if (eventId) {
        try {
          const { error: dupErr } = await supabase.from('processed_events')
            .insert({ event_id: eventId, created_at: new Date().toISOString() });
          if (dupErr) {
            // unique constraint violation → 已有其他实例处理过
            console.log(`[去重-DB] 跳过重复 event_id=${eventId}, err=${dupErr.code}`);
            return new Response(JSON.stringify({ code: 0 }), { headers: { 'Content-Type': 'application/json' } });
          }
        } catch(e) {
          // 表不存在或 DB 错误时降级为内存去重，不阻断处理
          console.warn('[去重-DB] 查询失败，降级内存去重:', e);
        }
      }

      const msgType = event.message?.message_type;
      // 只处理文本消息（忽略 interactive 卡片等非文本消息）
      if (msgType === 'text') {
        const content = JSON.parse(event.message.content || '{}');
        const text = content.text || '';
        // 异步处理，立即返回 200（飞书要求 3 秒内响应）
        // 用 .catch() 防止 unhandled promise rejection
        handleMessage(text, messageId).catch((err)=>console.error('消息处理失败:', err));
      }
      return new Response(JSON.stringify({
        code: 0
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      code: 0
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('处理请求失败:', err);
    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 500
    });
  }
});
