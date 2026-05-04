import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const prodConfig = new (class extends DefaultServerConfig {
  numWorkers(): number {
    // In the browser, read from the server-injected BOOTSTRAP_CONFIG so client
    // and server always agree on the worker count.
    if (typeof window !== "undefined") {
      const n = window.BOOTSTRAP_CONFIG?.numWorkers;
      return typeof n === "number" && n >= 1 ? n : 20;
    }
    const n = parseInt(process.env.NUM_WORKERS ?? "20", 10);
    return Number.isFinite(n) && n >= 1 ? n : 20;
  }
  env(): GameEnv {
    return GameEnv.Prod;
  }
  jwtAudience(): string {
    return "openfront.io";
  }
  turnstileSiteKey(): string {
    return "0x4AAAAAACFLkaecN39lS8sk";
  }
})();
