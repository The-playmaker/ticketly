import * as SecureStore from "expo-secure-store";

/**
 * Auth secrets use iOS Keychain / Android Keystore via SecureStore.
 * Never store session tokens in AsyncStorage.
 */

const SESSION_KEY = "ticketly_session_token";
const USER_KEY = "ticketly_user_json";

export async function saveSession(token: string, user: object) {
  await SecureStore.setItemAsync(SESSION_KEY, token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}

export async function getStoredUser<T = unknown>(): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}
