'use strict';

const {
  NseInvestConfigError,
  READ_ACTIONS,
  isAuthorized,
  loadConfig,
  missingEnvironment,
  requestNseInvest
} = require('../lib/nseinvest');

function secureHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function parseRequestBody(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  if (typeof body !== 'string' || !body.trim()) return {};
  return JSON.parse(body);
}

module.exports = async function nseInvest(req, res) {
  secureHeaders(res);

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Only GET and POST requests are supported.' });
  }

  const missing = missingEnvironment();
  if (missing.length) {
    return res.status(503).json({
      ok: false,
      configured: false,
      error: 'NSEInvest server configuration is incomplete.'
    });
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof NseInvestConfigError) {
      return res.status(503).json({ ok: false, configured: false, error: 'NSEInvest server configuration is invalid.' });
    }
    return res.status(500).json({ ok: false, error: 'Unable to load NSEInvest configuration.' });
  }

  if (!isAuthorized(req, config.adminToken)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      configured: true,
      environment: config.baseUrl.hostname.includes('uat') ? 'UAT' : 'Production',
      actions: Object.keys(READ_ACTIONS)
    });
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ ok: false, error: 'Content-Type must be application/json.' });
  }

  let input;
  try {
    input = parseRequestBody(req.body);
  } catch (_) {
    return res.status(400).json({ ok: false, error: 'Request body must contain valid JSON.' });
  }

  const action = String(input.action || '').trim();
  if (!Object.prototype.hasOwnProperty.call(READ_ACTIONS, action)) {
    return res.status(400).json({ ok: false, error: 'Unsupported NSEInvest report action.' });
  }

  try {
    const upstream = await requestNseInvest(config, action, input.payload);
    return res.status(upstream.statusCode).json({
      ok: upstream.statusCode >= 200 && upstream.statusCode < 300,
      action,
      data: upstream.body
    });
  } catch (error) {
    const timeout = error && error.code === 'ETIMEDOUT';
    console.error('[NSEInvest] request failed:', timeout ? 'timeout' : 'upstream connection error');
    return res.status(timeout ? 504 : 502).json({
      ok: false,
      error: timeout
        ? 'NSEInvest did not respond before the timeout.'
        : 'Unable to connect securely to NSEInvest.'
    });
  }
};

