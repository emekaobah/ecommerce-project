// Throwaway #140 device test: appends every POST body to a JSON-lines log.
// Usage: node token-log-server.mjs <log file> [port]
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [logFile, port = '9876'] = process.argv.slice(2);
if (!logFile) throw new Error('Usage: node token-log-server.mjs <log file> [port]');

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const line = JSON.stringify({ receivedAt: new Date().toISOString(), path: req.url, body: safeJson(body) });
    appendFileSync(logFile, line + '\n');
    console.log(line);
    res.writeHead(204).end();
  });
}).listen(Number(port), '0.0.0.0', () => console.log(`Logging to ${logFile} on port ${port}`));

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
