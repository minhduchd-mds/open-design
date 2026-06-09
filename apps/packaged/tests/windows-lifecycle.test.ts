import { describe, expect, it } from "vitest";

import {
  syncWindowsUninstallDisplayVersion,
  windowsUninstallDisplayVersionRegistryArgs,
} from "../src/windows-lifecycle.js";

describe("Windows packaged lifecycle", () => {
  it("builds the namespace-scoped uninstall DisplayVersion registry update", () => {
    expect(windowsUninstallDisplayVersionRegistryArgs({
      namespace: "release-beta-win",
      version: "1.2.3-beta.4",
    })).toEqual([
      "add",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Open Design-release-beta-win",
      "/v",
      "DisplayVersion",
      "/t",
      "REG_SZ",
      "/d",
      "1.2.3-beta.4",
      "/f",
    ]);
  });

  it("syncs DisplayVersion on Windows without touching other platforms", async () => {
    const calls: Array<{ args: string[]; command: string }> = [];
    const exec = async (command: string, args: string[]) => {
      calls.push({ args, command });
    };

    await expect(syncWindowsUninstallDisplayVersion({
      exec,
      namespace: "release-beta-win",
      platform: "linux",
      version: "1.2.3-beta.4",
    })).resolves.toBe(false);
    await expect(syncWindowsUninstallDisplayVersion({
      exec,
      namespace: "release-beta-win",
      platform: "win32",
      version: "",
    })).resolves.toBe(false);
    await expect(syncWindowsUninstallDisplayVersion({
      exec,
      namespace: "release-beta-win",
      platform: "win32",
      version: "1.2.3-beta.4",
    })).resolves.toBe(true);

    expect(calls).toEqual([{
      args: windowsUninstallDisplayVersionRegistryArgs({
        namespace: "release-beta-win",
        version: "1.2.3-beta.4",
      }),
      command: "reg.exe",
    }]);
  });
});
