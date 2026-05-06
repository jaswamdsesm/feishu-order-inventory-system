// app.js - 订单与库存管理系统

// ============ 模糊匹配产品 ============
function fuzzyFindProduct(name, sku) {
  if (!name && !sku) return null;
  const n = (name || '').trim().toLowerCase();
  const s = (sku || '').trim().toLowerCase();
  // 1. 精确匹配名称
  let found = allProducts.find(x => (x.name || '').toLowerCase() === n);
  if (found) return { product: found, method: '精确名称' };
  // 2. 精确匹配规格
  if (s) {
    found = allProducts.find(x => (x.sku || '').toLowerCase() === s);
    if (found) return { product: found, method: '精确规格' };
  }
  // 3. 名称模糊匹配（n在名称中，或名称在n中）
  let candidates = [];
  if (n) {
    candidates = allProducts.filter(x => {
      const xn = (x.name || '').toLowerCase();
      return xn.includes(n) || n.includes(xn);
    });
  }
  // 4. 规格模糊匹配（如果名称没匹配到）
  if (candidates.length === 0 && s) {
    candidates = allProducts.filter(x => {
      const xs = (x.sku || '').toLowerCase();
      return xs.includes(s) || s.includes(xs);
    });
  }
  // 5. 名称+规格组合匹配
  if (candidates.length === 0 && n && s) {
    candidates = allProducts.filter(x => {
      const xn = (x.name || '').toLowerCase();
      const xs = (x.sku || '').toLowerCase();
      return xn.includes(n) || n.includes(xn) || xs.includes(s) || s.includes(xs);
    });
  }
  if (candidates.length === 1) return { product: candidates[0], method: '模糊匹配' };
  if (candidates.length > 1) return { product: candidates, method: 'multiple' };
  return null;
}


// ============ 配置 ============
const SUPABASE_URL = 'https://pvrfqnffygusujsnxsct.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2cmZxbmZmeWd1c3Vqc254c2N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTI3ODYsImV4cCI6MjA5MzQ4ODc4Nn0.BraQWWOse2ikRGb02_PEgqV3b0Umdch9ugMqoBe7jio';
const FEISHU_APP_ID = 'cli_a9726837c7789cc5';

// ============ 全局状态 ============
let sb, currentUser = null, currentRole = 'employee', feishuUid = '';
let allProducts = [], allOrders = [], allOrderItems = [], allProfiles = [];
let allInventoryLogs = [];
let currentPage = 'dashboard', pageRefreshTimers = {}, editingOrderId = null, orderItemCounter = 0;

// ============ 初始化 ============
async function init() {
  try {
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
      await Promise.all([loadProfiles(), loadProducts(), loadOrders(), loadInventoryLogs()]);
      switchPage('dashboard');
      return;
    }

    const cached = localStorage.getItem('oi_user');
    if (cached) {
      try {
        const u = JSON.parse(cached);
        currentUser = u;
        currentRole = u.role || 'employee';
        feishuUid = u.feishu_user_id || '';
        hideLoading();
        applyRole();
        await Promise.all([loadProfiles(), loadProducts(), loadOrders(), loadInventoryLogs()]);
        // 每次打开都强制从数据库刷新最新角色（覆盖缓存）
        const { data: freshProfile } = await sb.from('profiles').select('role').eq('feishu_user_id', feishuUid).single();
        if (freshProfile && freshProfile.role) {
          currentRole = freshProfile.role;
          currentUser.role = freshProfile.role;
          localStorage.setItem('oi_user', JSON.stringify(currentUser));
          applyRole();
        }
        switchPage('dashboard');
        return;
      } catch (e) { }
    }
    await feishuLogin();
  } catch (err) {
    console.error(err);
    hideLoading();
    showToast('初始化失败:' + err.message, 'error');
  }
}

