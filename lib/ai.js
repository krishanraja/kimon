// One grounded answer from Claude, with live web search and fetch limited to
// trusted medical sources. Uses a direct Anthropic key when set, otherwise the
// Vercel AI Gateway authenticated by the deployment's OIDC token.
import Anthropic from '@anthropic-ai/sdk';

// Trusted sources only: Australian health bodies, guideline societies, journals.
export const TRUSTED_DOMAINS = [
  'heartfoundation.org.au', 'healthdirect.gov.au', 'racgp.org.au', 'betterhealth.vic.gov.au',
  'health.vic.gov.au', 'health.gov.au', 'pbs.gov.au', 'mbsonline.gov.au', 'msac.gov.au',
  'servicesaustralia.gov.au', 'tga.gov.au', 'nps.org.au', 'tg.org.au', 'mja.com.au', 'csanz.edu.au',
  'vved.org.au', 'thermh.org.au', 'alfredhealth.org.au', 'austin.org.au', 'diabetesaustralia.com.au',
  'kidney.org.au', 'stroke.org.au', 'escardio.org', 'acc.org', 'jacc.org', 'ahajournals.org',
  'heart.org', 'nih.gov', 'medlineplus.gov', 'nhs.uk', 'nice.org.uk', 'mayoclinic.org',
  'clevelandclinic.org', 'uspreventiveservicestaskforce.org', 'cochranelibrary.com', 'bmj.com',
  'thelancet.com', 'nejm.org', 'jamanetwork.com', 'academic.oup.com', 'springer.com', 'ndph.ox.ac.uk',
];

const DIRECT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL || 'anthropic/claude-opus-5.5';

function gatewayToken(req) {
  return process.env.AI_GATEWAY_API_KEY || req?.headers?.['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
}

export function aiProvider(req) {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return gatewayToken(req) ? 'gateway' : null;
}

function client(req) {
  if (process.env.ANTHROPIC_API_KEY) return { c: new Anthropic({ timeout: 150000, maxRetries: 1 }), model: DIRECT_MODEL };
  return { c: new Anthropic({ apiKey: gatewayToken(req), baseURL: 'https://ai-gateway.vercel.sh', timeout: 150000, maxRetries: 1 }), model: GATEWAY_MODEL };
}

// Tool sets from richest to plainest. If the route rejects one, try the next.
const TOOLSETS = [
  { name: 'search+fetch', tools: [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 4, allowed_domains: TRUSTED_DOMAINS, user_location: { type: 'approximate', city: 'Melbourne', region: 'Victoria', country: 'AU', timezone: 'Australia/Melbourne' } },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, allowed_domains: TRUSTED_DOMAINS },
  ] },
  { name: 'search', tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4, allowed_domains: TRUSTED_DOMAINS }] },
  { name: 'none', tools: [] },
];

// Collect every URL the model actually saw from search or fetch.
function seenSources(content, into) {
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) into.set(r.url, r.title || r.url);
    }
    if (b.type === 'web_fetch_tool_result' && b.content && b.content.url) {
      into.set(b.content.url, b.content.content?.title || b.content.url);
    }
  }
}

export async function complete({ system, user, req }) {
  if (!aiProvider(req)) { const e = new Error('no AI provider configured'); e.code = 'NO_AI'; throw e; }
  const { c, model } = client(req);
  let lastErr;
  for (const set of TOOLSETS) {
    try {
      const messages = [{ role: 'user', content: user }];
      const sources = new Map();
      let res, searches = 0;
      // Server tools can pause a long turn; resume it, at most three times.
      for (let i = 0; i < 4; i++) {
        res = await c.messages.create({
          model, max_tokens: 16000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          output_config: { effort: 'medium' },
          ...(set.tools.length ? { tools: set.tools } : {}),
          messages,
        });
        seenSources(res.content, sources);
        searches += res.content.filter(b => b.type === 'server_tool_use').length;
        if (res.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: res.content });
      }
      if (res.stop_reason === 'refusal') { const e = new Error('model declined'); e.code = 'REFUSAL'; throw e; }
      // The answer is the text after the last tool result.
      let lastTool = -1;
      res.content.forEach((b, i) => { if (/_tool_result$|server_tool_use/.test(b.type)) lastTool = i; });
      const text = res.content.slice(lastTool + 1).filter(b => b.type === 'text').map(b => b.text).join('');
      console.log(JSON.stringify({ ai: aiProvider(req), tools: set.name, stop: res.stop_reason, searches, sources: sources.size, textLen: text.length, usage: res.usage }));
      return { text, model, tools: set.name, sources: [...sources].map(([url, title]) => ({ url, title })) };
    } catch (e) {
      lastErr = e;
      // Only a rejected request shape is worth retrying with a plainer tool set.
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      console.error(JSON.stringify({ aiToolsetRejected: set.name, message: String(e.message).slice(0, 200) }));
    }
  }
  throw lastErr;
}
