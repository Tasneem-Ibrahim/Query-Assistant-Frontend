import { copyFile, cp, mkdir } from 'node:fs/promises';

const output = new URL('./dist/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js', 'api.js']) {
  await copyFile(new URL(name, import.meta.url), new URL(name, output));
}
await cp(new URL('./assets/', import.meta.url), new URL('assets/', output), { recursive: true });
console.log('Static frontend built in dist/.');
