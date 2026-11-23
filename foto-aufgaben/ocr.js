const TIMEOUT_MS = 90_000;

export async function recognizePhoto(photo, signal) {
  signal.throwIfAborted();
  const bytes = await photo.arrayBuffer();
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ocr-worker.js', import.meta.url), { type: 'module' });
    const abort = () => finish(reject, signal.reason);
    const timeout = setTimeout(() => finish(reject, failure('readSlow')), TIMEOUT_MS);

    function finish(callback, value) {
      worker.terminate();
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      callback(value);
    }

    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.error) finish(reject, failure(data.error));
      else finish(resolve, data);
    };
    worker.onerror = worker.onmessageerror = () => finish(reject, failure('readError'));
    try {
      worker.postMessage(bytes, [bytes]);
    } catch (error) {
      finish(reject, error);
    }
  });
}

function failure(label) {
  return Object.assign(new Error('OCR failed'), { label });
}
