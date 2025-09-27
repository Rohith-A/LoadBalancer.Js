// generic-worker.js
// A reusable worker that can run either an exported function from a module
// or an inline code snippet. Supports progress events and cancellation.
// NOTE: Do not run untrusted code with the inline mode.

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

let cancelled = false;
parentPort.on('message', (msg) => {
  if (!msg) return;
  if (msg === 'cancel' || msg.type === 'cancel') cancelled = true;
});

function makeCtx() {
  return {
    progress: (value) => parentPort.postMessage({ type: 'progress', value }),
    isCancelled: () => cancelled,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function serializeResult(result, bigintToString) {
  if (!bigintToString) return result;
  return JSON.parse(
    JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  );
}

async function loadModuleMaybeESM(modulePath) {
  const abs = path.isAbsolute(modulePath) ? modulePath : path.resolve(modulePath);
  try {
    // Try CommonJS
    return require(abs);
  } catch (e) {
    if (e && e.code === 'ERR_REQUIRE_ESM') {
      // Fallback to ESM dynamic import
      const mod = await import(pathToFileURL(abs).href);
      return mod;
    }
    throw e;
  }
}

async function runModule({ modulePath, exportName = 'default', args = [], bigintToString }) {
  const mod = await loadModuleMaybeESM(modulePath);
  const fn = exportName === 'default' ? (mod?.default ?? mod) : mod?.[exportName];
  if (typeof fn !== 'function') {
    throw new Error(`Export "${exportName}" is not a function in ${modulePath}`);
  }
  const ctx = makeCtx();
  const out = await fn(...args, ctx); // ctx is optional for the callee
  return serializeResult(out, bigintToString);
}

async function runInline({ code, args = [], timeoutMs = 0, sandbox = {}, bigintToString }) {
  // vm is NOT a security boundary. Only run trusted code.
  const ctx = makeCtx();
  const context = vm.createContext({
    ...sandbox,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    setImmediate,
    BigInt,
  });

  // The provided code is treated as the body of an async function
  const wrapped = `(async (ctx, ...args) => { ${code} })`;
  const script = new vm.Script(wrapped, { filename: 'inline-op.js' });
  const fn = script.runInContext(context, { timeout: timeoutMs || undefined });

  let timer;
  if (timeoutMs > 0) timer = setTimeout(() => { cancelled = true; }, timeoutMs);

  try {
    const out = await fn(ctx, ...args);
    if (cancelled) throw new Error('Operation cancelled');
    return serializeResult(out, bigintToString);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

(async () => {
  try {
    const {
      kind = 'module',           // 'module' | 'inline'
      modulePath,
      exportName = 'default',
      code,
      args = [],
      timeoutMs = 0,
      sandbox = {},
      bigintToString = false,
    } = workerData || {};

    const result = kind === 'module'
      ? await runModule({ modulePath, exportName, args, bigintToString })
      : await runInline({ code, args, timeoutMs, sandbox, bigintToString });

    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error), stack: error?.stack });
  }
})();