/**
 * Cloudflare Worker: GitHub OAuth Device Flow proxy + static asset server
 * for the JSON Airspace Configurator.
 *
 * Why this Worker exists:
 *   GitHub's device-flow endpoints (login/device/code and login/oauth/access_token)
 *   do NOT send CORS headers, so a browser cannot call them directly. This Worker
 *   is a thin server-side proxy: the browser calls our same-origin /api/* routes,
 *   the Worker forwards them to GitHub, and relays the JSON back with CORS headers.
 *
 *   Device Flow needs NO client secret, so there are no secrets in this file.
 *   The only configuration value is GITHUB_CLIENT_ID (public by nature), set as a
 *   Worker variable in wrangler.toml or the Cloudflare dashboard.
 *
 * Routes:
 *   POST /api/device/code   -> proxies https://github.com/login/device/code
 *   POST /api/device/token  -> proxies https://github.com/login/oauth/access_token
 *   GET  /*                 -> serves static assets (index.html, app.js, ...)
 */

const GH_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GH_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

// The repo this app edits. Used to scope the device-flow request.
// (Scope is advisory for classic OAuth apps; real enforcement is GitHub's
//  per-user permission check at commit time.)
const DEFAULT_SCOPE = 'repo';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

async function requestDeviceCode(env, origin) {
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return json({ error: 'server_misconfigured', error_description: 'GITHUB_CLIENT_ID is not set on the Worker.' }, 500, origin);
  }
  const res = await fetch(GH_DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: DEFAULT_SCOPE }),
  });
  const data = await res.json().catch(() => ({ error: 'bad_github_response' }));
  return json(data, res.status, origin);
}

async function pollForToken(env, origin, deviceCode) {
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return json({ error: 'server_misconfigured', error_description: 'GITHUB_CLIENT_ID is not set on the Worker.' }, 500, origin);
  }
  if (!deviceCode) {
    return json({ error: 'missing_device_code' }, 400, origin);
  }
  const res = await fetch(GH_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  // GitHub returns 200 with { error: "authorization_pending" } while waiting,
  // and 200 with { access_token } once authorized. Relay verbatim.
  const data = await res.json().catch(() => ({ error: 'bad_github_response' }));
  return json(data, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/api/device/code' && request.method === 'POST') {
      return requestDeviceCode(env, origin);
    }

    if (url.pathname === '/api/device/token' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return pollForToken(env, origin, body.device_code);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not_found' }, 404, origin);
    }

    // Everything else: static assets (configured via [assets] in wrangler.toml).
    // env.ASSETS is the static-asset binding Cloudflare injects.
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Static assets binding not configured.', { status: 500 });
  },
};
