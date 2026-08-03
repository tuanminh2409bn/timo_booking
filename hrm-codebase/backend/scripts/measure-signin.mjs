import { performance } from "node:perf_hooks";

// Measures /auth/signin backend latency and prints the Server-Timing breakdown.
// Usage:
//   node scripts/measure-signin.mjs --idToken firebase-id-token [--n 10] [--url http://localhost:8090]

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, index, all) => {
    if (token.startsWith("--")) {
      pairs.push([token.slice(2), all[index + 1]]);
    }
    return pairs;
  }, []),
);

const baseUrl = args.url ?? process.env.SIGNIN_URL ?? "http://localhost:8090";
const idToken = args.idToken ?? process.env.SIGNIN_ID_TOKEN;
const iterations = Number.parseInt(args.n ?? "10", 10);

if (!idToken) {
  console.error("Missing --idToken (or SIGNIN_ID_TOKEN).");
  process.exit(1);
}

const endpoint = `${baseUrl.replace(/\/$/, "")}/api/v1/auth/signin`;

const parseServerTiming = (header) => {
  if (!header) return {};
  return Object.fromEntries(
    header.split(",").map((part) => {
      const name = part.trim().split(";")[0];
      const dur = /dur=([0-9.]+)/.exec(part);
      return [name, dur ? Number(dur[1]) : null];
    }),
  );
};

const percentile = (sorted, p) => {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
};

const summarize = (label, values) => {
  if (values.length === 0) {
    console.log(`${label}: (no samples)`);
    return;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p90 = percentile(sorted, 90);
  const p95 = percentile(sorted, 95);
  console.log(
    `${label}: n=${values.length} p50=${p50?.toFixed(1)}ms p90=${p90?.toFixed(1)}ms p95=${p95?.toFixed(1)}ms min=${sorted[0].toFixed(1)} max=${sorted[sorted.length - 1].toFixed(1)}`,
  );
};

const samples = [];

for (let i = 0; i < iterations; i += 1) {
  const start = performance.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
  } catch (error) {
    console.error(`request ${i + 1} failed:`, error.message);
    continue;
  }
  const e2eMs = performance.now() - start;
  const serverTiming = parseServerTiming(response.headers.get("server-timing"));

  await response.text();

  samples.push({ e2eMs, status: response.status, serverTiming });
  console.log(
    `#${i + 1} status=${response.status} e2e=${e2eMs.toFixed(1)}ms server-timing=${JSON.stringify(serverTiming)}`,
  );
}

const ok = samples.filter((sample) => sample.status === 201);
const warm = ok.slice(1);

console.log("\n=== Summary ===");
summarize("E2E    all ", ok.map((s) => s.e2eMs));
summarize("E2E    warm", warm.map((s) => s.e2eMs));
for (const phase of ["firebaseVerify", "userRead", "jwt"]) {
  const values = ok.map((s) => s.serverTiming[phase]).filter((value) => typeof value === "number");
  summarize(`server ${phase.padEnd(14)}`, values);
}