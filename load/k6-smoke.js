/**
 * Ticketly load profile — measure first, optimize later.
 *
 * Usage:
 *   k6 run -e BASE_URL=http://localhost:3456 load/k6-smoke.js
 *
 * Scenarios approximate:
 * - 500 concurrent event visitors (ramped)
 * - reservation / checkout / scanner bursts as separate stages
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3456";

export const options = {
  scenarios: {
    visitors: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 100 },
        { duration: "1m", target: 500 },
        { duration: "30s", target: 0 },
      ],
      exec: "browseEvent",
    },
    reservations: {
      executor: "constant-vus",
      vus: 100,
      duration: "45s",
      startTime: "2m",
      exec: "reserveBurst",
    },
    checkout: {
      executor: "constant-vus",
      vus: 20,
      duration: "45s",
      startTime: "2m45s",
      exec: "checkoutBurst",
    },
    scanners: {
      executor: "constant-vus",
      vus: 10,
      duration: "45s",
      startTime: "3m30s",
      exec: "scannerHealth",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000"],
  },
};

export function browseEvent() {
  const res = http.get(`${BASE}/events/friday-night`);
  check(res, { "event 200": (r) => r.status === 200 });
  sleep(0.5);
}

export function reserveBurst() {
  // Intentionally hits public pages / health under load; full reserve needs session+IDs from seed
  const res = http.get(`${BASE}/api/health`);
  check(res, { "health ok": (r) => r.status === 200 });
  sleep(0.2);
}

export function checkoutBurst() {
  const res = http.get(`${BASE}/api/ready`);
  check(res, { "ready ok": (r) => r.status === 200 || r.status === 503 });
  sleep(0.3);
}

export function scannerHealth() {
  const res = http.get(`${BASE}/api/health`);
  check(res, { "scanner probe": (r) => r.status === 200 });
  sleep(0.2);
}
