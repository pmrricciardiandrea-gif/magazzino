const crypto = require("crypto");

function buildSignature(secret, timestamp, nonce, rawBody) {
  const payload = `${timestamp}.${nonce}.${rawBody}`;
  return crypto.createHmac("sha256", String(secret || "")).update(payload, "utf8").digest("hex");
}

function randomNonce() {
  return crypto.randomBytes(16).toString("hex");
}

module.exports = {
  buildSignature,
  randomNonce,
};
