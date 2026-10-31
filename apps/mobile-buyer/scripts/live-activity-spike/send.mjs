// Throwaway #140 device test: sends a Live Activity push straight to APNs sandbox.
// Env: APNS_KEY_PATH (the .p8, kept outside the repo), APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC (bundle id).
// Usage:
//   node send.mjs start  <push-to-start token> [status] [step]
//   node send.mjs update <activity update token> [status] [step]
//   node send.mjs end    <activity update token>
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from 'node:http2';

const { APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC = 'com.emekaobah.oja.buyer' } = process.env;
const [event, token, status = event === 'start' ? 'Started by push' : 'Updated by push', step = '1'] =
  process.argv.slice(2);
if (!APNS_KEY_PATH || !APNS_KEY_ID || !APNS_TEAM_ID) throw new Error('Set APNS_KEY_PATH, APNS_KEY_ID and APNS_TEAM_ID.');
if (!['start', 'update', 'end'].includes(event) || !token) throw new Error('Usage: node send.mjs start|update|end <token> [status] [step]');

const factory = 'SpikeActivity';
const now = Math.floor(Date.now() / 1000);
// The library's ContentState envelope: the factory name plus the props as a JSON string.
const contentState = { name: factory, props: JSON.stringify({ status, step: Number(step) }) };

const aps = { timestamp: now, event, 'content-state': contentState };
if (event === 'start') {
  Object.assign(aps, {
    'attributes-type': 'LiveActivityAttributes',
    attributes: {},
    // iOS 18+: ask the system for the started activity's own update token.
    'input-push-token': 1,
    alert: { title: 'Oja spike', body: status },
  });
}
if (event === 'end') aps['dismissal-date'] = now + 60;

const payload = JSON.stringify({ aps });
const jwt = sign();

const client = connect('https://api.sandbox.push.apple.com');
client.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
const req = client.request({
  ':method': 'POST',
  ':path': `/3/device/${token}`,
  authorization: `bearer ${jwt}`,
  'apns-push-type': 'liveactivity',
  'apns-topic': `${APNS_TOPIC}.push-type.liveactivity`,
  'apns-priority': '10',
});
let response = '';
req.on('response', (headers) => console.log('status', headers[':status'], 'apns-id', headers['apns-id']));
req.on('data', (chunk) => (response += chunk));
req.on('end', () => {
  if (response) console.log(response);
  console.log('sent', payload);
  client.close();
});
req.end(payload);

// ES256 provider token. The key is read from disk and never printed.
function sign() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'ES256', kid: APNS_KEY_ID })}.${encode({ iss: APNS_TEAM_ID, iat: now })}`;
  const signature = createSign('SHA256').update(input).sign({ key: readFileSync(APNS_KEY_PATH), dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}
