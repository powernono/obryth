import { requireOptionalNativeModule } from "expo-modules-core";
type Module = {
  open(path: string): Promise<void>;
  call(method: string, params: string): Promise<string>;
};
export const nativeCore = requireOptionalNativeModule<Module>("ObrythCore");
