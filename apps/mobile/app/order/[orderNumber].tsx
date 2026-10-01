import { View, Text } from "react-native";
import { colors } from "@ticketly/ui";

export default function OrderScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
      <Text style={{ color: colors.text }}>Ordredetaljer / deep link target</Text>
    </View>
  );
}
