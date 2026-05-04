# Supabase Edge Function 部署指南

## 第一步：安装 Supabase CLI

```bash
npm install -g supabase
```

## 第二步：登录 Supabase

```bash
supabase login
```

## 第三步：初始化（如果还没有）

在项目根目录执行：
```bash
supabase init
```

## 第四步：部署 Edge Function

```bash
supabase functions deploy feishu-login --project-ref pvrfqnffygusujsnxsct
```

部署成功后，接口地址为：
```
https://pvrfqnffygusujsnxsct.functions.supabase.co/feishu-login
```

## 第五步：配置 Secrets

在 Supabase 后台（Settings → API → Project API keys 下方有 Secrets 管理），或者通过 CLI：

```bash
supabase secrets set FEISHU_APP_SECRET_NEW=你的新飞书应用app_secret --project-ref pvrfqnffygusujsnxsct
supabase secrets set FEISHU_APP_SECRET_OLD=旧飞书应用app_secret（可选）--project-ref pvrfqnffygusujsnxsct
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=你的service_role_key --project-ref pvrfqnffygusujsnxsct
```

> `service_role_key` 在 Supabase 后台 Settings → API → service_role key（secret）

## 第六步：更新 app.js 中的登录接口地址

打开 `app.js`，找到这一行：
```js
const resp=await fetch('https://www.jiasu123.com/api/feishu-login',{
```

改为：
```js
const resp=await fetch('https://pvrfqnffygusujsnxsct.functions.supabase.co/feishu-login',{
```

## 第七步：推送 GitHub

```bash
cd D:\WORKBUDDY\feishu-order-inventory-system
python push_github.py "feat: 更新登录接口为 Supabase Edge Function"
```

---

## 常见问题

**Q: 部署失败，提示没有 supabase config？**
A: 在项目根目录运行 `supabase init`，然后重新 deploy。

**Q: Edge Function 调用失败？**
A: 检查 Secrets 是否配置正确，可以在 Supabase 后台 Functions 页面查看日志。

**Q: CORS 错误？**
A: Edge Function 代码里已经加了 CORS headers，如果还有问题，检查请求的 origin。
