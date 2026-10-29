import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Loading, ScrollView, SidebarRow, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import type { VastInstance } from "../shared/vast";
import { ConsoleLink, InstanceList, StatusSummary } from "./instances";
import { diffInstances, isActive, rate, summarize, useNow, useVastStatus } from "./status";

export const SCREEN_ID = "instances";

/** Toasts when instances appear, change state, or go away, so agent rentals do not go unnoticed. */
function useChangeToasts(instances: VastInstance[] | undefined, fetchedAt: string | null | undefined) {
  const toast = useToast();
  const previous = useRef<{ fetchedAt: string; instances: VastInstance[] } | null>(null);
  useEffect(() => {
    if (!instances || !fetchedAt || previous.current?.fetchedAt === fetchedAt) return;
    if (previous.current) {
      for (const change of diffInstances(previous.current.instances, instances)) {
        toast.show(change.message, { variant: change.variant, durationMs: 8000 });
      }
    }
    previous.current = { fetchedAt, instances };
  }, [instances, fetchedAt, toast]);
}

export function VastPopover({ theme, layout, openScreen, close }: PluginPopoverProps) {
  const { data, isPending } = useVastStatus();
  const now = useNow(15_000);
  return (
    <View style={{ padding: 12, gap: 12, minWidth: layout.compact ? undefined : 340, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "600" }}>Vast.ai</Text>
      {isPending || !data ? (
        <View style={{ height: 80 }}>
          <Loading />
        </View>
      ) : (
        <>
          <StatusSummary theme={theme} status={data} now={now} />
          <ScrollView style={{ maxHeight: 360 }}>
            <InstanceList theme={theme} instances={data.instances} now={now} />
          </ScrollView>
        </>
      )}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Vast instance details"
          onPress={() => {
            close();
            openScreen({ screenId: SCREEN_ID });
          }}
        >
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>Details</Text>
        </Pressable>
        <ConsoleLink theme={theme} />
      </View>
    </View>
  );
}

export function VastSidebarItem({ theme, currentScreen, openPopover }: PluginSidebarItemProps) {
  const { data, error } = useVastStatus();
  useChangeToasts(data?.error ? undefined : data?.instances, data?.fetchedAt);

  let label = "Vast: …";
  let dot: string | null = null;
  let trailing: string | null = null;
  if (data) {
    const summary = summarize(data);
    const states = new Set(data.instances.filter(isActive).map((instance) => instance.state));
    if (summary.active > 0) {
      label = `Vast: ${summary.active} active`;
      dot = states.has("exited")
        ? theme.colors.statusDanger
        : states.has("starting")
          ? theme.colors.statusWarning
          : theme.colors.statusSuccess;
    } else if (summary.stopped > 0) {
      label = `Vast: ${summary.stopped} stopped`;
      dot = theme.colors.foregroundMuted;
    } else {
      label = "Vast: idle";
    }
    if (summary.burnPerHour > 0) trailing = rate(summary.burnPerHour);
    if (data.error) dot = theme.colors.statusDanger;
  } else if (error) {
    label = "Vast: error";
    dot = theme.colors.statusDanger;
  }

  return (
    <SidebarRow
      icon="Server"
      label={label}
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openPopover(VastPopover)}
      trailing={
        dot || trailing ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 4 }}>
            {trailing ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"] }}>
                {trailing}
              </Text>
            ) : null}
            {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
          </View>
        ) : undefined
      }
    />
  );
}
