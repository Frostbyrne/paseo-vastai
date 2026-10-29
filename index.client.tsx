import type { PluginClientContext } from "@getpaseo/plugin/client";
import { VastScreen } from "./client/screen";
import { SCREEN_ID, VastSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN_ID, title: "Vast.ai instances", Component: VastScreen });
  client.addSidebarFooterItem({ id: "status", title: "Vast.ai", Component: VastSidebarItem });
  return () => {};
}
