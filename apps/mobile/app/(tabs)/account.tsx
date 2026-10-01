import { View, Text, Pressable, StyleSheet, Switch } from "react-native";
import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { colors, spacing } from "@ticketly/ui";
import { clearSession, getStoredUser } from "@/lib/secure-store";
import { apiFetch } from "@/lib/api";
import { getSessionToken } from "@/lib/secure-store";

export default function AccountScreen() {
  const [email, setEmail] = useState<string | null>(null);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    void (async () => {
      const user = await getStoredUser<{ email?: string }>();
      setEmail(user?.email ?? null);
    })();
  }, []);

  async function toggleMarketing(value: boolean) {
    setMarketing(value);
    const token = await getSessionToken();
    if (!token) return;
    await apiFetch("/api/mobile/consent", {
      method: "POST",
      token,
      body: JSON.stringify({
        purpose: "MARKETING_PUSH",
        version: "1.0",
        granted: value,
      }),
    }).catch(() => undefined);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Konto</Text>
      {email ? <Text style={styles.meta}>{email}</Text> : <Text style={styles.meta}>Ikke innlogget</Text>}

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Markedsføring (push)</Text>
          <Text style={styles.hint}>Aldri påskrudd automatisk ved billettkjøp</Text>
        </View>
        <Switch value={marketing} onValueChange={toggleMarketing} />
      </View>

      <Link href="/login" asChild>
        <Pressable style={styles.btn}>
          <Text style={styles.btnText}>{email ? "Bytt bruker" : "Logg inn / registrer"}</Text>
        </Pressable>
      </Link>

      <Link href="/staff/scanner" asChild>
        <Pressable style={[styles.btn, styles.secondary]}>
          <Text style={styles.btnText}>Staff / Scanner-modus</Text>
        </Pressable>
      </Link>

      {email ? (
        <Pressable
          style={[styles.btn, styles.danger]}
          onPress={async () => {
            await clearSession();
            setEmail(null);
            router.replace("/(tabs)/account");
          }}
        >
          <Text style={styles.btnText}>Logg ut</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.bg, gap: spacing.md },
  heading: { color: colors.text, fontSize: 24, fontWeight: "700" },
  meta: { color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  label: { color: colors.text, fontWeight: "600" },
  hint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  btn: {
    backgroundColor: colors.accent,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: "center",
  },
  secondary: { backgroundColor: "#3f3f46" },
  danger: { backgroundColor: colors.danger },
  btnText: { color: "#09090b", fontWeight: "700" },
});
