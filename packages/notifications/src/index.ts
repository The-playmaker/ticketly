import type { NotificationCategory } from "@ticketly/shared-types";

export type PushMessage = {
  to: string | string[]; // Expo push token(s) or device tokens
  title: string;
  body: string;
  data?: Record<string, unknown>;
  category: NotificationCategory;
  sound?: "default" | null;
};

export type PushSendResult = { id: string; provider: string };

/**
 * PushProvider abstraction.
 * v1: Expo Push. Later: APNs / FCM without changing call sites.
 *
 * TRANSACTIONAL / SERVICE messages (ticket confirmed, event cancelled)
 * are independent of MARKETING consent.
 */
export interface PushProvider {
  readonly name: "EXPO" | "APNS" | "FCM";
  send(message: PushMessage): Promise<PushSendResult>;
}

export class ExpoPushProvider implements PushProvider {
  readonly name = "EXPO" as const;

  async send(message: PushMessage): Promise<PushSendResult> {
    const tokens = Array.isArray(message.to) ? message.to : [message.to];
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title: message.title,
          body: message.body,
          data: { ...message.data, category: message.category },
          sound: message.sound ?? "default",
        }))
      ),
    });
    if (!res.ok) {
      throw new Error(`Expo push failed: ${res.status}`);
    }
    const json = (await res.json()) as { data?: { id?: string }[] };
    return { id: json.data?.[0]?.id ?? `expo_${Date.now()}`, provider: "EXPO" };
  }
}

/** Stub — implement with APNs when certificates are configured */
export class ApnsPushProvider implements PushProvider {
  readonly name = "APNS" as const;
  async send(): Promise<PushSendResult> {
    throw new Error("APNs not configured. Set certificates before enabling.");
  }
}

/** Stub — implement with FCM when Firebase credentials are configured */
export class FcmPushProvider implements PushProvider {
  readonly name = "FCM" as const;
  async send(): Promise<PushSendResult> {
    throw new Error("FCM not configured. Set Firebase credentials before enabling.");
  }
}

export function getPushProvider(): PushProvider {
  const provider = process.env.PUSH_PROVIDER ?? "EXPO";
  switch (provider) {
    case "APNS":
      return new ApnsPushProvider();
    case "FCM":
      return new FcmPushProvider();
    case "EXPO":
    default:
      return new ExpoPushProvider();
  }
}

export function shouldSendMarketing(prefs: { category: string; enabled: boolean }[]): boolean {
  return prefs.some((p) => p.category === "MARKETING" && p.enabled);
}

/** Service/transactional notifications do not require marketing consent */
export function isTransactionalCategory(category: NotificationCategory): boolean {
  return category === "TRANSACTIONAL" || category === "SERVICE";
}
