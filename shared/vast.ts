import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * running: Vast reports the container up.
 * starting: wants to run, not up yet (scheduling, pulling the image, booting).
 * exited: wants to run, but the container stopped or the host went offline.
 * stopped: stopped on purpose; only storage bills.
 */
export const instanceStateSchema = z.enum(["running", "starting", "exited", "stopped", "unknown"]);

export const vastInstanceSchema = z.object({
  id: z.number(),
  label: z.string().nullable(),
  state: instanceStateSchema,
  actualStatus: z.string().nullable(),
  intendedStatus: z.string().nullable(),
  statusMsg: z.string().nullable(),
  gpuName: z.string().nullable(),
  numGpus: z.number().nullable(),
  /** What Vast bills for this instance right now, in USD per hour. */
  costPerHour: z.number(),
  /** What it bills while running, in USD per hour. */
  runningCostPerHour: z.number(),
  /** Unix seconds. */
  startedAt: z.number().nullable(),
  location: z.string().nullable(),
  image: z.string().nullable(),
  diskGb: z.number().nullable(),
  machineId: z.number().nullable(),
  ssh: z.object({ host: z.string(), port: z.number() }).nullable(),
});

export const vastStatusSchema = z.object({
  /** ISO time of the last successful fetch; null until one succeeds. */
  fetchedAt: z.string().nullable(),
  /** Prepaid credit in USD. */
  credit: z.number().nullable(),
  /** The last successful fetch's instances; still shown when `error` is set. */
  instances: z.array(vastInstanceSchema),
  error: z.string().nullable(),
});

export type InstanceState = z.infer<typeof instanceStateSchema>;
export type VastInstance = z.infer<typeof vastInstanceSchema>;
export type VastStatus = z.infer<typeof vastStatusSchema>;

export const vastStatusRpc = defineRpc({
  name: "vast.status",
  input: z.object({ refresh: z.boolean().optional() }),
  output: vastStatusSchema,
});

export const instanceActionSchema = z.enum(["stop", "destroy"]);
export type InstanceAction = z.infer<typeof instanceActionSchema>;

export const vastActionRpc = defineRpc({
  name: "vast.action",
  input: z.object({ id: z.number().int().positive(), action: instanceActionSchema }),
  /** `status` is refetched after the action, whether or not it succeeded. */
  output: z.object({ error: z.string().nullable(), status: vastStatusSchema }),
});
