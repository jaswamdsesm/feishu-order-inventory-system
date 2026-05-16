-- =============================================
-- 分销功能建表 SQL
-- 在 Supabase Dashboard → SQL Editor 中执行
-- =============================================

-- 1. 分销关系表
CREATE TABLE IF NOT EXISTS distribution_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_customer_name text NOT NULL,           -- 推荐人（客户A）姓名
  referred_customer_name text NOT NULL,           -- 被推荐人（客户B）姓名
  referred_customer_phone text,                   -- 被推荐人电话（辅助唯一判定）
  referrer_owner_name text,                       -- 推荐人归属销售
  status text NOT NULL DEFAULT 'active',          -- active / inactive
  note text,                                      -- 备注
  created_by text,                                -- 创建人 feishu_uid
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- 2. RLS
ALTER TABLE distribution_relations ENABLE ROW LEVEL SECURITY;

-- 所有人可读（前端需要查询分销关系来标记订单）
CREATE POLICY "distribution_read_all" ON distribution_relations
  FOR SELECT USING (true);

-- 管理员/创建人可写（通过 RPC 绕过 RLS）

-- 3. RPC: 绑定分销关系
CREATE OR REPLACE FUNCTION upsert_distribution_relation(
  p_id uuid DEFAULT NULL,
  p_referrer_customer_name text,
  p_referred_customer_name text,
  p_referred_customer_phone text DEFAULT NULL,
  p_referrer_owner_name text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_note text DEFAULT NULL,
  p_created_by text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO distribution_relations (
    id, referrer_customer_name, referred_customer_name, referred_customer_phone,
    referrer_owner_name, status, note, created_by
  ) VALUES (
    p_id, p_referrer_customer_name, p_referred_customer_name, p_referred_customer_phone,
    p_referrer_owner_name, p_status, p_note, p_created_by
  )
  ON CONFLICT (id) DO UPDATE SET
    referrer_customer_name = EXCLUDED.referrer_customer_name,
    referred_customer_name = EXCLUDED.referred_customer_name,
    referred_customer_phone = EXCLUDED.referred_customer_phone,
    referrer_owner_name = EXCLUDED.referrer_owner_name,
    status = EXCLUDED.status,
    note = EXCLUDED.note
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC: 查询分销关系（按被推荐人姓名查，返回推荐人信息）
CREATE OR REPLACE FUNCTION get_distribution_for_customer(
  p_customer_name text
) RETURNS TABLE (
  id uuid,
  referrer_customer_name text,
  referred_customer_name text,
  referred_customer_phone text,
  referrer_owner_name text,
  status text,
  note text
) AS $$
BEGIN
  RETURN QUERY
  SELECT dr.id, dr.referrer_customer_name, dr.referred_customer_name,
         dr.referred_customer_phone, dr.referrer_owner_name, dr.status, dr.note
  FROM distribution_relations dr
  WHERE LOWER(dr.referred_customer_name) = LOWER(p_customer_name)
    AND dr.status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC: 删除分销关系（软删除）
CREATE OR REPLACE FUNCTION delete_distribution_relation(
  p_id uuid
) RETURNS void AS $$
BEGIN
  UPDATE distribution_relations SET status = 'inactive' WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RPC: 分销统计（按推荐人汇总）
CREATE OR REPLACE FUNCTION get_distribution_stats(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  -- 按推荐人汇总：分销订单数量和总金额
  SELECT json_agg(row_to_json(t)) INTO v_result
  FROM (
    SELECT
      dr.referrer_customer_name,
      dr.referrer_owner_name,
      COUNT(DISTINCT o.id) AS order_count,
      COALESCE(SUM(o.total_cny), 0) AS total_cny
    FROM distribution_relations dr
    JOIN orders o ON LOWER(o.customer_name) = LOWER(dr.referred_customer_name)
      AND o.status NOT IN ('cancelled')
    WHERE dr.status = 'active'
      AND (p_date_from IS NULL OR o.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at::date <= p_date_to)
    GROUP BY dr.referrer_customer_name, dr.referrer_owner_name
    ORDER BY order_count DESC
  ) t;

  RETURN COALESCE(v_result, '[]'::JSON);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
