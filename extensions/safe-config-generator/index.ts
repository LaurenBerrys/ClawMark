const { readFileSync, writeFileSync, copyFileSync, existsSync } = require("fs");
const { join } = require("path");
const { homedir } = require("os");

module.exports = {
  id: "safe-config-generator",
  name: "Safe Config Generator (Local Only)",

  register(api) {
    const routePath = "/plugins/safe-config-generator";
    
    api.registerHttpRoute({
      path: routePath,
      auth: "plugin",
      match: "prefix",
      handler(req, res) {
        const urlPath = (req.url || "").split("?")[0];
        const subPath = urlPath.slice(routePath.length);

        if (subPath === "/api/read-config") {
          const configPath = join(homedir(), ".openclaw", "openclaw.json");
          try {
            const content = readFileSync(configPath, "utf-8");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, content }));
          } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
          return true;
        }

        if (subPath === "/api/write-config" && req.method === "POST") {
          const chunks = [];
          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString());
              const configPath = join(homedir(), ".openclaw", "openclaw.json");

              // 备份
              if (existsSync(configPath)) {
                const ts = new Date().toISOString().replace(/[:.]/g, "-");
                copyFileSync(configPath, `${configPath}.backup-${ts}`);
              }

              writeFileSync(configPath, body.content, "utf-8");
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return true;
        }

        // 返回 HTML 界面
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Safe Config Generator</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .form-group { margin: 20px 0; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    input, select { width: 100%; padding: 8px; font-size: 14px; }
    button { padding: 10px 20px; font-size: 16px; cursor: pointer; margin: 5px; }
    .success { color: green; }
    .error { color: red; }
    .warning { background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>🔒 Safe Config Generator</h1>
  <div class="warning">
    <strong>安全保证：</strong>此插件完全本地运行，不会发送任何数据到外部服务器。
  </div>

  <div class="form-group">
    <label>Provider Name:</label>
    <input type="text" id="providerName" value="sharesai">
  </div>

  <div class="form-group">
    <label>Base URL:</label>
    <input type="text" id="baseUrl" value="https://api.sharesai.xyz">
  </div>

  <div class="form-group">
    <label>API Key:</label>
    <input type="password" id="apiKey" placeholder="sk-...">
  </div>

  <div class="form-group">
    <label>API Type:</label>
    <select id="apiType">
      <option value="openai-responses">openai-responses</option>
      <option value="openai">openai</option>
    </select>
  </div>

  <div class="form-group">
    <label>Models (逗号分隔):</label>
    <input type="text" id="models" value="gpt-5.2-codex,gpt-5.4">
  </div>

  <div class="form-group">
    <label>Primary Model:</label>
    <input type="text" id="primaryModel" value="gpt-5.2-codex">
  </div>

  <button onclick="generateConfig()">生成并应用配置</button>
  <button onclick="loadCurrentConfig()">加载当前配置</button>
  
  <div id="message"></div>

  <script>
    async function loadCurrentConfig() {
      try {
        const res = await fetch('/plugins/safe-config-generator/api/read-config');
        const data = await res.json();
        if (data.success) {
          const config = JSON.parse(data.content);
          const provider = Object.keys(config.models?.providers || {})[0];
          if (provider && config.models.providers[provider]) {
            const p = config.models.providers[provider];
            document.getElementById('providerName').value = provider;
            document.getElementById('baseUrl').value = p.baseUrl || '';
            document.getElementById('apiKey').value = p.apiKey || '';
            document.getElementById('apiType').value = p.api || 'openai-responses';
            if (p.models) {
              document.getElementById('models').value = p.models.map(m => m.id).join(',');
            }
          }
          if (config.agents?.defaults?.model?.primary) {
            document.getElementById('primaryModel').value = config.agents.defaults.model.primary.split('/')[1] || '';
          }
          showMessage('配置加载成功', 'success');
        }
      } catch (err) {
        showMessage('加载失败: ' + err.message, 'error');
      }
    }

    async function generateConfig() {
      const providerName = document.getElementById('providerName').value;
      const baseUrl = document.getElementById('baseUrl').value;
      const apiKey = document.getElementById('apiKey').value;
      const apiType = document.getElementById('apiType').value;
      const modelsStr = document.getElementById('models').value;
      const primaryModel = document.getElementById('primaryModel').value;

      if (!providerName || !baseUrl || !apiKey) {
        showMessage('请填写所有必填字段', 'error');
        return;
      }

      try {
        // 读取当前配置
        const res = await fetch('/plugins/safe-config-generator/api/read-config');
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const config = JSON.parse(data.content);
        
        // 更新配置
        if (!config.models) config.models = {};
        if (!config.models.providers) config.models.providers = {};
        
        config.models.providers[providerName] = {
          baseUrl: baseUrl,
          apiKey: apiKey,
          api: apiType,
          models: modelsStr.split(',').map(id => ({
            id: id.trim(),
            name: id.trim()
          }))
        };

        // 更新主模型
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.agents.defaults.model) config.agents.defaults.model = {};
        config.agents.defaults.model.primary = providerName + '/' + primaryModel;

        // 写入配置
        const writeRes = await fetch('/plugins/safe-config-generator/api/write-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: JSON.stringify(config, null, 2) })
        });

        const writeData = await writeRes.json();
        if (writeData.success) {
          showMessage('配置已保存！请重启 Gateway: openclaw gateway restart', 'success');
        } else {
          throw new Error(writeData.error);
        }
      } catch (err) {
        showMessage('保存失败: ' + err.message, 'error');
      }
    }

    function showMessage(msg, type) {
      const el = document.getElementById('message');
      el.textContent = msg;
      el.className = type;
    }
  </script>
</body>
</html>
        `);
        return true;
      },
    });

    api.logger.info(`[safe-config-generator] UI available at ${routePath}`);
  },
};
