# LoadBalancer.js

A dynamic load balancer for Node.js apps that optimizes CPU and memory allocation between I/O and CPU-bound tasks. It can queue and run CPU work on background **worker threads**, scale an Express server across **clustered processes**, and (optionally) run tasks **without any user-written worker files** via a bundled generic worker.

> **Requirements:** Node.js **18+**

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [Quick Start (no worker files)](#quick-start-no-worker-files)
  - [Express + Cluster Example](#express--cluster-example)
  - [Legacy: Using your own worker file](#legacy-using-your-own-worker-file)
  - [Simple “Fib + Factors” Script](#simple-fib--factors-script)
- [API Documentation](#api-documentation)
- [Health & Monitoring](#health--monitoring)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Dynamic resource allocation** — shifts cores between I/O and CPU loads using idle-core detection and memory headroom.
- **Worker thread scheduling** — queues CPU tasks and runs them in the background with backpressure.
- **Cluster support** — optionally run your Express app across cores with resilient workers.
- **No worker files required** — run plain functions or inline code in a worker via the bundled generic worker.
- **Progress & cancellation** — long tasks can report progress and be cancelled.
- **Health metrics** — inspect queue length, worker usage, load averages, and memory.

---

## Installation

```bash
npm i r-load-balancer.js
# or
yarn add r-load-balancer.js
```

---

## Usage

### Quick Start (no worker files)

Run a **plain function** in a worker, and run **inline code** with progress/cancel — no worker files needed.

```js
// quick-start.js
const { runFunction, runInline } = require('r-load-balancer.js');

(async () => {
  // 1) Plain function in a worker
  const { ok: ok1, result: sum } = await runFunction((n) => {
    let s = 0; for (let i = 1; i <= n; i++) s += i; return s;
  }, [10_000_000]);
  if (!ok1) throw new Error('sum failed');
  console.log('sum(1..1e7)=', sum);

  // 2) Inline code with progress + cancellation
  const ac = new AbortController();
  // setTimeout(() => ac.abort(), 500); // uncomment to test cancel

  const { ok: ok2, result } = await runInline(\`
    let s = 0;
    for (let i=1;i<=args[0];i++){
      s += i;
      if (i % 1e6 === 0) { ctx.progress(i/args[0]); await ctx.sleep(0); }
      if (ctx.isCancelled()) return 'cancelled';
    }
    return s;
  \`, [5_000_000], {
    timeoutMs: 15000,
    signal: ac.signal,
    onProgress: p => process.stdout.write('\rprogress: ' + Math.round(p*100) + '%')
  });

  console.log('\ninline result:', result);
})();
```

Run:

```bash
node quick-start.js
```

---

### Express + Cluster Example

Expose a Fibonacci endpoint and a health endpoint, and run across all cores.

```js
// server.js
const express = require('express');
const {
  startLoadBalancer,
  manageFunction,
  getHealthMetrics
} = require('r-load-balancer.js');

const app = express();
const PORT = process.env.PORT || 3000;

const queue = [];
const submit = manageFunction(queue);

// CPU route: fibonacci(n) via fast-doubling (string BigInt)
app.get('/fib', async (req, res) => {
  const n = Number(req.query.n ?? 20000);
  if (!Number.isInteger(n) || n < 0) return res.status(400).json({ error: 'n must be >= 0' });
  try {
    const msg = await submit((N) => {
      N = BigInt(N);
      function pair(k){ if(k===0n) return [0n,1n];
        const [a,b]=pair(k>>1n); const c=a*(2n*b-a), d=a*a+b*b;
        return (k&1n)?[d,c+d]:[c,d]; }
      return pair(N)[0].toString();
    }, [n]);
    const result = 'ok' in msg ? msg.result : msg; // unwrap if needed
    res.json({ n, digits: String(result).length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Health route
app.get('/health', (_req, res) => res.json(getHealthMetrics()));

// Start across CPU cores
startLoadBalancer(app, PORT);
```

Run:

```bash
node server.js
# GET http://localhost:3000/fib?n=40000
# GET http://localhost:3000/health
```

---

### Legacy: Using your own worker file

You can still pass a **path to a worker script** if you prefer.

```js
// heavyTaskWorker.js
const { parentPort, workerData } = require('worker_threads');

function heavy(data) {
  let acc = 0; for (let i = 0; i < data; i++) acc += i; return acc;
}
parentPort.postMessage(heavy(workerData));
```

```js
// legacy-example.js
const path = require('path');
const { manageCpuBoundTasks, startLoadBalancer } = require('r-load-balancer.js');
const express = require('express');

const app = express();
const queue = [];
const handleCpuTask = manageCpuBoundTasks(queue);

app.get('/compute-heavy-task', async (_req, res) => {
  try {
    const result = await handleCpuTask(path.resolve(__dirname, 'heavyTaskWorker.js'), 10_000_000);
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

startLoadBalancer(app, 3000);
```

---

### Simple “Fib + Factors” Script

A tiny script that computes Fibonacci and prime factors in workers, with timestamps.

```js
// examples/simple-fib-factors.js
const { runFunction } = require('r-load-balancer.js');

const nowISO = () => new Date().toISOString();

(async () => {
  const totalStart = Date.now();
  console.log(\`[\${nowISO()}] ▶️ Script start\`);

  try {
    // Fibonacci (fast-doubling). For HUGE n, consider returning only digit count.
    const N = 200000; // adjust as needed
    console.log(\`[\${nowISO()}] ▶️ Starting Fibonacci N=\${N}\`);
    const t0 = Date.now();
    const { ok: okFib, result: fibStr, error: fibErr } = await runFunction((n) => {
      n = BigInt(n);
      function pair(k){ if(k===0n) return [0n,1n];
        const [a,b]=pair(k>>1n); const c=a*(2n*b-a), d=a*a+b*b;
        return (k&1n)?[d,c+d]:[c,d]; }
      return pair(n)[0].toString();
    }, [N]);
    const t1 = Date.now();
    if (!okFib) throw new Error(fibErr);
    console.log(\`[\${nowISO()}] ✅ Fibonacci done in \${(t1 - t0).toLocaleString()} ms\`);
    console.log(\`F(\${N}) digit length:\`, fibStr.length);

    // Prime factors (trial division)
    const TARGET = 600851475143n;
    console.log(\`[\${nowISO()}] ▶️ Starting factors for \${TARGET}\`);
    const f0 = Date.now();
    const { ok: okFac, result: factors, error: facErr } = await runFunction((n) => {
      n = BigInt(n);
      const out = [];
      while (n % 2n === 0n) { out.push('2'); n /= 2n; }
      let f = 3n;
      while (f * f <= n) {
        while (n % f === 0n) { out.push(f.toString()); n /= f; }
        f += 2n;
      }
      if (n > 1n) out.push(n.toString());
      return out;
    }, [TARGET]);
    const f1 = Date.now();
    if (!okFac) throw new Error(facErr);
    console.log(\`[\${nowISO()}] ✅ Factorization done in \${(f1 - f0).toLocaleString()} ms\`);
    console.log(\`Prime factors of \${TARGET}:\`, factors.join(' × '));

    const totalEnd = Date.now();
    console.log(\`[\${nowISO()}] 🎉 All tasks completed in \${(totalEnd - totalStart).toLocaleString()} ms\`);
    process.exit(0);
  } catch (err) {
    console.error(\`[\${nowISO()}] ❌ Error:\`, err && err.message ? err.message : err);
    process.exit(1);
  }
})();
```

Run:

```bash
node examples/simple-fib-factors.js
```

---

## API Documentation

> All functions return Promises. If a result is wrapped as `{ ok, result }`, unwrap with `msg.result`.

### Core (no worker files needed)

#### `runFunction(fn, args = [], options?) → Promise<{ ok: boolean, result: any, error?: string }>`
Run a plain JS function on a worker thread.

- **`fn`**: `(…args, ctx?) => any | Promise<any)`  
  The `ctx` (last arg) exposes:
  - `ctx.progress(value: number)` — send progress (0..1)
  - `ctx.sleep(ms: number)` — yield/await inside loops
  - `ctx.isCancelled()` — check if aborted
- **`options`**:
  - `timeoutMs?: number`
  - `signal?: AbortSignal`
  - `onProgress?: (value: number) => void`
  - `bigintToString?: boolean` (when returning BigInt-rich objects)

#### `runInline(code, args = [], options?)`
Run a **code string** inside the worker (`vm`). *Trusted code only.*

#### `runModule(modulePath, exportName = 'default', args = [], options?)`
Call an **exported function** from a module (CJS/ESM supported).

### Queue-backed helpers (with backpressure)

#### `manageFunction(queue) → (fn, args, options?) => Promise<Message>`
Schedule a function to run in a worker via an internal queue.

- Use this in servers to avoid overloading CPU with too many concurrent jobs.
- Backpressure: if the queue is full, the call rejects.

*(Also available: `manageInline(queue)` and `manageGenericJobs(queue)`.)*

### Cluster & Scheduling

#### `startLoadBalancer(app, port)`
Run an Express app across CPU cores (cluster) and start the dynamic scheduler loop.

#### `manageCpuBoundTasks(queue) → (workerRef, workerData, options?) => Promise<any>`
Low-level: schedule a worker **file path** or **inline code string** directly.  
Prefer `manageFunction` unless you explicitly need worker files.

### Metrics

#### `getHealthMetrics()`
Returns scheduler/system/memory stats:

```json
{
  "system": {
    "totalCores": 12,
    "busyCores": 4,
    "availableCores": 8,
    "loadAverage": { "1m": 1.02, "5m": 0.85, "15m": 0.77 },
    "uptime": "12.34 hours"
  },
  "memory": {
    "totalMemory": "32768 MB",
    "availableMemory": "25482 MB",
    "reservedByScheduler": "1024 MB",
    "processHeapUsed": "210 MB"
  },
  "tasks": {
    "taskQueueLength": 3,
    "busyIOWorkers": 0,
    "busyCPUWorkers": 2
  }
}
```

#### `getMemoryUsage()`
Returns `process.memoryUsage().heapUsed` (bytes).

---

## Health & Monitoring

Add a health endpoint to your server:

```js
app.get('/health', (_req, res) => res.json(getHealthMetrics()));
```

You can also log queue length and reserved memory periodically with your preferred logger/APM.

---

## Configuration

The library adapts to your environment by:
- Sampling CPU deltas to estimate **idle cores**
- Reserving synthetic memory per worker to maintain **headroom**
- Applying **backpressure** when the queue exceeds a safe max

If you need to tune the queue size or reservation heuristic for your workload, open an issue or send a PR.

> **Security note:** `runInline` executes trusted code only. The `vm` module is **not** a security boundary.

---

## Contributing

PRs and issues welcome! Useful areas:
- Priority queues / pluggable scheduling policies
- Better per-worker memory telemetry (RSS)
- Built-in cancellation tokens surfaced to HTTP endpoints
- TypeScript typings

---

## License

MIT © Rohith Addula
