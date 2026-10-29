import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  type InstanceAction,
  type InstanceState,
  type VastInstance,
  type VastStatus,
  vastActionRpc,
  vastStatusRpc,
} from "../shared/vast";

const STATUS_KEY = ["vast-status"] as const;
const POLL_MS = 30_000;

export function useVastStatus() {
  const fetchStatus = useRpc(vastStatusRpc);
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => fetchStatus({}),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    retry: 1,
  });
}

/** Bypasses the daemon's short cache. */
export function useRefreshVast() {
  const fetchStatus = useRpc(vastStatusRpc);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchStatus({ refresh: true }),
    onSuccess: (status) => queryClient.setQueryData(STATUS_KEY, status),
  });
}

export function useInstanceAction() {
  const runAction = useRpc(vastActionRpc);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; action: InstanceAction }) => runAction(input),
    onSuccess: async (result) => {
      // A poll that started before the action would overwrite this with the old state.
      await queryClient.cancelQueries({ queryKey: STATUS_KEY });
      queryClient.setQueryData(STATUS_KEY, result.status);
    },
  });
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Instances that bill GPU time or are trying to. */
export const isActive = (instance: VastInstance) => instance.state !== "stopped";

export interface Summary {
  active: number;
  stopped: number;
  burnPerHour: number;
  /** Hours of credit left at the current burn; null when nothing bills or credit is unknown. */
  runwayHours: number | null;
}

export function summarize(status: VastStatus): Summary {
  const active = status.instances.filter(isActive).length;
  const burnPerHour = status.instances.reduce((sum, instance) => sum + instance.costPerHour, 0);
  return {
    active,
    stopped: status.instances.length - active,
    burnPerHour,
    runwayHours: status.credit != null && burnPerHour > 0 ? status.credit / burnPerHour : null,
  };
}

export function stateColor(state: InstanceState, theme: PluginTheme): string {
  switch (state) {
    case "running":
      return theme.colors.statusSuccess;
    case "starting":
      return theme.colors.statusWarning;
    case "exited":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

export function runwayColor(hours: number | null, theme: PluginTheme): string {
  if (hours == null) return theme.colors.foregroundMuted;
  if (hours < 2) return theme.colors.statusDanger;
  if (hours < 12) return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

export const instanceName = (instance: VastInstance) => instance.label ?? `#${instance.id}`;

export function gpuText(instance: VastInstance): string {
  const gpu = instance.gpuName ?? "GPU";
  return instance.numGpus && instance.numGpus > 1 ? `${instance.numGpus}× ${gpu}` : gpu;
}

export function money(usd: number): string {
  if (usd === 0) return "$0";
  return `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;
}

export const rate = (usdPerHour: number) => `${money(usdPerHour)}/h`;

export function duration(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function runwayText(hours: number): string {
  return hours >= 48 ? `~${Math.floor(hours / 24)}d left` : `~${Math.max(0, Math.floor(hours))}h left`;
}

export function stateText(instance: VastInstance, now: number): string {
  const age = instance.startedAt ? ` ${duration(now / 1000 - instance.startedAt)}` : "";
  switch (instance.state) {
    case "running":
      return `running${age}`;
    case "starting":
      return instance.actualStatus ?? "starting";
    case "exited":
      return `${instance.actualStatus ?? "exited"}, wants to run`;
    case "stopped":
      return "stopped";
    default:
      return instance.actualStatus ?? "unknown";
  }
}

export const sshCommand = (instance: VastInstance) =>
  instance.ssh ? `ssh -p ${instance.ssh.port} root@${instance.ssh.host}` : null;

export interface Change {
  message: string;
  variant: "info" | "warning" | "default";
}

/** What changed between two successful fetches, for toasts. */
export function diffInstances(previous: VastInstance[], next: VastInstance[]): Change[] {
  const before = new Map(previous.map((instance) => [instance.id, instance]));
  const after = new Set(next.map((instance) => instance.id));
  const changes: Change[] = [];
  for (const instance of next) {
    const old = before.get(instance.id);
    const name = instanceName(instance);
    if (!old) {
      changes.push({
        message: `Vast: ${name} created (${gpuText(instance)}, ${rate(instance.runningCostPerHour)})`,
        variant: "info",
      });
    } else if (old.state !== instance.state && instance.state !== "unknown") {
      changes.push({
        message: `Vast: ${name} is ${instance.state}`,
        variant: instance.state === "exited" ? "warning" : "default",
      });
    }
  }
  for (const old of previous) {
    if (!after.has(old.id)) changes.push({ message: `Vast: ${instanceName(old)} destroyed`, variant: "default" });
  }
  return changes;
}
