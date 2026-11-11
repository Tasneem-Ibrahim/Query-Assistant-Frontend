import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises';

const output = new URL('./dist/', import.meta.url);
let backendUrl = (process.env.BACKEND_URL || '').trim();
if (backendUrl) {
  const url = new URL(backendUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['/', '/api', '/api/'].includes(url.pathname)) {
    throw new Error('BACKEND_URL must be an HTTP(S) backend origin without credentials, query, or fragment.');
  }
  backendUrl = url.origin;
  if (process.env.VERCEL && url.protocol !== 'https:') throw new Error('BACKEND_URL must use HTTPS on Vercel.');
}
await mkdir(output, { recursive: true });
await writeFile(new URL('config.js', output), `export const backendUrl = ${JSON.stringify(backendUrl)};\n`);
for (const name of ['index.html', 'styles.css', 'app.js', 'api.js', 'voice.js']) {
  await copyFile(new URL(name, import.meta.url), new URL(name, output));
}
await cp(new URL('./assets/', import.meta.url), new URL('assets/', output), { recursive: true });
console.log('Static frontend built in dist/.');
