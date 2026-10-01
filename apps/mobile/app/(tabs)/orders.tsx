import { View, Text, StyleSheet } from "react-native";
import { colors, spacing } from "@ticketly/ui";

export default function OrdersScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Ordrehistorikk</Text>
      <Text style={styles.meta}>
        Logg inn for å se ordrer. Guest-kjøp knyttes via e-post / deep link fra bekreftelse.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.bg },
  heading: { color: colors.text, fontSize: 24, fontWeight: "700" },
  meta: { color: colors.muted, marginTop: spacing.sm },
});
