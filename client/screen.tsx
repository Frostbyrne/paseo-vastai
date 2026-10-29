import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Loading, ScrollView } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { ConsoleLink, InstanceList, StatusSummary } from "./instances";
import { useNow, useVastStatus } from "./status";

export function VastScreen({ theme, layout }: PluginScreenProps) {
  const { data, isPending } = useVastStatus();
  const now = useNow(15_000);
  if (isPending || !data) return <Loading />;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 16, maxWidth: 720 }}
    >
      <StatusSummary theme={theme} status={data} now={now} />
      <InstanceList theme={theme} instances={data.instances} now={now} detailed />
      <View>
        <ConsoleLink theme={theme} />
      </View>
    </ScrollView>
  );
}
