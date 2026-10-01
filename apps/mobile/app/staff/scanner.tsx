import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Vibration, Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";
import { colors, spacing } from "@ticketly/ui";
import { apiFetch } from "@/lib/api";
import { getSessionToken } from "@/lib/secure-store";
import {
  enqueueOfflineCheckIn,
  isOnline,
  loadOfflineBundle,
  offlineLookup,
  syncOfflineQueue,
  type LocalBundle,
} from "@/lib/offline-scanner";
import type { ScanResultCode } from "@ticketly/shared-types";

/**
 * Staff / door scanner — native camera, continuous scan.
 * Can be extracted to a separate app later; keep this module self-contained.
 */

const RESULT_COLORS: Record<string, string> = {
  SUCCESS: colors.success,
  ALREADY_USED: colors.danger,
  INVALID: colors.danger,
  WRONG_EVENT: colors.warning,
  CANCELLED: colors.danger,
  REFUNDED: colors.danger,
  EVENT_CANCELLED: colors.danger,
};

type Props = { eventId?: string };

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [eventId, setEventId] = useState<string | null>(null);
  const [events, setEvents] = useState<{ id: string; name: string }[]>([]);
  const [result, setResult] = useState<{
    code: ScanResultCode;
    message: string;
    detail?: string;
  } | null>(null);
  const [mode, setMode] = useState<"ONLINE" | "OFFLINE">("ONLINE");
  const [bundle, setBundle] = useState<LocalBundle | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const deviceId = useRef(`device_${Platform.OS}_${Date.now()}`);

  useEffect(() => {
    void (async () => {
      const token = await getSessionToken();
      if (!token) return;
      try {
        const data = await apiFetch<{ events: { id: string; name: string }[] }>(
          "/api/mobile/staff/events",
          { token }
        );
        setEvents(data.events);
        if (data.events[0]) setEventId(data.events[0].id);
      } catch {
        /* ignore */
      }
      const b = await loadOfflineBundle();
      setBundle(b);
    })();
  }, []);

  const feedback = useCallback(async (code: ScanResultCode) => {
    if (code === "SUCCESS") {
      Vibration.vibrate(80);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Vibration.vibrate([0, 120, 60, 120]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    try {
      // Short system beep via expo-av would need asset; haptic+vibration is primary for noisy venues
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    } catch {
      /* optional */
    }
  }, []);

  const onScan = useCallback(
    async (data: string) => {
      if (!eventId || busy.current || result) return;
      busy.current = true;
      try {
        const online = await isOnline();
        if (online) {
          setMode("ONLINE");
          const token = await getSessionToken();
          const res = await apiFetch<{
            result: ScanResultCode;
            message: string;
            ticket?: { holderName?: string | null; ticketType?: string };
          }>("/api/tickets/check-in", {
            method: "POST",
            token,
            body: JSON.stringify({
              token: data,
              eventId,
              deviceId: deviceId.current,
            }),
          });
          setResult({
            code: res.result,
            message: res.message,
            detail: res.ticket
              ? `${res.ticket.holderName ?? ""} · ${res.ticket.ticketType ?? ""}`
              : undefined,
          });
          await feedback(res.result);
          // Opportunistic sync
          void syncOfflineQueue(eventId, deviceId.current).catch(() => undefined);
        } else {
          setMode("OFFLINE");
          const b = bundle ?? (await loadOfflineBundle());
          if (!b) {
            setResult({
              code: "INVALID",
              message: "OFFLINE — last ned validation bundle først",
            });
            await feedback("INVALID");
            return;
          }
          const local = await offlineLookup(b, data, eventId);
          setBundle(b);
          setResult({
            code: local.result,
            message: local.message + " (offline)",
            detail: local.ticketTypeName,
          });
          seq.current += 1;
          await enqueueOfflineCheckIn({
            localId: crypto.randomUUID(),
            sequenceNumber: seq.current,
            eventId,
            ticketPublicId: local.publicId ?? "unknown",
            ticketTokenHash: local.tokenHash ?? "",
            deviceId: deviceId.current,
            localCheckedInAt: new Date().toISOString(),
            result: local.result,
          });
          await feedback(local.result);
        }
      } catch (e) {
        setResult({
          code: "INVALID",
          message: e instanceof Error ? e.message : "FEIL",
        });
        await feedback("INVALID");
      } finally {
        setTimeout(() => {
          busy.current = false;
        }, 1200);
      }
    },
    [eventId, result, bundle, feedback]
  );

  async function downloadBundle() {
    if (!eventId) return;
    const token = await getSessionToken();
    const data = await apiFetch<{
      eventId: string;
      version: number;
      expiresAt: string;
      entries: LocalBundle["entries"];
    }>(`/api/scanner/offline/bundle?eventId=${eventId}`, { token });
    const local: LocalBundle = {
      eventId: data.eventId,
      version: data.version,
      expiresAt: data.expiresAt,
      entries: data.entries,
    };
    const { saveOfflineBundle } = await import("@/lib/offline-scanner");
    await saveOfflineBundle(local);
    setBundle(local);
  }

  if (!permission) {
    return <View style={styles.container} />;
  }
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Kamera kreves for scanner</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Gi tilgang</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Text style={styles.mode}>{mode} · STAFF</Text>
        <View style={styles.eventRow}>
          {events.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => setEventId(e.id)}
              style={[styles.chip, eventId === e.id && styles.chipActive]}
            >
              <Text style={styles.chipText}>{e.name}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.bundleBtn} onPress={downloadBundle}>
          <Text style={styles.btnText}>
            Last ned offline-bundle {bundle ? `(v${bundle.version})` : ""}
          </Text>
        </Pressable>
      </View>

      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={result ? undefined : ({ data }) => void onScan(data)}
      />

      {result ? (
        <Pressable
          style={[styles.result, { backgroundColor: RESULT_COLORS[result.code] ?? "#333" }]}
          onPress={() => setResult(null)}
        >
          <Text style={styles.resultTitle}>{result.message}</Text>
          {result.detail ? <Text style={styles.resultDetail}>{result.detail}</Text> : null}
          <Text style={styles.resultHint}>Trykk for neste</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  top: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.bg },
  mode: { color: colors.accent, fontWeight: "700" },
  eventRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#27272a", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontSize: 12 },
  bundleBtn: { backgroundColor: "#3f3f46", padding: 10, borderRadius: 8, alignItems: "center" },
  camera: { flex: 1 },
  result: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  resultTitle: { color: "#fff", fontSize: 40, fontWeight: "900", textAlign: "center" },
  resultDetail: { color: "#fff", fontSize: 18, marginTop: 12, textAlign: "center" },
  resultHint: { color: "rgba(255,255,255,0.7)", marginTop: 24 },
  message: { color: colors.text, textAlign: "center", marginTop: 80 },
  btn: { margin: spacing.lg, backgroundColor: colors.accent, padding: spacing.md, borderRadius: 12 },
  btnText: { color: "#09090b", fontWeight: "700", textAlign: "center" },
});
