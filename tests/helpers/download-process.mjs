import { readFile } from 'node:fs/promises';
import { downloadVerifiedFile, withDownloadSignals } from '../../scripts/helpers/verified-download.mjs';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
try {
  const result = await withDownloadSignals(async signal => {
    const downloaded = await downloadVerifiedFile(config.url, config.file, config.sha256, config.maxBytes, {
      signal,
      onProgress: progress => console.log(JSON.stringify({ event: 'progress', ...progress }))
    });
    if (config.pauseAfterPublish) {
      console.log(JSON.stringify({ event: 'published', ...downloaded }));
      await new Promise((resolve, reject) => {
        if (signal.aborted) resolve();
        else {
          // A pending Promise alone does not keep a Node process alive.
          const timeout = setTimeout(() => reject(new Error('No late-cancellation signal arrived')), 15000);
          signal.addEventListener('abort', () => { clearTimeout(timeout); resolve(); }, { once: true });
        }
      });
    }
    return downloaded;
  });
  console.log(JSON.stringify({ event: 'completed', ...result }));
} catch (error) {
  console.log(JSON.stringify({ event: 'failed', name: error.name, message: error.message, signalName: error.signalName }));
  process.exitCode = error.exitCode || 1;
}
