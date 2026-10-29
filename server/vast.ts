/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { InstanceState, VastInstance, VastStatus, vastActionRpc, vastStatusRpc } from "../shared/vast";

const API = "https://console.vast.ai";
const REQUEST_TIMEOUT_MS = 15_000;
// Every open surface polls; this keeps several windows and hosts to one Vast call.
const CACHE_MS = 10_000;
const PAGE_SIZE = 25;
const MAX_PAGES = 20;

type RawRow = Record<string, unknown>;

class VastError extends Error {}

// Re-read on every fetch so `vastai set api-key` rotations apply without a reload.
async function loadApiKey(): Promise<string | null> {
  const fromEnv = process.env.VAST_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  for (const path of [join(configHome, "vastai", "vast_api_key"), join(homedir(), ".vast_api_key")]) {
    try {
      const key = (await readFile(path, "utf8")).trim();
      if (key) return key;
    } catch {
      // Try the next location.
    }
  }
  return null;
}

async function vastRequest(
  key: string,
  method: "GET" | "PUT" | "DELETE",
  path: string,
  { query = {}, body }: { query?: Record<string, unknown>; body?: unknown } = {},
): Promise<RawRow> {
  const params = Object.entries(query)
    .map(([name, value]) => `${name}=${encodeURIComponent(typeof value === "string" ? value : JSON.stringify(value))}`)
    .join("&");
  const url = `${API}${path}${params ? `?${params}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // react-native's global AbortSignal type shadows Node's here; the runtime value is Node's.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) as RequestInit["signal"],
    });
  } catch (error) {
    throw new VastError(`Could not reach Vast: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = (await response.json().catch(() => ({}))) as RawRow;
  // Vast answers a bad key with 404 and error "auth_error", not 401.
  if (parsed.error === "auth_error" || response.status === 401 || response.status === 403) {
    throw new VastError(`Vast rejected the API key (HTTP ${response.status})`);
  }
  if (!response.ok || parsed.success === false) {
    const detail = str(parsed.msg) ?? str(parsed.error) ?? `HTTP ${response.status} for ${method} ${path}`;
    throw new VastError(`Vast: ${detail}`);
  }
  return parsed;
}

async function listInstances(key: string): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  const query: Record<string, unknown> = { order_by: [{ col: "id", dir: "asc" }], limit: PAGE_SIZE };
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await vastRequest(key, "GET", "/api/v1/instances/", { query });
    if (Array.isArray(body.instances)) rows.push(...(body.instances as RawRow[]));
    if (typeof body.next_token !== "string" || !body.next_token) return rows;
    query.after_token = body.next_token;
  }
  return rows;
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const hourly = (value: unknown) => num((value as RawRow | null | undefined)?.totalHour);

function classify(row: RawRow): InstanceState {
  const actual = str(row.actual_status);
  const intended = str(row.intended_status);
  if (actual === "running") return "running";
  if (intended === "stopped" || str(row.cur_state) === "stopped") return "stopped";
  if (actual === "exited" || actual === "offline") return "exited";
  if (intended === "running") return "starting";
  return "unknown";
}

function toInstance(row: RawRow): VastInstance {
  const sshHost = str(row.ssh_host);
  const sshPort = num(row.ssh_port);
  return {
    id: num(row.id) ?? 0,
    label: str(row.label),
    state: classify(row),
    actualStatus: str(row.actual_status),
    intendedStatus: str(row.intended_status),
    statusMsg: str(row.status_msg),
    gpuName: str(row.gpu_name),
    numGpus: num(row.num_gpus),
    // `instance` is the live charge (storage only while stopped or loading); `search` is the rental price.
    costPerHour: hourly(row.instance) ?? 0,
    runningCostPerHour: hourly(row.search) ?? num(row.dph_total) ?? 0,
    startedAt: num(row.start_date),
    location: str(row.geolocation),
    image: str(row.image_uuid),
    diskGb: num(row.disk_space),
    machineId: num(row.machine_id),
    ssh: sshHost && sshPort ? { host: sshHost, port: sshPort } : null,
  };
}

async function loadCredit(key: string): Promise<number | null> {
  try {
    return num((await vastRequest(key, "GET", "/api/v0/users/current/")).credit);
  } catch (error) {
    console.error("[vastai] credit lookup failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

let lastGood: VastStatus | null = null;
let cached: { at: number; status: VastStatus } | null = null;
let inflight: Promise<VastStatus> | null = null;
let generation = 0;

const errorMessage = (error: unknown) =>
  error instanceof VastError ? error.message : `Unexpected error: ${String(error)}`;

async function requireApiKey(): Promise<string> {
  const key = await loadApiKey();
  if (!key) throw new VastError("No Vast API key. Run `vastai set api-key` or set VAST_API_KEY for the daemon.");
  return key;
}

async function load(): Promise<VastStatus> {
  try {
    const key = await requireApiKey();
    const [rows, credit] = await Promise.all([listInstances(key), loadCredit(key)]);
    lastGood = {
      fetchedAt: new Date().toISOString(),
      credit,
      instances: rows.map(toInstance),
      error: null,
    };
    return lastGood;
  } catch (error) {
    const message = errorMessage(error);
    console.error("[vastai]", message);
    return { fetchedAt: null, credit: null, instances: [], ...lastGood, error: message };
  }
}

export async function getVastStatus({ refresh }: RpcInput<typeof vastStatusRpc>): Promise<VastStatus> {
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.status;
  // A refresh never joins an in-flight poll, which may have started before an action.
  if (!refresh && inflight) return inflight;
  const mine = ++generation;
  const run = load()
    .then((status) => {
      if (mine === generation) cached = { at: Date.now(), status };
      return status;
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

export async function runInstanceAction({
  id,
  action,
}: RpcInput<typeof vastActionRpc>): Promise<RpcOutput<typeof vastActionRpc>> {
  let error: string | null = null;
  try {
    const key = await requireApiKey();
    if (action === "stop") {
      await vastRequest(key, "PUT", `/api/v0/instances/${id}/`, { body: { state: "stopped" } });
    } else {
      await vastRequest(key, "DELETE", `/api/v0/instances/${id}/`, { body: {} });
    }
    console.log(`[vastai] ${action} instance ${id}: accepted`);
  } catch (caught) {
    error = errorMessage(caught);
    console.error(`[vastai] ${action} instance ${id}:`, error);
  }
  return { error, status: await getVastStatus({ refresh: true }) };
}
