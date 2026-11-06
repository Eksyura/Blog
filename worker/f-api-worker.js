/**
 * F — 聊天代理（Cloudflare Worker，可选）
 *
 * 什么时候需要它：如果你不想把 API key 放进网页源码（那样任何人查看源代码都能看到），
 * 就把 key 放在这里，页面里只写 Worker 地址 + 任意占位 key。
 *
 * 部署：
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. 粘贴本文件全部内容 → Deploy
 *   3. Settings → Variables and Secrets 加：
 *        UPSTREAM_KEY   = 你的 key（类型选 Secret，硅基流动/DeepSeek 都行）
 *        UPSTREAM_URL   = https://api.siliconflow.cn/v1/chat/completions （可省，默认就是它）
 *        ALLOWED_ORIGIN = https://eksyura.github.io  （多个用逗号分隔，默认 *）
 *   4. 复制地址，比如 https://f-api.xxxx.workers.dev
 *   5. 打开聊天页 → 点「AI」→ 接口地址填这个地址，模型填 Qwen/Qwen2.5-7B-Instruct，
 *      Key 随便填一个非空值（例如 x）→ 保存
 *
 * 页面会请求 <接口地址>/chat/completions，本 Worker 原样转发给上游并流式回传。
 */

function corsHeaders(env, origin) {
  const allow = String(env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allow.includes('*') ? '*' : (allow.includes(origin) ? origin : allow[0]);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405, headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }

    const upstreamUrl = env.UPSTREAM_URL || 'https://api.siliconflow.cn/v1/chat/completions';
    const body = await request.text();

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.UPSTREAM_KEY
        },
        body
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'upstream failed' }), {
        status: 502, headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: Object.assign({
        'Content-Type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache'
      }, cors)
    });
  }
};
