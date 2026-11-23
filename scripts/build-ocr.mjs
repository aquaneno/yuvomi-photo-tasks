// Build with npm packages binaryen@132.0.0, esbuild@0.28.2 and
// tesseract.js-core@7.0.0 installed in the current checkout.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = join(root, 'node_modules', '.bin');
const core = join(root, 'node_modules', 'tesseract.js-core');
const vendor = join(root, 'foto-aufgaben', 'vendor');
const work = await mkdtemp(join(tmpdir(), 'foto-aufgaben-'));
const models = {
  deu: '19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d',
  eng: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
};
const run = (program, args) => execFileSync(join(bin, program), args, { stdio: 'inherit' });

try {
  const lowered = join(work, 'engine.wasm');
  const converted = join(work, 'engine.mjs');
  run('wasm-opt', [join(core, 'tesseract-core-lstm.wasm'), '--all-features', '--llvm-nontrapping-fptoint-lowering', '-o', lowered]);
  run('wasm2js', [lowered, '--emscripten', '--all-features', '-O2', '-o', converted]);
  await writeFile(converted, (await readFile(converted, 'utf8')) + '\nexport { instantiate };\n');
  run('esbuild', [converted, '--minify', '--target=es2020', '--format=esm', '--outfile=' + join(vendor, 'tesseract-engine.js')]);

  const runtime = await readFile(join(core, 'tesseract-core-lstm.js'), 'utf8');
  const browserRuntime = runtime.replace('ca="object"==typeof process&&process.versions?.node&&"renderer"!=process.type', 'ca=!1');
  if (browserRuntime === runtime) throw new Error('Unexpected upstream runtime format');
  await writeFile(join(vendor, 'tesseract-runtime.js'), browserRuntime + '\nexport default TesseractCore;\n');
  await copyFile(join(core, 'LICENSE'), join(vendor, 'LICENSE'));

  for (const [language, sha256] of Object.entries(models)) {
    const url = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/' + language + '.traineddata';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not download ' + language + ': HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
      throw new Error('Model checksum mismatch for ' + language);
    }
    await writeFile(join(vendor, language + '.json'), JSON.stringify(gzipSync(bytes, { level: 9 }).toString('base64')) + '\n');
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
