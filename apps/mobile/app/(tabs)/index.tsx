import { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from "react-native";
import { Link, useFocusEffect } from "expo-router";
import { colors, spacing } from "@ticketly/ui";
import { apiFetch } from "@/lib/api";

type EventCard = {
  id: string;
  name: string;
  slug: string;
  startsAt: string;
  city: string | null;
  coverImageUrl: string | null;
  organization: { name: string };
  fromPrice?: number;
};

export default function EventsScreen() {
  const [events, setEvents] = useState<EventCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ events: EventCard[] }>("/api/mobile/events");
      setEvents(data.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke hente events");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Ticketly</Text>
      <Text style={styles.sub}>Kommende arrangementer</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={events}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        renderItem={({ item }) => (
          <Link href={`/event/${item.slug}`} asChild>
            <Pressable style={styles.card}>
              <Text style={styles.org}>{item.organization.name}</Text>
              <Text style={styles.title}>{item.name}</Text>
              <Text style={styles.meta}>
                {new Date(item.startsAt).toLocaleString("nb-NO")} · {item.city}
              </Text>
              {item.fromPrice != null ? (
                <Text style={styles.price}>Fra {(item.fromPrice / 100).toFixed(0)} kr</Text>
              ) : null}
            </Pressable>
          </Link>
        )}
        ListEmptyComponent={
          !loading ? <Text style={styles.meta}>Ingen publiserte events.</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.bg },
  brand: { color: colors.text, fontSize: 32, fontWeight: "800" },
  sub: { color: colors.muted, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: "#27272a",
  },
  org: { color: colors.accent, fontSize: 12, textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: 4 },
  meta: { color: colors.muted, marginTop: 6 },
  price: { color: colors.accent, marginTop: 8, fontWeight: "600" },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
