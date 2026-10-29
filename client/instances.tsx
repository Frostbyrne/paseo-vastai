import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, ExternalLink, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { InstanceAction, VastInstance, VastStatus } from "../shared/vast";
import {
  duration,
  gpuText,
  instanceName,
  money,
  rate,
  runwayColor,
  runwayText,
  sshCommand,
  stateColor,
  stateText,
  summarize,
  useInstanceAction,
  useRefreshVast,
} from "./status";

const CONSOLE_URL = "https://cloud.vast.ai/instances/";
const CONFIRM_MS = 5000;

const ACTION_TEXT: Record<InstanceAction, { verb: string; confirm: string; pending: string }> = {
  stop: { verb: "Stop", confirm: "Confirm stop", pending: "Stopping…" },
  destroy: { verb: "Destroy", confirm: "Confirm destroy", pending: "Destroying…" },
};

function useStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      column: { gap: 10 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      spread: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 8 },
      card: {
        gap: 4,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      dot: { width: 8, height: 8, borderRadius: 4 },
      name: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const, flexShrink: 1 },
      price: { color: theme.colors.foreground, fontSize: 13, fontVariant: ["tabular-nums" as const] },
      text: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      danger: { color: theme.colors.statusDanger, fontSize: 12 },
      link: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13, paddingVertical: 8 },
    }),
    [theme],
  );
}

