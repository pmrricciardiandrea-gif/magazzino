const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeBaseUrl, resolveSegretariaConfig } = require("../src/services/segretariaConnectionService");

test("normalizeBaseUrl trims trailing slash", () => {
  assert.equal(normalizeBaseUrl("http://localhost:3001/"), "http://localhost:3001");
  assert.equal(normalizeBaseUrl("  https://api.example.com/// "), "https://api.example.com");
});

test("resolveSegretariaConfig prefers DB connection when active", () => {
  const config = resolveSegretariaConfig({
    dbConnection: {
      segretaria_base_url: "http://localhost:3001/",
      api_key: "db_api",
      hmac_secret: "db_secret",
      is_active: true,
    },
    env: {
      SEGRETARIA_BASE_URL: "http://env:3001",
      SEGRETARIA_API_KEY: "env_api",
      SEGRETARIA_HMAC_SECRET: "env_secret",
    },
  });
  assert.equal(config.source, "db");
  assert.equal(config.segretaria_base_url, "http://localhost:3001");
  assert.equal(config.api_key, "db_api");
  assert.equal(config.hmac_secret, "db_secret");
});

test("resolveSegretariaConfig falls back to env", () => {
  const config = resolveSegretariaConfig({
    dbConnection: null,
    env: {
      SEGRETARIA_BASE_URL: "http://env:3001/",
      SEGRETARIA_API_KEY: "env_api",
      SEGRETARIA_HMAC_SECRET: "env_secret",
    },
  });
  assert.equal(config.source, "env");
  assert.equal(config.segretaria_base_url, "http://env:3001");
  assert.equal(config.api_key, "env_api");
  assert.equal(config.hmac_secret, "env_secret");
});
