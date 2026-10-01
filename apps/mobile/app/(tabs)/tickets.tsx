import { useCallback, useState } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useFocusEffect } from "expo-router";
import { colors, spacing } from "@ticketly/ui";
import { apiFetch } from "@/lib/api";
import { getSessionToken } from "@/lib/secure-store";
import { cacheTickets, getAllCachedTickets, type CachedTicket } from "@/lib/offline-tickets";

export default function TicketsScreen() {
  const [tickets, setTickets] = useState<CachedTicket[]>([]);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    const cached = await getAllCachedTickets();
    setTickets(cached);
    try {
      const token = await getSessionToken();
      if (!token) {
        setOffline(cached.length > 0);
        return;
      }
      const data = await apiFetch<{
        tickets: {
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
        }[];
      }>("/api/mobile/tickets", { token });
      const mapped: CachedTicket[] = data.tickets.map((t) => ({
        ...t,
        downloadedAt: new Date().toISOString(),
      }));
      await cacheTickets(mapped);
      setTickets(await getAllCachedTickets());
      setOffline(false);
    } catch {
      setOffline(true);
      setTickets(await getAllCachedTickets());
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Mine billetter</Text>
      {offline ? (
        <Text style={styles.banner}>Offline — viser nedlastede billetter</Text>
      ) : null}
      <FlatList
        data={tickets}
        keyExtractor={(t) => t.publicId}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.event}>{item.eventName}</Text>
            <Text style={styles.meta}>{item.ticketTypeName}</Text>
            <Text style={styles.meta}>{new Date(item.startsAt).toLocaleString("nb-NO")}</Text>
            <Text style={styles.meta}>{item.venue}</Text>
            <View style={styles.qrWrap}>
              <QRCode value={item.qrPayload} size={180} backgroundColor="#fff" />
            </View>
            <Text style={styles.id}>{item.publicId}</Text>
            <Text style={styles.meta}>{item.status}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.meta}>Ingen billetter lagret.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.bg },
  heading: { color: colors.text, fontSize: 24, fontWeight: "700", marginBottom: spacing.sm },
  banner: {
    backgroundColor: "#422006",
    color: "#fde68a",
    padding: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "#27272a",
  },
  event: { color: colors.text, fontSize: 20, fontWeight: "700" },
  meta: { color: colors.muted, marginTop: 4 },
  qrWrap: { alignSelf: "center", backgroundColor: "#fff", padding: 12, borderRadius: 12, marginVertical: 16 },
  id: { color: colors.text, fontFamily: "monospace", textAlign: "center" },
});
