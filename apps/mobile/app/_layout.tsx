import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "@ticketly/ui";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: "Logg inn" }} />
        <Stack.Screen name="event/[slug]" options={{ title: "Arrangement" }} />
        <Stack.Screen name="order/[orderNumber]" options={{ title: "Ordre" }} />
        <Stack.Screen name="staff/scanner" options={{ title: "Scanner", headerShown: false }} />
      </Stack>
    </>
  );
}
