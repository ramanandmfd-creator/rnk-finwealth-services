const API_BASE = 'https://api.mfapi.in';
const AMFI_DIRECTORY_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const DAY = 24 * 60 * 60 * 1000;

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function parseAmfiDate(value) {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(value).trim());
  if (!match) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = months.indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  return Date.UTC(Number(match[3]), month, Number(match[1]));
}

function parseAmfiDirectory(text) {
  const rows = [];
  let currentFundHouse = '';
  let latestNavTime = 0;

  String(text).split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    if (!line.includes(';')) {
      if (/mutual\s+fund/i.test(line)) currentFundHouse = line;
      return;
    }

    const fields = line.split(';');
    const code = String(fields[0] || '').trim();
    const name = String(fields[3] || '').trim();
    const nav = Number.parseFloat(fields[4]);
    const navTime = parseAmfiDate(fields[5]);
    if (!/^\d+$/.test(code) || !name || !currentFundHouse || !(nav > 0) || navTime === null) return;
    latestNavTime = Math.max(latestNavTime, navTime);
    rows.push({ code, name, amc: currentFundHouse, navTime });
  });

  if (!latestNavTime) return [];
  const activeCutoff = latestNavTime - (45 * DAY);
  const seen = new Set();
  return rows
    .filter((row) => row.navTime >= activeCutoff && !seen.has(row.code) && seen.add(row.code))
    .map(({ code, name, amc }) => ({ code, name, amc }));
}

module.exports = async function mutualFunds(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Only GET requests are supported.' });
  }

  const directory = String(one(req.query.directory) || '') === '1';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), directory ? 10000 : 14000);

  try {
    const code = String(one(req.query.code) || '').trim();
    const search = String(one(req.query.q) || '').trim();
    const latest = String(one(req.query.latest) || '') === '1';
    const start = String(one(req.query.start) || '').trim();
    const end = String(one(req.query.end) || '').trim();
    let upstreamUrl;

    if (directory) {
      upstreamUrl = new URL(AMFI_DIRECTORY_URL);
    } else if (code) {
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

    const payload = directory
      ? parseAmfiDirectory(await upstream.text())
      : await upstream.json();
    if (directory && !payload.length) {
      return res.status(502).json({ error: 'The current fund directory is temporarily unavailable.' });
    }
    res.setHeader('Cache-Control', code || directory
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

module.exports.parseAmfiDirectory = parseAmfiDirectory;
