#!/usr/bin/env node

const fs = require("fs");
const { resolveControlExtensionPaths } = require("../lib/instance-paths.js");

const pluginId = "openclaw-codex-control";
const instancePaths = resolveControlExtensionPaths({ pluginId });
const configPath = instancePaths.configPath;
const controlUiIndexPath = instancePaths.controlUiIndexPath;
const marker =
  '<script src="/plugins/openclaw-codex-control/inject.js" data-openclaw-codex-control></script>';

function ensurePluginEnabled() {
  const raw = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(raw);
  config.plugins = config.plugins && typeof config.plugins === "object" ? config.plugins : {};
  config.plugins.allow = Array.isArray(config.plugins.allow) ? config.plugins.allow : [];
  if (!config.plugins.allow.includes(pluginId)) config.plugins.allow.push(pluginId);
  config.plugins.entries =
    config.plugins.entries && typeof config.plugins.entries === "object"
      ? config.plugins.entries
      : {};
  config.plugins.entries[pluginId] = {
    ...(config.plugins.entries[pluginId] && typeof config.plugins.entries[pluginId] === "object"
      ? config.plugins.entries[pluginId]
      : {}),
    enabled: true,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function ensureControlUiInjection() {
  const raw = fs.readFileSync(controlUiIndexPath, "utf8");
  if (raw.includes(marker)) return;
  const injected = raw.replace("</head>", `  ${marker}\n</head>`);
  if (injected === raw) throw new Error("Failed to patch Control UI index.html");
  fs.writeFileSync(controlUiIndexPath, injected, "utf8");
}

ensurePluginEnabled();
ensureControlUiInjection();
process.stdout.write("Applied OpenClaw Codex Control patch.\n");