async function feishuLogin() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) {
    window.location.href = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${FEISHU_APP_ID}&redirect_uri=${encodeURIComponent(location.origin + location.pathname)}&response_type=code`;
    return;
  }
  try {
    const resp = await fetch('https://pvrfqnffygusujsnxsct.functions.supabase.co/feishu-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, app_id: FEISHU_APP_ID })
    });
    if (!resp.ok) throw new Error('飞书登录失败(status:' + resp.status + ')');
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || '飞书登录失败');
    currentUser = data.user;
    // 强制设为 super_admin（临时方案，因为 Edge Function 返回的 role 可能为空）
    currentRole = data.user.role || 'super_admin';
    feishuUid = data.user.feishu_user_id || '';
    try { await sb.rpc('upsert_profile', { p_feishu_user_id: feishuUid, p_name: currentUser.name, p_role: currentRole }); } catch (e) { console.warn('upsert_profile 失败', e); }
    localStorage.setItem('oi_user', JSON.stringify(currentUser));
    history.replaceState({}, document.title, location.pathname);
    hideLoading();
    applyRole();
    await Promise.all([loadProfiles(), loadProducts(), loadOrders(), loadInventoryLogs()]);
    switchPage('dashboard');
  } catch (err) { console.error(err); throw err; }
}

function hideLoading() { const e = document.getElementById('feishu-loading'); if (e) e.style.display = 'none'; }
function feishuLogout() { localStorage.removeItem('oi_user'); location.href = location.pathname; }

// ============ 权限控制 ============
function applyRole() {
  const isAdmin = ['super_admin', 'admin'].includes(currentRole);
  const isSuper = currentRole === 'super_admin';
  const roleText = { super_admin: '超级管理员', admin: '管理员', employee: '员工' };
  document.getElementById('nav-admin-only').classList.toggle('hidden', !isSuper);
  document.getElementById('inventory-admin-btns').classList.toggle('hidden', !isAdmin);
  document.getElementById('btn-export-orders').classList.toggle('hidden', !isSuper);
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
  const titles = { dashboard: '仪表盘', inventory: '库存管理', orders: '订单管理', logs: '变动日志', users: '用户管理' };
  const te = document.getElementById('page-title');
  if (te) te.textContent = titles[page] || '';
  clearAllRefreshTimers();
  if (page === 'dashboard') { loadDashboardData(); startPageRefresh(page, loadDashboardData); }
  else if (page === 'inventory') { renderInventory(); startPageRefresh(page, () => loadProducts().then(renderInventory)); }
  else if (page === 'orders') { renderOrders(); startPageRefresh(page, () => loadOrders().then(renderOrders)); }
  else if (page === 'logs') { renderLogs(); }
  else if (page === 'users' && currentRole === 'super_admin') { renderUsers(); }
}
function clearAllRefreshTimers() { Object.values(pageRefreshTimers).forEach(t => clearInterval(t)); pageRefreshTimers = {}; }
function startPageRefresh(page, fn) { clearAllRefreshTimers(); fn(); pageRefreshTimers[page] = setInterval(fn, 30000); }

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
function genOrderNo() {
  const d = new Date();
  const ds = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return 'ORD' + ds + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}
function isPhoneHidden() { return currentRole === 'employee'; }

// ============ 数据加载 ============
async function loadProfiles() { const { data, error } = await sb.from('profiles').select('*'); if (!error) allProfiles = data || []; }
async function loadProducts() { const { data, error } = await sb.from('products').select('*').order('name'); if (!error) allProducts = data || []; return allProducts; }
async function loadOrders() {
  const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending: false });
  if (!error) allOrders = data || [];
  const { data: items, error: e2 } = await sb.from('order_items').select('*');
  if (!e2) allOrderItems = items || [];
  return allOrders;
}
async function loadInventoryLogs() { const { data, error } = await sb.from('inventory_logs').select('*').order('created_at', { ascending: false }).limit(200); if (!error) allInventoryLogs = data || []; }

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
    return `<div class="flex items-center justify-between py-2 border-b border-gray-50"><div><p class="text-sm font-medium">${esc(o.order_no)}</p><p class="text-xs text-gray-400">${esc(o.customer_name)}</p></div><span class="text-xs px-2 py-1 rounded-full ${sc[o.status] || ''}">${esc(o.status)}</span></div>`;
  }).join('');
}

// ============ 库存管理 ============
function renderInventory() {
  const kw = document.getElementById('inventory-search').value.trim().toLowerCase();
  const filtered = kw ? allProducts.filter(p => (p.name || '').toLowerCase().includes(kw) || (p.short_name || '').toLowerCase().includes(kw) || (p.sku || '').toLowerCase().includes(kw)) : allProducts;
  const isAdmin = ['super_admin', 'admin'].includes(currentRole);
  let head = '<tr>';
  ['产品名称', '简称', '规格', '当前库存', '预警阈值', '单位', '更新时间', isAdmin ? '操作' : ''].forEach(h => { head += `<th class="px-4 py-3 text-left font-medium">${h}</th>`; });
  head += '</tr>';
  document.getElementById('inventory-head').innerHTML = head;
  if (filtered.length === 0) { document.getElementById('inventory-body').innerHTML = ''; document.getElementById('inventory-empty').classList.remove('hidden'); return; }
  document.getElementById('inventory-empty').classList.add('hidden');
  document.getElementById('inventory-body').innerHTML = filtered.map(p => {
    const isLow = p.current_stock <= p.min_stock_alert;
    const btnHtml = isAdmin ? `<button onclick="openProductModal('${p.id}')" class="text-xs text-blue-500 hover:underline mr-2">编辑</button><button onclick="deleteProduct('${p.id}')" class="text-xs text-red-500 hover:underline">删除</button>` : '';
    return `<tr class="${isLow ? 'stock-warn' : ''} border-b border-gray-50 hover:bg-gray-50"><td class="px-4 py-3 font-medium">${esc(p.name)}</td><td class="px-4 py-3 text-gray-500">${esc(p.short_name || '-')}</td><td class="px-4 py-3 text-gray-400">${esc(p.sku || '-')}</td><td class="px-4 py-3 ${isLow ? 'text-red-600 font-bold' : 'text-green-600'}">${p.current_stock} ${esc(p.unit || '个')}</td><td class="px-4 py-3 text-xs text-gray-400">${p.min_stock_alert}</td><td class="px-4 py-3">${esc(p.unit || '个')}</td><td class="px-4 py-3 text-xs text-gray-400">${(p.updated_at || p.created_at || '').slice(0, 10)}</td><td class="px-4 py-3">${btnHtml}</td></tr>`;
  }).join('');
}

function openProductModal(id) {
  document.getElementById('product-id').value = id || '';
  document.getElementById('product-modal-title').textContent = id ? '编辑产品' : '新增产品';
  if (id) {
    const p = allProducts.find(x => x.id === id);
    if (p) {
      document.getElementById('product-name').value = p.name || '';
      document.getElementById('product-short-name').value = p.short_name || '';
      document.getElementById('product-sku').value = p.sku || '';
      document.getElementById('product-stock').value = p.current_stock || 0;
      document.getElementById('product-alert').value = p.min_stock_alert || 10;
      document.getElementById('product-unit').value = p.unit || '个';
    }
  } else {
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
  const btn = document.getElementById('btn-save-product');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    const { data, error } = await sb.rpc('upsert_product', { p_id: id, p_name: name, p_short_name: shortName, p_sku: sku, p_stock: stock, p_alert: alertVal, p_unit: unit, p_feishu_user_id: feishuUid });
    if (error) throw error;
    closeModal('modal-product');
    await loadProducts(); renderInventory();
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

// ============ 订单管理 ============
function renderOrders() {
  const kw = document.getElementById('order-search').value.trim().toLowerCase();
  const statusFilter = document.getElementById('order-status-filter').value;
  let filtered = allOrders;
  if (statusFilter) filtered = filtered.filter(o => o.status === statusFilter);
  if (kw) filtered = filtered.filter(o => (o.order_no || '').toLowerCase().includes(kw) || (o.customer_name || '').toLowerCase().includes(kw));
  const phoneHidden = isPhoneHidden();
  const isAdmin = ['super_admin', 'admin'].includes(currentRole);
  if (filtered.length === 0) { document.getElementById('orders-list').innerHTML = ''; document.getElementById('orders-empty').classList.remove('hidden'); return; }
  document.getElementById('orders-empty').classList.add('hidden');
  document.getElementById('orders-list').innerHTML = filtered.map(o => {
    const items = allOrderItems.filter(i => i.order_id === o.id);
    const total = items.reduce((s, i) => s + (i.unit_price || 0) * i.quantity, 0);
    const phoneHtml = phoneHidden ? (o.customer_phone ? '***' : '') : esc(o.customer_phone || '');
    const addrHtml = phoneHidden ? (o.customer_address ? '***' : '') : esc(o.customer_address || '');
    const sc = { pending: 'border-yellow-300 bg-yellow-50', shipped: 'border-blue-300 bg-blue-50', completed: 'border-green-300 bg-green-50', cancelled: 'border-gray-200 bg-gray-50' };
    const sc2 = { pending: 'text-yellow-600', shipped: 'text-blue-600', completed: 'text-green-600', cancelled: 'text-gray-400' };
    const btnHtml = isAdmin ? `<button onclick="openOrderModal('${o.id}')" class="text-xs text-blue-500 hover:underline mr-2">编辑</button><button onclick="deleteOrder('${o.id}')" class="text-xs text-red-500 hover:underline">删除</button>` : '';
    return `<div class="order-card border ${sc[o.status] || 'border-gray-200'} rounded-xl p-4"><div class="flex items-start justify-between mb-2"><div><p class="font-bold text-sm">${esc(o.order_no)}</p><p class="text-xs text-gray-400">${esc(o.customer_name)}</p></div><span class="text-xs px-2 py-1 rounded-full ${sc2[o.status] || ''} font-medium">${statusText(o.status)}</span></div><div class="text-xs text-gray-500 space-y-0.5 mb-2"><p>📞 ${phoneHtml || '未填写'}</p><p>📍 ${addrHtml || '未填写'}</p></div><div class="border-t border-gray-100 pt-2 space-y-1">${items.map(i => { const p = allProducts.find(x => x.id === i.product_id); return `<div class="flex items-center justify-between text-xs"><span>${esc(p ? p.name : '未知产品')} × ${i.quantity}</span><span class="text-gray-500">${((i.unit_price || 0) * i.quantity).toFixed(2)}元</span></div>`; }).join('')}</div><div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-100"><span class="font-bold text-sm text-blue-600">合计：${total.toFixed(2)}元</span>${btnHtml}</div></div>`;
  }).join('');
}