export function StatusSummary({ theme, status, now }: { theme: PluginTheme; status: VastStatus; now: number }) {
  const styles = useStyles(theme);
  const summary = summarize(status);
  const refresh = useRefreshVast();
  const updated = status.fetchedAt ? duration((now - Date.parse(status.fetchedAt)) / 1000) : null;
  return (
    <View style={styles.column}>
      <View style={styles.spread}>
        <Text style={styles.text}>
          {summary.active} active · {summary.stopped} stopped · {rate(summary.burnPerHour)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Vast instances"
          disabled={refresh.isPending}
          onPress={() => refresh.mutate()}
        >
          <Text style={styles.link}>{refresh.isPending ? "Refreshing…" : "Refresh"}</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        {status.credit != null ? <Text style={styles.muted}>{money(status.credit)} credit</Text> : null}
        {summary.runwayHours != null ? (
          <Text style={{ ...styles.muted, color: runwayColor(summary.runwayHours, theme) }}>
            {runwayText(summary.runwayHours)}
          </Text>
        ) : null}
        {updated ? <Text style={styles.muted}>updated {updated} ago</Text> : null}
      </View>
      {status.error ? <Text style={styles.danger}>{status.error}</Text> : null}
    </View>
  );
}

function InstanceCard({
  theme,
  instance,
  now,
  detailed,
}: {
  theme: PluginTheme;
  instance: VastInstance;
  now: number;
  detailed: boolean;
}) {
  const styles = useStyles(theme);
  const toast = useToast();
  const ssh = sshCommand(instance);
  const where = [gpuText(instance), instance.location].filter(Boolean).join(" · ");
  const showMessage = instance.statusMsg && (detailed || instance.state === "starting" || instance.state === "exited");
  const extra = [
    instance.image,
    instance.diskGb != null ? `${Math.round(instance.diskGb)} GB disk` : null,
    `id ${instance.id}`,
    instance.machineId != null ? `machine ${instance.machineId}` : null,
    instance.state === "stopped" ? `${rate(instance.runningCostPerHour)} when running` : null,
  ].filter(Boolean);

  const copySsh = () => {
    if (!ssh) return;
    copyText(ssh).then(
      () => toast.show(`Copied: ${ssh}`),
      () => toast.error("Could not copy to the clipboard"),
    );
  };

  // First press arms the action; a second press within CONFIRM_MS runs it.
  const [armed, setArmed] = useState<InstanceAction | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const instanceAction = useInstanceAction();
  const pendingAction = instanceAction.isPending ? instanceAction.variables?.action : null;
  const run = (action: InstanceAction) => {
    setArmed(null);
    instanceAction.mutate(
      { id: instance.id, action },
      {
        onSuccess: ({ error, status }) => {
          if (error) return toast.error(error);
          // When Vast already reports the new state, the sidebar's change toast covers it.
          const after = status.instances.find((candidate) => candidate.id === instance.id);
          const settled = action === "destroy" ? !after : after?.state === "stopped";
          if (!settled) toast.show(`Vast: ${action} requested for ${instanceName(instance)}`);
        },
        onError: (error) => toast.error(`Vast ${action} failed: ${error.message}`),
      },
    );
  };
  const actions: InstanceAction[] = instance.state === "stopped" ? ["destroy"] : ["stop", "destroy"];

  return (
    <View style={styles.card}>
      <View style={styles.spread}>
        <View style={{ ...styles.row, flexShrink: 1 }}>
          <View style={{ ...styles.dot, backgroundColor: stateColor(instance.state, theme) }} />
          <Text style={styles.name} numberOfLines={1}>
            {instanceName(instance)}
          </Text>
        </View>
        <Text style={styles.price}>{rate(instance.costPerHour)}</Text>
      </View>
      <Text style={styles.muted} numberOfLines={1}>
        {where}
      </Text>
      <Text style={{ ...styles.muted, color: stateColor(instance.state, theme) }}>{stateText(instance, now)}</Text>
      <View style={{ ...styles.spread, paddingTop: 2 }}>
        {ssh && instance.state !== "stopped" ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Copy SSH command for ${instanceName(instance)}`} onPress={copySsh}>
            <Text style={styles.link}>Copy SSH</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <View style={{ ...styles.row, gap: 14 }}>
          {pendingAction ? (
            <Text style={styles.muted}>{ACTION_TEXT[pendingAction].pending}</Text>
          ) : armed ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${ACTION_TEXT[armed].confirm} ${instanceName(instance)}`}
                onPress={() => run(armed)}
              >
                <Text style={{ ...styles.link, color: theme.colors.statusDanger }}>{ACTION_TEXT[armed].confirm}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={() => setArmed(null)}>
                <Text style={{ ...styles.link, color: theme.colors.foregroundMuted }}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            actions.map((action) => (
              <Pressable
                key={action}
                accessibilityRole="button"
                accessibilityLabel={`${ACTION_TEXT[action].verb} ${instanceName(instance)}`}
                onPress={() => setArmed(action)}
              >
                <Text
                  style={{
                    ...styles.link,
                    color: action === "destroy" ? theme.colors.statusDanger : theme.colors.statusWarning,
                  }}
                >
                  {ACTION_TEXT[action].verb}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </View>
      {showMessage ? (
        <Text style={styles.muted} numberOfLines={detailed ? 4 : 1}>
          {instance.statusMsg}
        </Text>
      ) : null}
      {detailed ? (
        <>
          <Text style={styles.muted}>{extra.join(" · ")}</Text>
          {ssh ? (
            <Text style={styles.muted} selectable>
              {ssh}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export function InstanceList({
  theme,
  instances,
  now,
  detailed = false,
}: {
  theme: PluginTheme;
  instances: VastInstance[];
  now: number;
  detailed?: boolean;
}) {
  const styles = useStyles(theme);
  if (instances.length === 0) return <Text style={styles.empty}>No Vast instances.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {instances.map((instance) => (
        <InstanceCard key={instance.id} theme={theme} instance={instance} now={now} detailed={detailed} />
      ))}
    </View>
  );
}

export function ConsoleLink({ theme }: { theme: PluginTheme }) {
  const styles = useStyles(theme);
  return (
    <ExternalLink href={CONSOLE_URL} accessibilityLabel="Open the Vast.ai console">
      <Text style={styles.link}>Vast console</Text>
    </ExternalLink>
  );
}
