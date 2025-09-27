// index.js
const cluster = require('node:cluster');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

// ---------- Internal state ----------
let taskQueue = [];
const totalCores = os.cpus().length;
const reservedCoresForIO = 2;
const maxCoresForIO = Math.min(totalCores, reservedCoresForIO);
let currentCoresForIO = maxCoresForIO;
let busyIOWorkers = 0;    // wire up if you track real IO workers
let busyCPUWorkers = 0;

const totalMemory = os.totalmem();
const maxMemoryPerWorker = 512 * 1024 * 1024; // heuristic
let usedMemory = 0;
const MAX_QUEUE = 1000;

// ---------- Utilities ----------
function getMemoryUsage() {
  return process.memoryUsage().heapUsed;
}
function _genericWorkerPath() {
  return path.resolve(__dirname, 'generic-worker.js');
}
function _isLikelyFile(p) {
  return typeof p === 'string' && (p.endsWith('.js') || fs.existsSync(p));
}

// Resolves progress vs final messages; supports AbortSignal
function runWorkerTask(workerRef, workerData, opts = {}) {
  return new Promise((resolve, reject) => {
    const useFile = _isLikelyFile(workerRef);
    const worker = new Worker(
      useFile ? path.resolve(workerRef) : String(workerRef),
      { workerData, eval: !useFile }
    );

    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    worker.on('message', (msg) => {
      // generic-worker progress messages:
      if (msg && msg.type === 'progress') { onProgress && onProgress(msg.value); return; }
      resolve(msg); // final message (e.g., { ok:true, result:... } or raw payload for custom workers)
    });

    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`Worker stopped with exit code ${code}`)));

    if (opts.signal) {
      if (opts.signal.aborted) { worker.terminate(); return reject(new Error('Aborted')); }
      const abort = () => { try { worker.postMessage('cancel'); } catch {} worker.terminate(); reject(new Error('Aborted')); };
      opts.signal.addEventListener('abort', abort, { once: true });
    }
  });
}

// Idle cores via CPU deltas
let _prevCpuTimes = os.cpus().map(c => ({ ...c.times }));
function detectIdleCores(threshold = 0.10) {
  const now = os.cpus().map(c => c.times);
  let idle = 0;
  for (let i = 0; i < now.length; i++) {
    const n = now[i], p = _prevCpuTimes[i];
    const idleDelta = n.idle - p.idle;
    const totalDelta = (n.user-p.user) + (n.nice-p.nice) + (n.sys-p.sys) + (n.irq-p.irq) + idleDelta;
    if (totalDelta > 0 && (idleDelta / totalDelta) > threshold) idle++;
  }
  _prevCpuTimes = os.cpus().map(c => ({ ...c.times }));
  return idle;
}

// ---------- Dynamic scheduler ----------
function dynamicResourceAllocator() {
  setInterval(() => {
    let idle = detectIdleCores(0.10);
    let available = totalMemory - usedMemory;

    currentCoresForIO = Math.min(maxCoresForIO, Math.max(reservedCoresForIO, busyIOWorkers));

    while (idle > 0 && taskQueue.length > 0 && (available - maxMemoryPerWorker) >= 0) {
      const task = taskQueue.shift();
      busyCPUWorkers++;
      usedMemory += maxMemoryPerWorker;
      available -= maxMemoryPerWorker;

      runWorkerTask(task.taskCode, task.taskData, task.opts)
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => { busyCPUWorkers--; usedMemory -= maxMemoryPerWorker; });

      idle--;
    }

    if (taskQueue.length > MAX_QUEUE) {
      console.warn(`Backpressure: queue=${taskQueue.length} > ${MAX_QUEUE}`);
    }
  }, 500);
}

// ---------- Cluster entry ----------
function startLoadBalancer(app, port) {
  if (cluster.isPrimary) {
    cluster.schedulingPolicy = cluster.SCHED_RR; // optional
    for (let i = 0; i < maxCoresForIO; i++) cluster.fork({ ROLE: 'IO' });
    const cpuWorkers = Math.max(1, totalCores - maxCoresForIO);
    for (let i = 0; i < cpuWorkers; i++) cluster.fork({ ROLE: 'CPU' });

    dynamicResourceAllocator();

    cluster.on('exit', (worker) => {
      const role = worker.process?.env?.ROLE || 'CPU';
      cluster.fork({ ROLE: role });
    });
  } else {
    const role = process.env.ROLE || 'CPU';
    app.listen(port, () => console.log(`Worker ${process.pid} (${role}) on ${port}`));
  }
}

