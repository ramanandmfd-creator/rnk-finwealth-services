'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const zlib = require('node:zlib');

const TLS_13_CIPHERS = [
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_AES_128_GCM_SHA256'
].join(':');

// Data/report actions only. Order placement, registration, cancellation,
// payment and upload APIs are intentionally excluded from this public site.
const READ_ACTIONS = Object.freeze({
  'provisional-orders': '/nsemfdesk/api/v2/reports/PROV_ORDERS',
  'order-status': '/nsemfdesk/api/v2/reports/ORDER_STATUS',
  'mandate-status': '/nsemfdesk/api/v2/reports/MANDATE_STATUS',
  'member-fund-allocation-order-wise': '/nsemfdesk/api/v2/reports/MEMBER_FUND_ALLOCATION/ORDER_WISE',
  'member-fund-allocation-age-wise': '/nsemfdesk/api/v2/reports/MEMBER_FUND_ALLOCATION/AGE_WISE',
  'redemption-payout': '/nsemfdesk/api/v2/reports/REDEMPTION_PAYOUT',
  'redemption-statement': '/nsemfdesk/api/v2/reports/REDEMPTION_STATEMENT',
  'allotment-statement': '/nsemfdesk/api/v2/reports/ALLOTMENT_STATEMENT',
  'two-factor-auth-report': '/nsemfdesk/api/v2/reports/2FA',
  'client-authorization': '/nsemfdesk/api/v2/reports/CLIENT_AUTHORIZATION',
  'order-lifecycle': '/nsemfdesk/api/v2/reports/ORDER_LIFECYCLE',
  'fatca-report': '/nsemfdesk/api/v2/reports/FATCA_REPORT',
  'aof-image-upload-report': '/nsemfdesk/api/v2/reports/AOF_IMAGE_UPLOAD_REPORT',
  'sip-registration-report': '/nsemfdesk/api/v2/reports/SIP_REG_REPORT',
  'sip-cancellation-report': '/nsemfdesk/api/v2/reports/SIP_CAN_REPORT',
  'sip-installment-due': '/nsemfdesk/api/v2/reports/SIP_INST_DUE_REPORT',
  'sip-topup-report': '/nsemfdesk/api/v2/reports/SIP_TOPUP_REPORT',
  'stepup-registration-report': '/nsemfdesk/api/v2/reports/STEPUP_REG_REPORT',
  'xsip-registration-report': '/nsemfdesk/api/v2/reports/XSIP_REG_REPORT',
  'xsip-cancellation-report': '/nsemfdesk/api/v2/reports/XSIP_CAN_REPORT',
  'xsip-installment-due': '/nsemfdesk/api/v2/reports/XSIP_INST_DUE_REPORT',
  'xsip-topup-report': '/nsemfdesk/api/v2/reports/XSIP_TOPUP_REPORT',
  'stp-registration-report': '/nsemfdesk/api/v2/reports/STP_REG_REPORT',
  'stp-cancellation-report': '/nsemfdesk/api/v2/reports/STP_CAN_REPORT',
  'stp-installment-due': '/nsemfdesk/api/v2/reports/STP_INST_DUE_REPORT',
  'swp-registration-report': '/nsemfdesk/api/v2/reports/SWP_REG_REPORT',
  'swp-cancellation-report': '/nsemfdesk/api/v2/reports/SWP_CAN_REPORT',
  'swp-installment-due': '/nsemfdesk/api/v2/reports/SWP_INST_DUE_REPORT',
  'scheme-master-nav': '/nsemfdesk/api/v2/reports/MASTER_DOWNLOAD',
  'client-kyc-report': '/nsemfdesk/api/v2/reports/CLIENT_KYC_REPORT',
  'kyc-status-check': '/nsemfdesk/api/v2/utility/KYC_CHECK',
  'upi-payment-status': '/nsemfdesk/api/v2/payments/upi_status_check',
  'client-master': '/nsemfdesk/api/v2/reports/client_master_report'
});

const REQUIRED_ENV = Object.freeze([
  'NSEINVEST_BASE_URL',
  'NSEINVEST_LOGIN_USER_ID',
  'NSEINVEST_API_KEY_MEMBER',
  'NSEINVEST_API_SECRET_USER',
  'NSEINVEST_MEMBER_CODE',
  'RNK_NSE_ADMIN_TOKEN'
]);

class NseInvestConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NseInvestConfigError';
  }
}

function missingEnvironment(env = process.env) {
  return REQUIRED_ENV.filter((key) => !String(env[key] || '').trim());
}

function loadConfig(env = process.env) {
  const missing = missingEnvironment(env);
  if (missing.length) {
    throw new NseInvestConfigError(`Missing server configuration: ${missing.join(', ')}`);
  }

  const baseUrl = new URL(String(env.NSEINVEST_BASE_URL).trim());
  const hostname = baseUrl.hostname.toLowerCase();
  if (baseUrl.protocol !== 'https:' || !(hostname === 'nseindia.com' || hostname.endsWith('.nseindia.com'))) {
    throw new NseInvestConfigError('NSEINVEST_BASE_URL must be an HTTPS nseindia.com address.');
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new NseInvestConfigError('NSEINVEST_BASE_URL must not contain credentials, query parameters or a fragment.');
  }

  const adminToken = String(env.RNK_NSE_ADMIN_TOKEN);
  if (Buffer.byteLength(adminToken, 'utf8') < 32) {
    throw new NseInvestConfigError('RNK_NSE_ADMIN_TOKEN must be at least 32 characters.');
  }

  const requestedTimeout = Number.parseInt(env.NSEINVEST_TIMEOUT_MS || '20000', 10);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(Math.max(requestedTimeout, 5000), 60000)
    : 20000;

  return {
    baseUrl,
    loginUserId: String(env.NSEINVEST_LOGIN_USER_ID),
    apiKeyMember: String(env.NSEINVEST_API_KEY_MEMBER),
    apiSecretUser: String(env.NSEINVEST_API_SECRET_USER),
    memberCode: String(env.NSEINVEST_MEMBER_CODE),
    adminToken,
    userAgent: String(env.NSEINVEST_USER_AGENT || 'PostmanRuntime/7.43.4'),
    timeoutMs
  };
}

