import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import type { OfflineCheckInPayload, OfflineTicketEntry, ScanResultCode } from "@ticketly/shared-types";
import { apiFetch } from "./api";
import { getSessionToken } from "./secure-store";

/**
 * Staff offline scanner queue.
 * Stores minimal identifiers only (publicId + token hash) — no customer PII.
 * Online validation is preferred whenever network is available.
 */

const QUEUE_KEY = "ticketly_offline_checkin_queue";
const BUNDLE_KEY = "ticketly_offline_bundle";

export type LocalBundle = {
  eventId: string;
  version: number;
  expiresAt: string;
  entries: OfflineTicketEntry[];
};

export async function isOnline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

export async function saveOfflineBundle(bundle: LocalBundle) {
  await AsyncStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle));
}

export async function loadOfflineBundle(): Promise<LocalBundle | null> {
  const raw = await AsyncStorage.getItem(BUNDLE_KEY);
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as LocalBundle;
    if (new Date(b.expiresAt) < new Date()) return null;
    return b;
  } catch {
    return null;
  }
}

export async function enqueueOfflineCheckIn(item: OfflineCheckInPayload) {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const q: OfflineCheckInPayload[] = raw ? JSON.parse(raw) : [];
  q.push(item);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export async function peekOfflineQueue(): Promise<OfflineCheckInPayload[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as OfflineCheckInPayload[]) : [];
}

export async function clearSyncedFromQueue(localIds: string[]) {
  const q = await peekOfflineQueue();
  const set = new Set(localIds);
  await AsyncStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(q.filter((i) => !set.has(i.localId)))
  );
}

export async function syncOfflineQueue(eventId: string, deviceId: string) {
  const token = await getSessionToken();
  const queue = (await peekOfflineQueue()).filter((i) => i.eventId === eventId);
  if (!queue.length) return [];
  const result = await apiFetch<{
    results: { localId: string; status: string }[];
  }>("/api/scanner/offline/sync", {
    method: "POST",
    token,
    body: JSON.stringify({ eventId, deviceId, checkIns: queue }),
  });
  const done = result.results
    .filter((r) => ["SYNCED", "ALREADY_SYNCED", "RECORDED_NON_SUCCESS", "REJECTED", "CONFLICT"].includes(r.status))
    .map((r) => r.localId);
  await clearSyncedFromQueue(done);
  return result.results;
}

export function validateOfflineLocal(
  bundle: LocalBundle,
  tokenOrUrl: string,
  eventId: string
): { result: ScanResultCode; message: string; ticketTypeName?: string; publicId?: string } {
  if (bundle.eventId !== eventId) {
    return { result: "WRONG_EVENT", message: "FEIL ARRANGEMENT" };
  }
  const match = tokenOrUrl.match(/\/t\/verify\/([^/?#]+)/);
  const token = match?.[1] ?? tokenOrUrl;
  // Client-side hash must match server hashing — use same SHA-256 hex
  // For RN we approximate lookup by comparing precomputed hashes after hashing token
  return {
    result: "INVALID",
    message: "UGYLDIG BILLETT",
    // Real hash compare done asynchronously by caller with expo-crypto
    publicId: token,
  };
}

export async function hashToken(token: string): Promise<string> {
  return CryptoDigest(token);
}

async function CryptoDigest(value: string): Promise<string> {
  const Crypto = await import("expo-crypto");
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

export async function offlineLookup(
  bundle: LocalBundle,
  tokenOrUrl: string,
  eventId: string
): Promise<{ result: ScanResultCode; message: string; ticketTypeName?: string; publicId?: string; tokenHash?: string }> {
  if (bundle.eventId !== eventId) {
    return { result: "WRONG_EVENT", message: "FEIL ARRANGEMENT" };
  }
  // Never treat dynamic QR as static offline — no insecure fallback
  if (tokenOrUrl.includes("dqr.v1") || tokenOrUrl.includes("/t/dqr/")) {
    return {
      result: "INVALID",
      message: "DYNAMISK QR KREVER ONLINE",
    };
  }
  const match = tokenOrUrl.match(/\/t\/verify\/([^/?#]+)/);
  const token = match?.[1] ?? tokenOrUrl;
  const tokenHash = await hashToken(token);
  const entry = bundle.entries.find((e) => e.tokenHash === tokenHash);
  if (!entry) return { result: "INVALID", message: "UGYLDIG BILLETT" };
  if (entry.status === "CHECKED_IN") {
    return {
      result: "ALREADY_USED",
      message: "ALLEREDE BRUKT",
      ticketTypeName: entry.ticketTypeName,
      publicId: entry.publicId,
      tokenHash,
    };
  }
  if (entry.status !== "VALID") {
    return { result: entry.status === "REFUNDED" ? "REFUNDED" : "CANCELLED", message: entry.status, publicId: entry.publicId, tokenHash };
  }
  // Mark local bundle entry checked-in optimistically
  entry.status = "CHECKED_IN";
  await saveOfflineBundle(bundle);
  return {
    result: "SUCCESS",
    message: "GYLDIG BILLETT",
    ticketTypeName: entry.ticketTypeName,
    publicId: entry.publicId,
    tokenHash,
  };
}
