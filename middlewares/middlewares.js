const fs = require('fs');
const os = require('os');
const path = require('path');

function logger(req, res, next) {
  const date = new Date();
  const logEntry = {
    method: req.method,
    url: req.url,
    time: date.toISOString(),
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  // Em ambientes serverless (ex.: Vercel) o filesystem é read-only exceto /tmp
  const logFilePath = path.join(os.tmpdir(), 'fellowsheepapi.log');

  fs.promises.appendFile(logFilePath, logLine).catch(() => {
    // Fallback para stdout se escrever em arquivo falhar
    try {
      // eslint-disable-next-line no-console
      console.log('[LOG]', logLine.trim());
    } catch (_) {
      // Ignorar totalmente em último caso
    }
  }).finally(() => next());
}

module.exports = logger;