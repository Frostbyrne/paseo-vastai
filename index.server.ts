import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getVastStatus, runInstanceAction } from "./server/vast";
import { vastActionRpc, vastStatusRpc } from "./shared/vast";

export default function contribute(server: PluginServerContext) {
  server.handle(vastStatusRpc, getVastStatus);
  server.handle(vastActionRpc, runInstanceAction);
  return () => {};
}
