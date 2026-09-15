'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const nseInvestHandler = require('../api/nseinvest');

const {
  READ_ACTIONS,
  TLS_13_CIPHERS,
  createEncryptedPassword,
  isAuthorized,
  loadConfig,
  missingEnvironment,
  normalizePayload,
  requestNseInvest
} = require('../lib/nseinvest');

const VALID_ENV = {
  NSEINVEST_BASE_URL: 'https://nseinvestuat.nseindia.com',
  NSEINVEST_LOGIN_USER_ID: 'user',
  NSEINVEST_API_KEY_MEMBER: 'member-key',
  NSEINVEST_API_SECRET_USER: 'user-secret',
  NSEINVEST_MEMBER_CODE: 'member-code',
  RNK_NSE_ADMIN_TOKEN: 'a-very-long-admin-token-used-only-for-tests'
};

test('encrypted password matches the Postman AES package format', () => {
  const ivHex = '000102030405060708090a0b0c0d0e0f';
  const saltHex = '101112131415161718191a1b1c1d1e1f';
  const password = createEncryptedPassword('user-secret', 'member-key', {
    ivHex,
    saltHex,
    randomNumber: 123456789
  });

  const packed = Buffer.from(password, 'base64').toString('utf8');
  const [actualIv, actualSalt, ciphertext] = packed.split('::');
  assert.equal(actualIv, ivHex);
  assert.equal(actualSalt, saltHex);
  assert.equal(ciphertext, '8Xoio+4kg6xIDhFp/h3AiblKsMZ+JlJ15b8PScQqEVc=');

  const key = crypto.pbkdf2Sync('member-key', Buffer.from(actualSalt, 'hex'), 1000, 16, 'sha1');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.from(actualIv, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
  assert.equal(plaintext, 'user-secret|123456789');
});

test('configuration only accepts HTTPS NSE India hosts', () => {
  assert.equal(loadConfig(VALID_ENV).baseUrl.hostname, 'nseinvestuat.nseindia.com');
  assert.throws(
    () => loadConfig({ ...VALID_ENV, NSEINVEST_BASE_URL: 'https://example.com' }),
    /nseindia\.com/
  );
});

test('missing environment values are reported without reading secret values', () => {
  const missing = missingEnvironment({ NSEINVEST_BASE_URL: VALID_ENV.NSEINVEST_BASE_URL });
  assert.ok(missing.includes('NSEINVEST_LOGIN_USER_ID'));
  assert.ok(missing.includes('RNK_NSE_ADMIN_TOKEN'));
});

test('admin bearer token comparison is strict', () => {
  const token = VALID_ENV.RNK_NSE_ADMIN_TOKEN;
  assert.equal(isAuthorized({ headers: { authorization: `Bearer ${token}` } }, token), true);
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer incorrect-token' } }, token), false);
});

test('only read/report actions are exposed', () => {
  assert.ok(READ_ACTIONS['client-master']);
  assert.ok(READ_ACTIONS['order-status']);
  assert.equal(READ_ACTIONS['order-entry'], undefined);
  assert.equal(READ_ACTIONS['sip-registration'], undefined);
});

test('payload must be a reasonably sized JSON object', () => {
  assert.deepEqual(normalizePayload(null), {});
  assert.throws(() => normalizePayload([]), /JSON object/);
  assert.throws(() => normalizePayload({ value: 'x'.repeat(300 * 1024) }), /too large/);
});

test('upstream requests enforce TLS 1.3 and NSE-required headers', async () => {
  let captured;
  const requestFactory = (url, options, onResponse) => {
    captured = { url, options };
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.destroy = (error) => request.emit('error', error);
    request.end = (body) => {
      captured.body = body;
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = { 'content-type': 'application/json' };
      onResponse(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from('{"report":"ready"}'));
        response.emit('end');
      });
    };
    return request;
  };

  const response = await requestNseInvest(
    loadConfig(VALID_ENV),
    'order-status',
    { from_date: '2025-01-01', to_date: '2025-01-02' },
    requestFactory
  );

  assert.equal(captured.url.hostname, 'nseinvestuat.nseindia.com');
  assert.equal(captured.url.pathname, READ_ACTIONS['order-status']);
  assert.equal(captured.options.minVersion, 'TLSv1.3');
  assert.equal(captured.options.maxVersion, 'TLSv1.3');
  assert.equal(captured.options.ciphers, TLS_13_CIPHERS);
  assert.equal(captured.options.headers.memberId, VALID_ENV.NSEINVEST_MEMBER_CODE);
  assert.equal(captured.options.headers['Accept-Language'], 'en-US');
  assert.equal(captured.options.headers.Accept, '');
  assert.match(captured.options.headers.Authorization, /^Basic /);
  assert.deepEqual(response.body, { report: 'ready' });
});

test('API status route requires valid admin authentication', async () => {
  const previous = Object.fromEntries(Object.keys(VALID_ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, VALID_ENV);

  function responseRecorder() {
    return {
      headers: {},
      statusCode: 200,
      body: null,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }
    };
  }

  try {
    const unauthorized = responseRecorder();
    await nseInvestHandler({ method: 'GET', headers: {} }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);

    const authorized = responseRecorder();
    await nseInvestHandler({
      method: 'GET',
      headers: { authorization: `Bearer ${VALID_ENV.RNK_NSE_ADMIN_TOKEN}` }
    }, authorized);
    assert.equal(authorized.statusCode, 200);
    assert.equal(authorized.body.configured, true);
    assert.equal(authorized.body.environment, 'UAT');
    assert.ok(authorized.body.actions.includes('client-master'));
    assert.equal(authorized.headers['Cache-Control'], 'no-store, max-age=0');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