// ---------- Public scheduler API ----------
function manageCpuBoundTasks(queueRef) {
  return async (taskCode, taskData, opts) => {
    const availableCores = Math.max(0, totalCores - (busyIOWorkers + busyCPUWorkers));
    const availableMemory = totalMemory - usedMemory;

    if (availableCores > 0 && availableMemory > maxMemoryPerWorker) {
      busyCPUWorkers++; usedMemory += maxMemoryPerWorker;
      try { return await runWorkerTask(taskCode, taskData, opts); }
      finally { busyCPUWorkers--; usedMemory -= maxMemoryPerWorker; }
    }

    if (queueRef.length >= MAX_QUEUE) {
      return Promise.reject(new Error('Task queue is full; try again later'));
    }
    return new Promise((resolve, reject) => {
      queueRef.push({ taskCode, taskData, resolve, reject, opts });
    });
  };
}

function getHealthMetrics() {
  const memoryUsage = getMemoryUsage();
  const availableMemory = Math.max(0, totalMemory - usedMemory);
  const loadAverage = os.loadavg();
  const uptime = os.uptime();
  const availableCores = Math.max(0, totalCores - (busyIOWorkers + busyCPUWorkers));
  const busyCores = totalCores - availableCores;

  return {
    system: {
      totalCores, busyCores, availableCores,
      loadAverage: { '1m': loadAverage[0], '5m': loadAverage[1], '15m': loadAverage[2] },
      uptime: `${(uptime / 3600).toFixed(2)} hours`
    },
    memory: {
      totalMB: (totalMemory/1024/1024|0) + ' MB',
      reservedBySchedulerMB: (usedMemory/1024/1024|0) + ' MB',
      heapUsedMB: (memoryUsage/1024/1024|0) + ' MB',
      availableMB: (availableMemory/1024/1024|0) + ' MB'
    },
    tasks: { queue: taskQueue.length, busyIOWorkers, busyCPUWorkers }
  };
}

// ---------- No-worker-file APIs (what users call) ----------
function runGenericJob(job, opts) {
  // job = { kind:'inline'|'module', ... } consumed by generic-worker.js
  return runWorkerTask(_genericWorkerPath(), job, opts);
}

function runInline(code, args = [], options = {}) {
  return runGenericJob({ kind: 'inline', code, args, timeoutMs: options.timeoutMs || 0, sandbox: options.sandbox, bigintToString: !!options.bigintToString }, options);
}

function runModule(modulePath, exportName = 'default', args = [], options = {}) {
  return runGenericJob({ kind: 'module', modulePath, exportName, args, bigintToString: !!options.bigintToString }, options);
}

// Helper: pass a JS function; we stringify and run inline in the worker
function runFunction(fn, args = [], options = {}) {
  if (typeof fn !== 'function') throw new Error('runFunction expects a function');
  const fnSrc = `const fn = (${fn.toString()}); return await fn(...args, ctx);`; // ctx is available if fn uses it
  return runInline(fnSrc, args, options);
}

// Queue-aware versions (use your scheduler)
function manageGenericJobs(queueRef) {
  const submit = manageCpuBoundTasks(queueRef);
  return (job, opts) => submit(_genericWorkerPath(), job, opts);
}
function manageInline(queueRef) {
  const submit = manageCpuBoundTasks(queueRef);
  return (code, args = [], options = {}) =>
    submit(_genericWorkerPath(), { kind: 'inline', code, args, timeoutMs: options.timeoutMs || 0, sandbox: options.sandbox, bigintToString: !!options.bigintToString }, options);
}
function manageFunction(queueRef) {
  const submit = manageCpuBoundTasks(queueRef);
  return (fn, args = [], options = {}) => {
    const fnSrc = `const fn = (${fn.toString()}); return await fn(...args, ctx);`;
    return submit(_genericWorkerPath(), { kind: 'inline', code: fnSrc, args, timeoutMs: options.timeoutMs || 0, sandbox: options.sandbox, bigintToString: !!options.bigintToString }, options);
  };
}

module.exports = {
  // cluster + scheduler
  startLoadBalancer,
  manageCpuBoundTasks,
  dynamicResourceAllocator,
  getHealthMetrics,
  getMemoryUsage,

  // low-level
  runWorkerTask,

  // no-worker-file, single-shot
  runGenericJob,
  runInline,
  runModule,
  runFunction,

  // no-worker-file, queued
  manageGenericJobs,
  manageInline,
  manageFunction
};
