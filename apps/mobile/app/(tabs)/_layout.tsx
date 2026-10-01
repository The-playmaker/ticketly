import { Tabs } from "expo-router";
import { colors } from "@ticketly/ui";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: "#27272a" },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Events" }} />
      <Tabs.Screen name="tickets" options={{ title: "Billetter" }} />
      <Tabs.Screen name="orders" options={{ title: "Ordrer" }} />
      <Tabs.Screen name="account" options={{ title: "Konto" }} />
    </Tabs>
  );
}
