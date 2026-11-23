import TesseractCore from './vendor/tesseract-runtime.js';
import { instantiate } from './vendor/tesseract-engine.js';
import { MAX_DESCRIPTION } from './drafts.js';

const LANGUAGES = ['deu', 'eng'];
const OEM_LSTM_ONLY = 1;
const PSM_SINGLE_BLOCK = 6;

// Binaryen lowers the i64 arguments of these imports to two i32 words.
// The Emscripten runtime expects its original BigInt interface.
function instantiateEngine(imports, receive) {
  const join = (low, high) => (BigInt(high) << 32n) | BigInt(low >>> 0);
  const runtime = imports.a;
  let highWord = 0;
  const adapted = {
    ...runtime,
    x: (address, length, protection, flags, low, high, allocated, pointer) =>
      runtime.x(address, length, protection, flags, join(low, high), allocated, pointer),
    z: (address, length, protection, flags, fd, low, high) =>
      runtime.z(address, length, protection, flags, fd, join(low, high)),
    A: (low, high, pointer) => runtime.A(join(low, high), pointer),
    B: (low, high, pointer) => runtime.B(join(low, high), pointer),
    C: (pointer) => {
      const result = runtime.C(pointer);
      highWord = Number(result >> 32n) | 0;
      return Number(BigInt.asIntN(32, result));
    },
    E: (fd, low, high, whence, output) => runtime.E(fd, join(low, high), whence, output),
    M: (clock, low, high, output) => runtime.M(clock, join(low, high), output),
  };
  const exports = instantiate({ a: adapted, env: { getTempRet0: () => highWord } });

  // Native Memory.grow throws on failure. The JavaScript engine returns -1.
  const memory = exports.T;
  exports.T = {
    get buffer() { return memory.buffer; },
    grow(pages) {
      const previous = memory.grow(pages);
      if (previous < 0) throw new RangeError('OCR memory allocation failed');
      return previous;
    },
  };
  receive({ exports });
}

async function loadLanguage(language) {
  const asset = new URL('./vendor/' + language + '.json', import.meta.url);
  const response = await fetch(asset, { credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new Error('OCR language model unavailable');
  const base64 = await response.json();
  const compressed = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

self.onmessage = async ({ data: bytes }) => {
  try {
    const [runtime, ...models] = await Promise.all([
      TesseractCore({ instantiateWasm: instantiateEngine, print() {}, printErr() {} }),
      ...LANGUAGES.map(loadLanguage),
    ]);
    for (const [index, language] of LANGUAGES.entries()) {
      runtime.FS.writeFile('/' + language + '.traineddata', models[index]);
    }
    const api = new runtime.TessBaseAPI();
    try {
      if (api.Init('/', LANGUAGES.join('+'), OEM_LSTM_ONLY) !== 0) {
        throw new Error('OCR initialization failed');
      }
      api.SetPageSegMode(PSM_SINGLE_BLOCK);
      runtime.FS.writeFile('/input', new Uint8Array(bytes));
      if (api.SetImageFile(1, 0) !== 0 || api.Recognize(null) !== 0) {
        throw new Error('OCR recognition failed');
      }
      const text = api.GetUTF8Text().trim();
      self.postMessage({ text: text.slice(0, MAX_DESCRIPTION), truncated: text.length > MAX_DESCRIPTION });
    } finally {
      runtime.destroy(api);
    }
  } catch {
    self.postMessage({ error: 'readError' });
  }
};