function statusText(s) { return { pending: '待处理', shipped: '已发货', completed: '已完成', cancelled: '已取消' }[s] || s; }

function openOrderModal(id) {
  editingOrderId = id || null;
  document.getElementById('order-modal-title').textContent = id ? '编辑订单' : '新增订单';
  document.getElementById('order-id').value = id || '';
  document.getElementById('order-status-row').classList.toggle('hidden', !id);
  document.getElementById('order-items-container').innerHTML = '';
  orderItemCounter = 0;
  if (id) {
    const o = allOrders.find(x => x.id === id);
    if (o) {
      document.getElementById('order-customer-name').value = o.customer_name || '';
      document.getElementById('order-customer-phone').value = o.customer_phone || '';
      document.getElementById('order-customer-email').value = o.customer_email || '';
      document.getElementById('order-customer-addr').value = o.customer_address || '';
      document.getElementById('order-status').value = o.status || 'pending';
      document.getElementById('order-remark').value = o.remark || '';
      const items = allOrderItems.filter(i => i.order_id === id);
      items.forEach(i => addOrderItemRow(i));
    }
  } else {
    document.getElementById('order-customer-name').value = '';
    document.getElementById('order-customer-phone').value = '';
    document.getElementById('order-customer-email').value = '';
    document.getElementById('order-customer-addr').value = '';
    document.getElementById('order-status').value = 'pending';
    document.getElementById('order-remark').value = '';
    addOrderItemRow();
  }
  openModal('modal-order');
}