function createEncryptedPassword(apiSecretUser, apiKeyMember, options = {}) {
  const iv = options.ivHex ? Buffer.from(options.ivHex, 'hex') : crypto.randomBytes(16);
  const salt = options.saltHex ? Buffer.from(options.saltHex, 'hex') : crypto.randomBytes(16);
  if (iv.length !== 16 || salt.length !== 16) {
    throw new TypeError('IV and salt must each contain 16 bytes.');
  }

  const randomNumber = options.randomNumber === undefined
    ? crypto.randomInt(1, 10_000_000_001)
    : options.randomNumber;
  if (!Number.isSafeInteger(randomNumber) || randomNumber < 1 || randomNumber > 10_000_000_000) {
    throw new TypeError('randomNumber must be an integer between 1 and 10000000000.');
  }

  // This matches the collection's CryptoJS 3.x flow: PBKDF2-HMAC-SHA1,
  // 1,000 iterations, a 128-bit key, AES-128-CBC and PKCS#7 padding.
  const key = crypto.pbkdf2Sync(apiKeyMember, salt, 1000, 16, 'sha1');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(`${apiSecretUser}|${randomNumber}`, 'utf8'),
    cipher.final()
  ]).toString('base64');

  const packed = `${iv.toString('hex')}::${salt.toString('hex')}::${ciphertext}`;
  return Buffer.from(packed, 'utf8').toString('base64');
}

function readAuthorizationHeader(req) {
  if (!req || !req.headers) return '';
  const value = req.headers.authorization || req.headers.Authorization || '';
  return Array.isArray(value) ? value[0] || '' : String(value);
}

function isAuthorized(req, expectedToken) {
  const header = readAuthorizationHeader(req);
  const suppliedToken = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = Buffer.from(String(expectedToken || ''), 'utf8');
  const supplied = Buffer.from(suppliedToken, 'utf8');
  return expected.length >= 32 && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function normalizePayload(payload) {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('payload must be a JSON object.');
  }
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) {
    throw new TypeError('payload is too large.');
  }
  return { payload, serialized };
}

function decodeBody(buffer, encoding) {
  const normalized = String(encoding || '').toLowerCase();
  if (normalized === 'gzip') return zlib.gunzipSync(buffer);
  if (normalized === 'deflate') return zlib.inflateSync(buffer);
  if (normalized === 'br') return zlib.brotliDecompressSync(buffer);
  return buffer;
}

function parseResponseBody(buffer, headers) {
  const decoded = decodeBody(buffer, headers['content-encoding']);
  const text = decoded.toString('utf8');
  if (!text) return null;
  const contentType = String(headers['content-type'] || '').toLowerCase();
  if (contentType.includes('json') || /^[\s]*[\[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }
  return text;
}

function requestNseInvest(config, action, payload, requestFactory = https.request) {
  const path = READ_ACTIONS[action];
  if (!path) throw new TypeError('Unsupported NSEInvest action.');
  const normalized = normalizePayload(payload);
  const serialized = normalized.serialized || JSON.stringify(normalized);
  const target = new URL(path, config.baseUrl);
  const encryptedPassword = createEncryptedPassword(config.apiSecretUser, config.apiKeyMember);
  const basicAuth = Buffer.from(`${config.loginUserId}:${encryptedPassword}`, 'utf8').toString('base64');

  return new Promise((resolve, reject) => {
    const request = requestFactory(target, {
      method: 'POST',
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
      ciphers: TLS_13_CIPHERS,
      honorCipherOrder: true,
      headers: {
        Accept: '',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US',
        Authorization: `Basic ${basicAuth}`,
        Connection: 'keep-alive',
        'Content-Length': Buffer.byteLength(serialized, 'utf8'),
        'Content-Type': 'application/json',
        Referer: 'www.google.com',
        'User-Agent': config.userAgent,
        memberId: config.memberCode
      }
    }, (response) => {
      const chunks = [];
      let totalBytes = 0;
      const maxResponseBytes = 15 * 1024 * 1024;

      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxResponseBytes) {
          response.destroy(new Error('NSEInvest response exceeded the 15 MB safety limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          resolve({
            statusCode: response.statusCode || 502,
            contentType: String(response.headers['content-type'] || 'application/json'),
            body: parseResponseBody(Buffer.concat(chunks), response.headers)
          });
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    });

    request.setTimeout(config.timeoutMs, () => {
      const error = new Error('NSEInvest request timed out.');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(serialized);
  });
}

module.exports = {
  NseInvestConfigError,
  READ_ACTIONS,
  REQUIRED_ENV,
  TLS_13_CIPHERS,
  createEncryptedPassword,
  isAuthorized,
  loadConfig,
  missingEnvironment,
  normalizePayload,
  requestNseInvest
};

