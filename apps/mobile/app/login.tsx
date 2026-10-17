import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { colors, spacing } from "@ticketly/ui";
import { apiFetch } from "@/lib/api";
import { saveSession } from "@/lib/secure-store";

const showDemoCredentials =
  typeof __DEV__ !== "undefined" &&
  __DEV__ &&
  process.env.EXPO_PUBLIC_SHOW_DEMO_CREDENTIALS === "true";

export default function LoginScreen() {
  const [email, setEmail] = useState(showDemoCredentials ? "customer@example.com" : "");
  const [password, setPassword] = useState(showDemoCredentials ? "password123" : "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{
        token: string;
        user: { id: string; email: string; name?: string };
      }>("/api/mobile/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await saveSession(data.token, data.user);
      router.replace("/(tabs)/tickets");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Innlogging feilet");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Logg inn</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder="E-post"
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder="Passord"
        placeholderTextColor={colors.muted}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.btn} onPress={onLogin} disabled={loading}>
        <Text style={styles.btnText}>{loading ? "…" : "Logg inn"}</Text>
      </Pressable>
      <Text style={styles.hint}>Guest checkout støttes i kjøpsflyten uten konto.</Text>
      {showDemoCredentials ? (
        <Text style={styles.hint}>Dev demo: customer@example.com / password123</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg, gap: spacing.md },
  heading: { color: colors.text, fontSize: 28, fontWeight: "800" },
  input: {
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  btn: { backgroundColor: colors.accent, padding: spacing.md, borderRadius: 12, alignItems: "center" },
  btnText: { fontWeight: "700", color: "#09090b" },
  error: { color: colors.danger },
  hint: { color: colors.muted, fontSize: 12 },
});
