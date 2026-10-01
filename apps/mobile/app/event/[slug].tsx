import { useLocalSearchParams, Link } from "expo-router";
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { colors, spacing } from "@ticketly/ui";
import { apiFetch } from "@/lib/api";

export default function EventDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [event, setEvent] = useState<{
    name: string;
    description?: string;
    startsAt: string;
    city?: string;
    ageLimit?: number;
    seller: { legalName: string; organizationNumber?: string };
    ticketTypes: { id: string; name: string; price: number; available: number }[];
  } | null>(null);

  useEffect(() => {
    void apiFetch<{ event: NonNullable<typeof event> }>(`/api/mobile/events/${slug}`).then((d) =>
      setEvent(d.event)
    );
  }, [slug]);

  if (!event) {
    return (
      <View style={styles.container}>
        <Text style={styles.meta}>Laster…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Text style={styles.title}>{event.name}</Text>
      <Text style={styles.meta}>
        {new Date(event.startsAt).toLocaleString("nb-NO")} · {event.city}
      </Text>
      {event.ageLimit ? <Text style={styles.meta}>{event.ageLimit}+</Text> : null}
      <Text style={styles.body}>{event.description}</Text>

      <Text style={styles.section}>Selger</Text>
      <Text style={styles.meta}>
        {event.seller.legalName}
        {event.seller.organizationNumber ? ` · org.nr ${event.seller.organizationNumber}` : ""}
      </Text>

      <Text style={styles.section}>Billetter</Text>
      {event.ticketTypes.map((t) => (
        <View key={t.id} style={styles.row}>
          <Text style={styles.ticketName}>{t.name}</Text>
          <Text style={styles.price}>
            {t.available <= 0 ? "Utsolgt" : `${(t.price / 100).toFixed(0)} kr`}
          </Text>
        </View>
      ))}

      <Link
        href={{ pathname: "/event/[slug]", params: { slug: String(slug), checkout: "1" } }}
        asChild
      >
        <Pressable style={styles.btn}>
          <Text style={styles.btnText}>Kjøp billetter</Text>
        </Pressable>
      </Link>
      <Text style={styles.hint}>
        Checkout viser selger, serviceavgift og vilkår før betaling. Guest checkout støttes.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  meta: { color: colors.muted, marginTop: 6 },
  body: { color: colors.text, marginTop: spacing.md, lineHeight: 22 },
  section: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: spacing.lg },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#27272a",
  },
  ticketName: { color: colors.text },
  price: { color: colors.accent, fontWeight: "600" },
  btn: {
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: "center",
  },
  btnText: { fontWeight: "700", color: "#09090b" },
  hint: { color: colors.muted, fontSize: 12, marginTop: spacing.sm },
});
