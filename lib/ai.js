// One model call. Prefers a direct Anthropic key if configured, otherwise the
// Vercel AI Gateway authenticated by the deployment's OIDC token.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL || 'anthropic/claude-sonnet-5.5';

export function aiProvider(req) {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || req?.headers?.['x-vercel-oidc-token']) return 'gateway';
  return null;
}

export async function complete({ system, user, req, maxTokens = 1800, timeoutMs = 50000 }) {
  const provider = aiProvider(req);
  if (!provider) { const e = new Error('no AI provider configured'); e.code = 'NO_AI'; throw e; }
  const signal = AbortSignal.timeout(timeoutMs);

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL, max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${body?.error?.message || 'error'}`);
    return { text: (body.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), provider, model: ANTHROPIC_MODEL };
  }

  const token = process.env.AI_GATEWAY_API_KEY || req?.headers?.['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
  const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: GATEWAY_MODEL, max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`gateway ${r.status}: ${body?.error?.message || JSON.stringify(body).slice(0, 160)}`);
  return { text: body.choices?.[0]?.message?.content || '', provider, model: GATEWAY_MODEL };
}
