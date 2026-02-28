const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSignature } = require("../src/services/hmac");

test("buildSignature deterministic", () => {
  const signatureA = buildSignature("secret", "1730000000", "abc", '{"x":1}');
  const signatureB = buildSignature("secret", "1730000000", "abc", '{"x":1}');
  assert.equal(signatureA, signatureB);
  assert.equal(signatureA.length, 64);
});

test("buildSignature changes with body", () => {
  const signatureA = buildSignature("secret", "1730000000", "abc", '{"x":1}');
  const signatureB = buildSignature("secret", "1730000000", "abc", '{"x":2}');
  assert.notEqual(signatureA, signatureB);
});
