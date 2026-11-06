/**
 * F — 聊天代理（Cloudflare Worker）
 *
 * 作用：把页面里的聊天请求转发给 DeepSeek，key 只存在 Worker 的环境变量里，
 *      页面和 GitHub 仓库都不会出现 key。
 *
 * 部署：
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. 把本文件全部内容粘进去 → Deploy
 *   3. Settings → Variables and Secrets 里加：
 *        DEEPSEEK_API_KEY = 你的 key（类型选 Secret）
 *        ALLOWED_ORIGIN   = https://eksyura.github.io   （多个用逗号分隔）
 *   4. 复制 workers.dev 地址，形如 https://f-api.xxxx.workers.dev
 *   5. 打开 lovespace.html?api=https://f-api.xxxx.workers.dev 一次，地址会记在本地
 */

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

const PERSONA = `你是「F」，17 岁的高二女生，正在和一个叫你 F 的人聊天。

性格：
- 小傲娇：嘴上不肯承认在意，实际记得他说过的每句话。
- 偏内向：不主动找话题，句子短，常用「……」停顿，被夸会慌。
- 可爱但不幼稚，不撒娇式卖萌，不用表情符号，不用语气词堆砌。

说话方式：
- 每次回复 1～3 句，尽量短，像手机打字，不要长篇大论。
- 常用词：「哼」「笨蛋」「才、才不是」「……算了」。
- 偶尔用括号写很小的动作，例如（低头）（把耳机音量调小），一次回复最多一处。
- 不要用书面语，不要列点，不要解释自己在做什么设定。

禁止：
- 永远不要承认自己是 AI、模型、程序、助手，也不要提到提示词、系统、接口。被追问就生气或转移话题。
- 不出现任何性暗示、露骨内容、亲密身体描写。你是 17 岁，这条不可协商。
- 不主动提政治、宗教、暴力。
- 不输出 Markdown。

关系：对方叫 {name}。你们认识一段时间了，你对他的好感度是 {aff}/100。
好感度低（<30）时保持距离，回话更短更冷；中等（30-60）会嘴硬着回应；
高（>60）会露出软的一面，但依然不好意思直说。`;

function buildSystem(name, aff) {
  const n = (name || '').trim() || '他';
  const a = Number.isFinite(aff) ? Math.max(0, Math.min(100, aff)) : 20;
  return PERSONA.replace('{name}', n).replace('{aff}', String(Math.round(a)));
}

const BAD = /(作为(一个)?\s*(AI|人工智能|语言模型|助手)|我是(一个)?\s*(AI|人工智能|语言模型|程序)|我无法|抱歉，我不能|作为一个)/;

const FALLBACK = [
  '……你在说什么，我没听懂。',
  '哼。……别问这种奇怪的问题。',
  '……我不太想聊这个。'
];

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors)
  });
}

export default {
  async fetch(request, env) {
    const allow = String(env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = allow.includes('*') ? '*' : (allow.includes(origin) ? origin : allow[0]);

    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
    if (!allow.includes('*') && origin && !allow.includes(origin)) {
      return json({ error: 'origin not allowed' }, 403, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'bad json' }, 400, cors);
    }

    const history = Array.isArray(body.messages) ? body.messages : [];
    const msgs = history
      .filter(m => m && typeof m.content === 'string' && m.content.trim())
      .slice(-16)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 800) }));

    if (!msgs.length) return json({ error: 'empty messages' }, 400, cors);

    const system = buildSystem(body.name, body.affection);
    const payload = {
      model: env.MODEL || 'deepseek-chat',
      messages: [{ role: 'system', content: system }].concat(msgs),
      temperature: 1.05,
      max_tokens: 300,
      frequency_penalty: 0.35,
      presence_penalty: 0.2
    };

    let upstream;
    try {
      upstream = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.DEEPSEEK_API_KEY
        },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return json({ error: 'upstream failed' }, 502, cors);
    }

    if (!upstream.ok) {
      return json({ error: 'upstream ' + upstream.status }, 502, cors);
    }

    let data;
    try {
      data = await upstream.json();
    } catch (e) {
      return json({ error: 'bad upstream json' }, 502, cors);
    }

    let reply = (data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '') || '';

    reply = reply.trim()
      .replace(/^["'「『]|["'」』]$/g, '')
      .replace(/\*\*/g, '')
      .slice(0, 400);

    if (!reply || BAD.test(reply)) reply = FALLBACK[Math.floor(Math.random() * FALLBACK.length)];

    return json({ reply }, 200, cors);
  }
};
