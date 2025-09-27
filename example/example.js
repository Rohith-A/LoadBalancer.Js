// examples/simple-fib-factors.js
// Run: node examples/simple-fib-factors.js
// Requires your package to export: runFunction

const { runFunction } = require('r-load-balancer.js'); // or: require('../loadBalancer.js')

const nowISO = () => new Date().toISOString();

(async () => {
  const totalStart = Date.now();
  console.log(`[${nowISO()}] ▶️ Script start`);

  try {
    // ---- 1) Fibonacci with fast-doubling (returns stringified BigInt) ----
    const N = 250000000; // try 100k+ for just digit length, or keep smaller to print
    console.log(`[${nowISO()}] ▶️ Starting Fibonacci for N=${N}`);
    const fibStart = Date.now();

    const { ok: okFib, result: fibStr, error: fibErr } = await runFunction((n) => {
      n = BigInt(n);
      function pair(k) {
        if (k === 0n) return [0n, 1n];
        const [a, b] = pair(k >> 1n);
        const c = a * (2n * b - a);
        const d = a * a + b * b;
        return (k & 1n) ? [d, c + d] : [c, d];
      }
      // return F(n) as a string so it's easy to log
      return pair(n)[0].toString();
    }, [N]);

    const fibEnd = Date.now();
    if (!okFib) throw new Error(fibErr);
    console.log(`[${nowISO()}] ✅ Fibonacci done`);
    console.log(`    start: ${new Date(fibStart).toISOString()}`);
    console.log(`    end:   ${new Date(fibEnd).toISOString()}`);
    console.log(`    time:  ${(fibEnd - fibStart).toLocaleString()} ms`);
    console.log(`F(${N}) digit length:`, fibStr.length);
    // console.log(`F(${N}) = ${fibStr}`); // uncomment if N is small enough

    // ---- 2) Prime factorization (trial division; simple & readable) ----
    const TARGET = 600851475143n; // classic example → 71 × 839 × 1471 × 6857
    console.log(`[${nowISO()}] ▶️ Starting factorization for ${TARGET}`);
    const facStart = Date.now();

    const { ok: okFac, result: factors, error: facErr } = await runFunction((n) => {
      // n is BigInt
      n = BigInt(n);
      const out = [];

      // factor 2’s
      while (n % 2n === 0n) { out.push('2'); n /= 2n; }

      // odd factors
      let f = 3n;
      while (f * f <= n) {
        while (n % f === 0n) { out.push(f.toString()); n /= f; }
        f += 2n;
      }
      if (n > 1n) out.push(n.toString()); // remaining prime

      return out; // array of stringified primes
    }, [TARGET]);

    const facEnd = Date.now();
    if (!okFac) throw new Error(facErr);
    console.log(`[${nowISO()}] ✅ Factorization done`);
    console.log(`    start: ${new Date(facStart).toISOString()}`);
    console.log(`    end:   ${new Date(facEnd).toISOString()}`);
    console.log(`    time:  ${(facEnd - facStart).toLocaleString()} ms`);
    console.log(`Prime factors of ${TARGET}:`, factors.join(' × '));

    const totalEnd = Date.now();
    console.log(`[${nowISO()}] 🎉 All tasks completed`);
    console.log(`Total runtime: ${(totalEnd - totalStart).toLocaleString()}s`);
    process.exit(0);
  } catch (err) {
    console.error(`[${nowISO()}] ❌ Error:`, err && err.message ? err.message : err);
    process.exit(1);
  }
})();
