-- ============================================================
-- 飞书订单与库存管理系统 - Supabase 建表 SQL
-- 写入全部通过 SECURITY DEFINER RPC 函数，前端不直接写表
-- 执行方式：在 Supabase SQL Editor 里全选运行
-- ============================================================

-- 遇到已存在对象时先丢弃
DROP TABLE IF EXISTS inventory_logs;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS profiles;

-- ============================================================
-- 1. 用户档案（同步飞书免登用户）
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feishu_user_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('super_admin','admin','employee')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. 产品表
-- ============================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  short_name TEXT,
  sku TEXT UNIQUE,
  current_stock INT NOT NULL DEFAULT 0,
  min_stock_alert INT NOT NULL DEFAULT 10,
  unit TEXT DEFAULT '个',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. 订单表（order_no 由应用层生成）
-- ============================================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  customer_address TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','shipped','completed','cancelled')),
  remark TEXT,
  creator_id UUID REFERENCES profiles(id),
  creator_name TEXT,
  serial_no TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. 订单明细
-- ============================================================
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. 库存变动日志
-- ============================================================
CREATE TABLE inventory_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('order_out','restock','adjust','return')),
  quantity INT NOT NULL,
  order_id UUID REFERENCES orders(id),
  remark TEXT,
  creator_id UUID REFERENCES profiles(id),
  creator_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX idx_orders_creator ON orders(creator_id);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_inventory_logs_product ON inventory_logs(product_id);
CREATE INDEX idx_inventory_logs_created_at ON inventory_logs(created_at DESC);
CREATE INDEX idx_profiles_feishu ON profiles(feishu_user_id);

-- ============================================================
-- RLS：启用，但只开放 SELECT
-- 写入全部通过 SECURITY DEFINER RPC 完成
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_logs ENABLE ROW LEVEL SECURITY;

-- 所有登录用户（anon key）均可读取各表
CREATE POLICY profiles_select ON profiles FOR SELECT USING (true);
CREATE POLICY products_select ON products FOR SELECT USING (true);
CREATE POLICY orders_select ON orders FOR SELECT USING (true);
CREATE POLICY order_items_select ON order_items FOR SELECT USING (true);
CREATE POLICY inventory_logs_select ON inventory_logs FOR SELECT USING (true);

-- 不创建 INSERT/UPDATE/DELETE 策略 → anon key 直接写入被拒绝
-- 写入只能通过下面的 SECURITY DEFINER RPC 函数完成

-- ============================================================
-- RPC 函数
-- ============================================================

-- 辅助：根据 feishu_user_id 获取角色（函数内以 postgres 权限运行）
CREATE OR REPLACE FUNCTION get_role_by_feishu(feishu_uid TEXT)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE feishu_user_id = feishu_uid LIMIT 1;
$$;

-- 辅助：根据 feishu_user_id 获取 UUID
CREATE OR REPLACE FUNCTION get_profile_id_by_feishu(feishu_uid TEXT)
RETURNS UUID LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM profiles WHERE feishu_user_id = feishu_uid LIMIT 1;
$$;

