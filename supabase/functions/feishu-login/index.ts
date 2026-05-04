// Supabase Edge Function - 飞书免登代理
// 部署：supabase functions deploy feishu-login --project-ref pvrfqnffygusujsnxsct

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabase = createClient(
  Deno.env.get('SB_URL')!,
  Deno.env.get('SB_SERVICE_KEY')!
);

function getFeishuSecret(appId: string): string | null {
  if (appId === 'cli_a9726837c7789cc5') return Deno.env.get('FEISHU_APP_SECRET_NEW')!;
  if (appId === 'cli_a9798d7b37781bdf') return Deno.env.get('FEISHU_APP_SECRET_OLD')!;
  return null;
}

// 获取飞书 app_access_token
async function getAppAccessToken(appId: string, appSecret: string): Promise<string> {
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json();
  if (!data.app_access_token) {
    throw new Error('获取 app_access_token 失败: ' + JSON.stringify(data));
  }
  return data.app_access_token;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
      },
    });
  }

  try {
    const { code, app_id } = await req.json();
    if (!code || !app_id) {
      return new Response(JSON.stringify({ success: false, error: '缺少 code 或 app_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const appSecret = getFeishuSecret(app_id);
    if (!appSecret) {
      return new Response(JSON.stringify({ success: false, error: '未知的 app_id: ' + app_id }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 1. 获取 app_access_token
    const appAccessToken = await getAppAccessToken(app_id, appSecret);
    console.log('app_access_token 获取成功');

    // 2. 用 code 换用户 access_token
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: Deno.env.get('REDIRECT_URI') || 'https://jaswamdsesm.github.io/feishu-order-inventory-system/',
      }),
    });
    const tokenData = await tokenResp.json();
    console.log('飞书 token 响应:', JSON.stringify(tokenData));
    if (!tokenData.access_token) {
      return new Response(JSON.stringify({ success: false, error: '飞书授权失败', detail: tokenData }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 3. 获取用户信息
    const userResp = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userResp.json();
    console.log('飞书用户信息响应:', JSON.stringify(userData));
    if (!userData.data) {
      return new Response(JSON.stringify({ success: false, error: '获取用户信息失败', detail: userData }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const feishuUser = userData.data;
    const feishuUserId = feishuUser.sub;

    // 4. 调用 RPC 写入/更新 profiles
    const { error: rpcError } = await supabase.rpc('upsert_profile', {
      p_feishu_user_id: feishuUserId,
      p_name: feishuUser.name || feishuUser.username || '未知用户',
      p_role: null,
    });
    if (rpcError) console.error('upsert_profile 失败:', rpcError);

    // 5. 查询完整 profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('feishu_user_id', feishuUserId)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: profile?.id || feishuUserId,
          feishu_user_id: feishuUserId,
          name: profile?.name || feishuUser.name || '未知用户',
          role: profile?.role || 'employee',
          avatar: feishuUser.avatar_url || '',
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (err) {
    console.error('Edge Function 异常:', err.message);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
