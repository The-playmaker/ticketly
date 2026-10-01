import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

export type CachedTicket = {
  publicId: string;
  secureToken: string;
  qrPayload: string;
  eventName: string;
  startsAt: string;
  venue: string;
  ticketTypeName: string;
  holderName: string;
  orderNumber: string;
  status: string;
  downloadedAt: string;
};

const INDEX_KEY = "ticketly_ticket_index";
const KEY_NAME = "ticketly_ticket_cache_key";

function toBase64(bytes: number[]): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): number[] {
  const binary = atob(b64);
  const out: number[] = [];
  for (let i = 0; i < binary.length; i++) out.push(binary.charCodeAt(i));
  return out;
}

function xorEncode(input: string, key: string): string {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    out.push(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return toBase64(out);
}

function xorDecode(b64: string, key: string): string {
  const bytes = fromBase64(b64);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]! ^ key.charCodeAt(i % key.length));
  }
  return out;
}

async function getCacheKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(KEY_NAME);
  if (!key) {
    key = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, Crypto.randomUUID())).slice(0, 64);
    await SecureStore.setItemAsync(KEY_NAME, key);
  }
  return key;
}

export async function cacheTickets(tickets: CachedTicket[]) {
  const key = await getCacheKey();
  const ids: string[] = [];
  for (const t of tickets) {
    await AsyncStorage.setItem(`ticketly_t_${t.publicId}`, xorEncode(JSON.stringify(t), key));
    ids.push(t.publicId);
  }
  const prev = await listCachedTicketIds();
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(Array.from(new Set([...prev, ...ids]))));
}

export async function listCachedTicketIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function getCachedTicket(publicId: string): Promise<CachedTicket | null> {
  const key = await getCacheKey();
  const enc = await AsyncStorage.getItem(`ticketly_t_${publicId}`);
  if (!enc) return null;
  try {
    return JSON.parse(xorDecode(enc, key)) as CachedTicket;
  } catch {
    return null;
  }
}

export async function getAllCachedTickets(): Promise<CachedTicket[]> {
  const ids = await listCachedTicketIds();
  const out: CachedTicket[] = [];
  for (const id of ids) {
    const t = await getCachedTicket(id);
    if (t) out.push(t);
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
