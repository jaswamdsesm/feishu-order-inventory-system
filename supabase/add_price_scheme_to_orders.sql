-- 迁移：orders 表增加 price_scheme_id 列，并更新 upsert_order RPC
-- 请在 Supabase Dashboard → SQL Editor 中执行

-- ============================================================
-- 第1步：添加列（可重复执行）
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_scheme_id UUID REFERENCES price_schemes(id);

-- ============================================================
-- 第2步：删除旧 RPC（签名必须完全匹配）
-- ============================================================
DROP FUNCTION IF EXISTS public.upsert_order(
  uuid, text, text, text, text, text,
  integer, numeric, text, text, jsonb,
  text, text, numeric, text, text, text,
  text, numeric, numeric, numeric, numeric, numeric,
  text
);

-- ============================================================
-- 第3步：重建 upsert_order，增加 p_price_scheme_id 参数
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_order(
  p_id                   uuid,
  p_order_no             text,
  p_customer_name        text,
  p_customer_phone       text,
  p_customer_address     text,
  p_country              text,
  p_product_summary      text,
  p_total_quantity       integer,
  p_total_amount         numeric,
  p_status               text,
  p_feishu_user_id      text,
  p_items                jsonb,
  p_shipping_fee         text,
  p_payment_method       text,
  p_handling_fee         numeric,
  p_order_date           text,
  p_remark               text,
  p_tracking_no          text,
  p_settlement_currency text,
  p_exchange_rate        numeric,
  p_cny_exchange_rate   numeric,
  p_total_cny            numeric,
  p_goods_cny            numeric,
  p_shipping_cny         numeric,
  p_handling_cny         numeric,
  p_owner_name           text,
  p_price_scheme_id     uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id      uuid;
  v_old_status    text;
  v_is_insert     boolean;
BEGIN
  -- 查找现有订单
  IF p_id IS NOT NULL THEN
    SELECT id, status
      INTO v_order_id, v_old_status
      FROM orders WHERE id = p_id;
  END IF;

  v_is_insert := v_order_id IS NULL;

  -- INSERT 或 UPDATE orders
  IF v_is_insert THEN
    INSERT INTO orders (
      order_no,            customer_name,  customer_phone,
      customer_address,    country,        product_summary,
      total_quantity,      total_amount,   status,
      feishu_user_id,     items,          settlement_currency,
      exchange_rate,       cny_exchange_rate,
      total_cny,           goods_cny,
      shipping_cny,        handling_cny,
      shipping_fee,        payment_method, handling_fee,
      order_date,          remark,         tracking_no,
      owner_name,          price_scheme_id
    ) VALUES (
      p_order_no,             p_customer_name,        p_customer_phone,
      p_customer_address,     p_country,              p_product_summary,
      p_total_quantity,       p_total_amount,         p_status,
      p_feishu_user_id,      p_items,                 p_settlement_currency,
      p_exchange_rate,        p_cny_exchange_rate,
      p_total_cny,            p_goods_cny,
      p_shipping_cny,         p_handling_cny,
      p_shipping_fee,         p_payment_method,        p_handling_fee,
      p_order_date,           p_remark,               p_tracking_no,
      p_owner_name,           p_price_scheme_id
    )
    RETURNING id INTO v_order_id;
  ELSE
    UPDATE orders SET
      order_no             = p_order_no,
      customer_name        = p_customer_name,
      customer_phone      = p_customer_phone,
      customer_address    = p_customer_address,
      country             = p_country,
      product_summary     = p_product_summary,
      total_quantity      = p_total_quantity,
      total_amount        = p_total_amount,
      status              = p_status,
      items               = p_items,
      settlement_currency = p_settlement_currency,
      exchange_rate       = p_exchange_rate,
      cny_exchange_rate  = p_cny_exchange_rate,
      total_cny           = p_total_cny,
      goods_cny           = p_goods_cny,
      shipping_cny        = p_shipping_cny,
      handling_cny        = p_handling_cny,
      shipping_fee        = p_shipping_fee,
      payment_method      = p_payment_method,
      handling_fee        = p_handling_fee,
      order_date          = p_order_date,
      remark              = p_remark,
      tracking_no         = p_tracking_no,
      owner_name          = p_owner_name,
      price_scheme_id     = p_price_scheme_id,
      updated_at          = now()
    WHERE id = v_order_id;
  END IF;

  -- 写入 order_items（先删后插）
  DELETE FROM order_items WHERE order_id = v_order_id;
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    INSERT INTO order_items (order_id, product_id, quantity, unit_price)
    SELECT
      v_order_id,
      (item->>'product_id')::uuid,
      (item->>'quantity')::integer,
      (item->>'unit_price')::numeric
    FROM jsonb_array_elements(p_items) AS item;
  END IF;

  RETURN v_order_id;
END;
$$;

-- 权限（匿名 key 通过 RPC 调用，需要 EXECUTE 权限）
GRANT EXECUTE ON FUNCTION public.upsert_order(
  uuid, text, text, text, text, text,
  integer, numeric, text, text, jsonb,
  text, text, numeric, text, text, text,
  text, numeric, numeric, numeric, numeric, numeric,
  text, uuid
) TO anon, authenticated, service_role;
