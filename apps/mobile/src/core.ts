import { nativeCore } from "../modules/obryth-core";
import { Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import type { RpcBridge } from "@obryth/contracts";
let opening: Promise<void> | null = null;
export const mobileBridge: RpcBridge = {
  async call<T>(method: string, params: unknown = {}): Promise<T> {
    if (!nativeCore)
      throw new Error(
        "请安装包含 Obryth Rust 模块的 development build。Expo Go 无法运行原生知识核心。",
      );
    if (!opening) {
      opening = nativeCore
        .open(
          decodeURIComponent(Paths.document.uri.replace(/^file:\/\//, "")) +
            "/Obryth",
        )
        .catch((error) => {
          opening = null;
          throw error;
        });
    }
    await opening;
    const p = { ...(params as Record<string, unknown>) };
    if (method === "providers.save" && p.secret) {
      const reference = (p.profile as { secretRef: string }).secretRef;
      await SecureStore.setItemAsync(reference, String(p.secret));
      delete p.secret;
    }
    if (method === "sync.configure" && p.password) {
      await SecureStore.setItemAsync("obryth.sync.webdav", String(p.password));
      delete p.password;
    }
    if (
      [
        "knowledge.ask",
        "knowledge.index",
        "knowledge.semantic",
        "providers.models",
      ].includes(method)
    ) {
      const profiles =
        await mobileBridge.call<{ id: string; secretRef: string }[]>(
          "providers.list",
        );
      const profile = (p.profile ??
        profiles.find((item) => item.id === p.profileId)) as
        { secretRef: string } | undefined;
      if (profile && !p.secret)
        p.secret = await SecureStore.getItemAsync(profile.secretRef);
    }
    if (method === "sync.run" && !p.folder)
      p.password = await SecureStore.getItemAsync(
        String(p.secretRef ?? "obryth.sync.webdav"),
      );
    return JSON.parse(await nativeCore.call(method, JSON.stringify(p))) as T;
  },
};
