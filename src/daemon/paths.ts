import {
  resolveHomeDirFromEnv,
  resolveInstanceManifest,
  resolvePathWithHome,
} from "../instance/paths.js";

export function resolveHomeDir(env: Record<string, string | undefined>): string {
  const home = resolveHomeDirFromEnv(env);
  if (!home) {
    throw new Error("Missing HOME");
  }
  return home;
}

export function resolveUserPathWithHome(input: string, home?: string): string {
  return resolvePathWithHome(input, { homeDir: home });
}

export function resolveGatewayStateDir(env: Record<string, string | undefined>): string {
  const override = env.OPENCLAW_STATE_ROOT?.trim() || env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    const home = override.startsWith("~") ? resolveHomeDir(env) : undefined;
    return resolveUserPathWithHome(override, home);
  }
  return resolveInstanceManifest({
    env,
    profileAwareStateDir: true,
  }).stateRoot;
}