function addOrderItemRow(existing) {
  const idx = orderItemCounter++;
  const sel = `<select id="item-product-${idx}" class="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"><option value="">选择产品</option>${allProducts.map(p => `<option value="${p.id}">${esc(p.name)} (库存:${p.current_stock}${p.unit})</option>`).join('')}</select>`;
  const div = document.createElement('div');
  div.id = 'item-row-' + idx;
  div.className = 'flex items-center gap-2';
  div.innerHTML = sel + `<input type="number" id="item-qty-${idx}" min="1" value="${existing ? existing.quantity : 1}" class="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center" />`
    + `<input type="number" id="item-price-${idx}" min="0" step="0.01" value="${existing ? existing.unit_price : 0}" placeholder="单价" class="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center" />`
    + `<button onclick="removeOrderItemRow('item-row-${idx}')" class="text-red-400 hover:text-red-600 text-lg">×</button>`;
  if (existing && existing.product_id) setTimeout(() => { const selEl = document.getElementById('item-product-' + idx); if (selEl) selEl.value = existing.product_id; }, 0);
  document.getElementById('order-items-container').appendChild(div);
}

function removeOrderItemRow(rowId) { const e = document.getElementById(rowId); if (e) e.remove(); }

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
  const remark = document.getElementById('order-remark').value.trim();
  if (!name || !addr) { showToast('请填写客户姓名和收货地址', 'warning'); return; }
  const itemRows = document.querySelectorAll('#order-items-container > div');
  const items = [];
  for (let i = 0; i < itemRows.length; i++) {
    const row = itemRows[i];
    const sel = row.querySelector('select');
    const inputs = row.querySelectorAll('input[type="number"]');
    const qty = parseInt(inputs[0]?.value) || 0;
    const price = parseFloat(inputs[1]?.value) || 0;
    if (sel && sel.value && qty > 0) { items.push({ product_id: sel.value, quantity: qty, unit_price: price }); }
  }
  if (items.length === 0) { showToast('请至少添加一个产品', 'warning'); return; }
  if (!isEdit) {
    const dup = checkOrderDup(name, addr);
    if (dup && !confirm(`今天已有该客户的订单（${dup.order_no}），是否继续创建？`)) return;
  }
  const btn = document.getElementById('btn-save-order'); btn.disabled = true; btn.textContent = '保存中…';
  try {
    const orderNo = isEdit ? null : genOrderNo();
    const status = isEdit ? document.getElementById('order-status').value : 'pending';
    const { data, error } = await sb.rpc('upsert_order', {
      p_order_id: editingOrderId || null, p_order_no: orderNo,
      p_customer_name: name, p_customer_phone: phone, p_customer_email: email,
      p_customer_address: addr, p_status: status, p_remark: remark,
      p_serial_no: null, p_items: items, p_feishu_user_id: feishuUid
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
      const orderNo = genOrderNo();
      const items = [{ product_id: r.product_id, quantity: r.quantity, unit_price: r.unit_price || 0 }];
      const { data, error } = await sb.rpc('upsert_order', {
        p_order_id: null, p_order_no: orderNo,
        p_customer_name: r.customer_name, p_customer_phone: r.customer_phone || '', p_customer_email: '',
        p_customer_address: r.customer_address, p_status: 'pending', p_remark: r.remark || '', p_serial_no: null,
        p_items: items, p_feishu_user_id: feishuUid
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

// ============ 导出订单（CSV）===========
function exportOrders() {
  const statusFilter = document.getElementById('order-status-filter').value;
  let orders = allOrders;
  if (statusFilter) orders = orders.filter(o => o.status === statusFilter);
  if (orders.length === 0) { showToast('暂无订单可导出', 'warning'); return; }
  const BOM = '\uFEFF';
  const headers = ['订单号', '客户姓名', '联系电话', '收货地址', '产品明细', '总金额', '状态', '创建时间'];
  const rows = orders.map(o => {
    const items = allOrderItems.filter(i => i.order_id === o.id);
    const detail = items.map(i => { const p = allProducts.find(x => x.id === i.product_id); return (p ? p.name : '') + '×' + i.quantity; }).join('; ');
    const total = items.reduce((s, i) => s + (i.unit_price || 0) * i.quantity, 0);
    return [o.order_no, o.customer_name, o.customer_phone || '', o.customer_address || '', detail, total.toFixed(2), statusText(o.status), (o.created_at || '').slice(0, 10)];
  });
  const csv = [headers.join(','), ...rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(','))].join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = '订单导出_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click(); URL.revokeObjectURL(url);
  showToast('已导出 ' + orders.length + ' 条订单', 'success');
}

// ============ 变动日志 ============
function renderLogs() {
  const list = document.getElementById('logs-list');
  if (allInventoryLogs.length === 0) { list.innerHTML = '<p class="text-sm text-gray-400">暂无日志记录</p>'; return; }
  list.innerHTML = allInventoryLogs.map(l => {
    const p = allProducts.find(x => x.id === l.product_id);
    const typeText = { order_out: '订单出库', restock: '补货入库', adjust: '库存调整', return: '退货入库' };
    return `<div class="flex items-start gap-3 p-3 bg-white rounded-lg border border-gray-100"><div class="flex-1"><p class="text-sm font-medium">${esc(p ? p.name : '已删除产品')}</p><p class="text-xs text-gray-400">${typeText[l.change_type] || l.change_type} ${l.quantity > 0 ? '+' + l.quantity : l.quantity} ${p ? p.unit || '个' : ''}</p>${l.remark ? `<p class="text-xs text-gray-400 mt-0.5">${esc(l.remark)}</p>` : ''}</div><div class="text-right"><p class="text-xs text-gray-400">${esc(l.creator_name || '')}</p><p class="text-xs text-gray-400">${(l.created_at || '').slice(0, 16).replace('T', ' ')}</p></div></div>`;
  }).join('');
}

// ============ 用户管理（超管）===========
function renderUsers() {
  const list = document.getElementById('users-list');
  if (allProfiles.length === 0) { list.innerHTML = '<p class="text-sm text-gray-400">暂无用户数据</p>'; return; }
  list.innerHTML = allProfiles.map(u => {
    const roleText = { super_admin: '<span class="text-red-600 font-medium">超级管理员</span>', admin: '<span class="text-blue-600">管理员</span>', employee: '<span class="text-gray-500">员工</span>' };
    const isSelf = u.id === currentUser?.id;
    // 超管不能改自己的角色；如果是超管身份，显示角色文字即可
    const roleSelector = isSelf
      ? roleText[u.role] || u.role || ''
      : `<select onchange="changeUserRole('${u.id}',this.value)" class="ml-2 text-xs border border-gray-200 rounded px-1 py-0.5"><option value="employee" ${u.role === 'employee' ? 'selected' : ''}>员工</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option><option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>超级管理员</option></select>`;
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
  const errors = [];
  const products = [];
  lines.forEach((line, idx) => {
    const parts = line.split(',').map(s => s.trim());
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
      const { error } = await sb.rpc('upsert_product', {
        p_id: null, p_name: p.name, p_short_name: p.short_name, p_sku: p.sku, p_stock: p.stock,
        p_alert: p.alert, p_unit: p.unit, p_feishu_user_id: feishuUid
      });
      if (error) throw error;
      ok++;
    } catch (e) { fail++; console.warn('批量导入失败:', p.name, e.message); }
  }
  btn.disabled = false;
  closeModal('modal-batch-product');
  await loadProducts(); renderInventory();
  showToast('导入完成：成功 ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''), fail ? 'warning' : 'success');
}

// ============ 启动 ============
window.addEventListener('DOMContentLoaded', init);