-- ============ 用户档案 upsert（登录时调用）============
CREATE OR REPLACE FUNCTION upsert_profile(
  p_feishu_user_id TEXT,
  p_name TEXT,
  p_role TEXT DEFAULT 'employee'
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM profiles WHERE feishu_user_id = p_feishu_user_id;
  IF FOUND THEN
    UPDATE profiles SET name = p_name WHERE id = v_id;
    RETURN v_id;
  ELSE
    INSERT INTO profiles(feishu_user_id, name, role)
    VALUES (p_feishu_user_id, p_name, p_role)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
END;
$$;

-- ============ 修改用户角色（仅超管）============
CREATE OR REPLACE FUNCTION change_user_role(
  p_target_feishu_id TEXT,
  p_new_role TEXT,
  p_operator_feishu_id TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_operator_role TEXT;
BEGIN
  SELECT role INTO v_operator_role FROM profiles WHERE feishu_user_id = p_operator_feishu_id;
  IF v_operator_role != 'super_admin' THEN
    RAISE EXCEPTION '无权限：仅超管可修改用户角色';
  END IF;
  IF p_new_role NOT IN ('super_admin','admin','employee') THEN
    RAISE EXCEPTION '无效的角色：%', p_new_role;
  END IF;
  UPDATE profiles SET role = p_new_role WHERE feishu_user_id = p_target_feishu_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '目标用户不存在';
  END IF;
END;
$$;

-- ============ 产品写入 ============
CREATE OR REPLACE FUNCTION upsert_product(
  p_id UUID,
  p_name TEXT,
  p_short_name TEXT,
  p_sku TEXT,
  p_stock INT,
  p_alert INT,
  p_unit TEXT,
  p_feishu_user_id TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_id UUID;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE feishu_user_id = p_feishu_user_id;
  IF v_role NOT IN ('super_admin','admin') THEN
    RAISE EXCEPTION '无权限：需要管理员及以上';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE products SET
      name = p_name,
      short_name = NULLIF(p_short_name, ''),
      sku = NULLIF(p_sku, ''),
      current_stock = p_stock,
      min_stock_alert = p_alert,
      unit = p_unit,
      updated_at = now()
    WHERE id = p_id;
    v_id := p_id;
  ELSE
    INSERT INTO products(name, short_name, sku, current_stock, min_stock_alert, unit)
    VALUES (p_name, NULLIF(p_short_name, ''), NULLIF(p_sku, ''), p_stock, p_alert, p_unit)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_product(
  p_id UUID,
  p_feishu_user_id TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE feishu_user_id = p_feishu_user_id;
  IF v_role != 'super_admin' THEN
    RAISE EXCEPTION '无权限：仅超管可删除产品';
  END IF;
  DELETE FROM products WHERE id = p_id;
END;
$$;

-- ============ 订单写入（含库存联动 + 日志）============
CREATE OR REPLACE FUNCTION upsert_order(
  p_order_id UUID,
  p_order_no TEXT,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_customer_address TEXT,
  p_status TEXT,
  p_remark TEXT,
  p_serial_no TEXT,
  p_items JSONB,
  p_feishu_user_id TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_profile_id UUID;
  v_order_id UUID;
  v_record RECORD;
BEGIN
  SELECT role, id INTO v_role, v_profile_id
  FROM profiles WHERE feishu_user_id = p_feishu_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '用户不存在';
  END IF;

  -- 编辑：仅超管/管理员
  IF p_order_id IS NOT NULL THEN
    IF v_role NOT IN ('super_admin','admin') THEN
      RAISE EXCEPTION '无权限：不能编辑订单';
    END IF;
    v_order_id := p_order_id;

    -- 恢复旧库存
    FOR v_record IN SELECT product_id, quantity FROM order_items WHERE order_id = v_order_id LOOP
      UPDATE products SET current_stock = current_stock + v_record.quantity, updated_at = now()
      WHERE id = v_record.product_id;
    END LOOP;

    -- 删除旧明细
    DELETE FROM order_items WHERE order_id = v_order_id;

    -- 更新订单头
    UPDATE orders SET
      customer_name = p_customer_name,
      customer_phone = NULLIF(p_customer_phone, ''),
      customer_email = NULLIF(p_customer_email, ''),
      customer_address = p_customer_address,
      status = p_status,
      remark = NULLIF(p_remark, ''),
      serial_no = NULLIF(p_serial_no, ''),
      updated_at = now()
    WHERE id = v_order_id;

  -- 新增：员工及以上
  ELSE
    IF v_role NOT IN ('super_admin','admin','employee') THEN
      RAISE EXCEPTION '无权限：不能创建订单';
    END IF;
    INSERT INTO orders(
      order_no, customer_name, customer_phone, customer_email,
      customer_address, status, remark, creator_id, creator_name, serial_no
    ) VALUES (
      p_order_no, p_customer_name, NULLIF(p_customer_phone, ''), NULLIF(p_customer_email, ''),
      p_customer_address, p_status, NULLIF(p_remark, ''),
      v_profile_id,
      (SELECT name FROM profiles WHERE feishu_user_id = p_feishu_user_id),
      NULLIF(p_serial_no, '')
    ) RETURNING id INTO v_order_id;
  END IF;

  -- 插入新明细、扣库存、写日志
  FOR v_record IN SELECT * FROM jsonb_to_recordset(p_items) AS t(product_id UUID, quantity INT, unit_price NUMERIC) LOOP
    INSERT INTO order_items(order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_record.product_id, v_record.quantity, v_record.unit_price);

    UPDATE products SET current_stock = current_stock - v_record.quantity, updated_at = now()
    WHERE id = v_record.product_id;

    INSERT INTO inventory_logs(product_id, change_type, quantity, order_id, remark, creator_id, creator_name)
    VALUES (
      v_record.product_id, 'order_out', -v_record.quantity, v_order_id,
      '订单出库:' || p_customer_name,
      v_profile_id,
      (SELECT name FROM profiles WHERE feishu_user_id = p_feishu_user_id)
    );
  END LOOP;

  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_order(
  p_order_id UUID,
  p_feishu_user_id TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE feishu_user_id = p_feishu_user_id;
  IF v_role != 'super_admin' THEN
    RAISE EXCEPTION '无权限：仅超管可删除订单';
  END IF;

  -- 恢复库存（利用 FOR ... IN SELECT 游标遍历）
  UPDATE products p
  SET current_stock = p.current_stock + oi.quantity, updated_at = now()
  FROM order_items oi
  WHERE oi.order_id = p_order_id AND oi.product_id = p.id;

  DELETE FROM orders WHERE id = p_order_id;
  -- order_items 由 CASCADE 自动删除
END;
$$;

-- ============ 库存手动调整 ============
CREATE OR REPLACE FUNCTION adjust_inventory(
  p_product_id UUID,
  p_change_type TEXT,
  p_quantity INT,
  p_remark TEXT,
  p_feishu_user_id TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_qty INT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE feishu_user_id = p_feishu_user_id;
  IF v_role NOT IN ('super_admin','admin') THEN
    RAISE EXCEPTION '无权限：需要管理员及以上';
  END IF;

  v_qty := CASE WHEN p_change_type = 'restock' THEN p_quantity ELSE -p_quantity END;

  UPDATE products SET current_stock = current_stock + v_qty, updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO inventory_logs(product_id, change_type, quantity, remark, creator_id, creator_name)
  VALUES (
    p_product_id, p_change_type, v_qty, NULLIF(p_remark, ''),
    (SELECT id FROM profiles WHERE feishu_user_id = p_feishu_user_id),
    (SELECT name FROM profiles WHERE feishu_user_id = p_feishu_user_id)
  );
END;
$$;

COMMENT ON TABLE products IS '产品主数据';
COMMENT ON TABLE orders IS '订单主表';
COMMENT ON TABLE order_items IS '订单明细';
COMMENT ON TABLE inventory_logs IS '库存变动日志';
COMMENT ON TABLE profiles IS '用户档案（对应飞书用户）';
