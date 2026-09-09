const API_BASE = 'https://api.mfapi.in';

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

module.exports = async function mutualFunds(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Only GET requests are supported.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);

  try {
    const code = String(one(req.query.code) || '').trim();
    const search = String(one(req.query.q) || '').trim();
    const latest = String(one(req.query.latest) || '') === '1';
    const start = String(one(req.query.start) || '').trim();
    const end = String(one(req.query.end) || '').trim();
    let upstreamUrl;

    if (code) {
      if (!/^\d{1,10}$/.test(code)) {
        return res.status(400).json({ error: 'Invalid scheme code.' });
      }

      upstreamUrl = new URL(`${API_BASE}/mf/${code}${latest ? '/latest' : ''}`);
      if (!latest && start) {
        if (!validDate(start)) return res.status(400).json({ error: 'Invalid start date.' });
        upstreamUrl.searchParams.set('startDate', start);
      }
      if (!latest && end) {
        if (!validDate(end)) return res.status(400).json({ error: 'Invalid end date.' });
        upstreamUrl.searchParams.set('endDate', end);
      }
    } else if (search) {
      upstreamUrl = new URL(`${API_BASE}/mf/search`);
      upstreamUrl.searchParams.set('q', search.slice(0, 120));
    } else {
      const requestedLimit = Number.parseInt(one(req.query.limit), 10);
      const requestedOffset = Number.parseInt(one(req.query.offset), 10);
      const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 10000) : 10000;
      const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

      upstreamUrl = new URL(`${API_BASE}/mf`);
      upstreamUrl.searchParams.set('limit', String(limit));
      upstreamUrl.searchParams.set('offset', String(offset));
    }

    const upstream = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'RNK-Finwealth-Fund-Explorer/1.0' },
      signal: controller.signal
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Fund data service is temporarily unavailable.' });
    }

    const payload = await upstream.json();
    res.setHeader('Cache-Control', code
      ? 's-maxage=21600, stale-while-revalidate=86400'
      : 's-maxage=43200, stale-while-revalidate=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).json(payload);
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? 'Fund data request timed out. Please try again.'
      : 'Fund data is temporarily unavailable. Please try again.';
    return res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
};
