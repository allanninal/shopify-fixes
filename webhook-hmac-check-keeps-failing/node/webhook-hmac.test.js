import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { computeHmac, verifyHmac, misconfiguredSubscriptions } from "./verify-webhook-hmac.js";

const SECRET = "shpss_test_secret";

function sign(rawBody, secret = SECRET) {
  return crypto.createHmac("sha256", secret).update(Buffer.from(rawBody, "utf8")).digest("base64");
}

test("computeHmac matches a manually signed digest", () => {
  const rawBody = '{"id":1,"note":null}';
  assert.equal(computeHmac(rawBody, SECRET), sign(rawBody));
});

test("verifyHmac is true for the correct raw body", () => {
  const rawBody = '{"id":1,"note":null}';
  const header = sign(rawBody);
  assert.equal(verifyHmac(rawBody, header, SECRET), true);
});

test("verifyHmac is false when the body was re-serialized", () => {
  // Simulates the real bug: the handler parsed the JSON, then re-stringified it
  // with different key order and spacing before checking the signature.
  const rawBody = '{"id":1,"note":null}';
  const header = sign(rawBody);
  const reserializedBody = '{"note": null, "id": 1}';
  assert.equal(verifyHmac(reserializedBody, header, SECRET), false);
});

test("verifyHmac is false with the wrong secret", () => {
  const rawBody = '{"id":1}';
  const header = sign(rawBody, "wrong_secret");
  assert.equal(verifyHmac(rawBody, header, SECRET), false);
});

test("verifyHmac is false with a missing header", () => {
  assert.equal(verifyHmac('{"id":1}', "", SECRET), false);
  assert.equal(verifyHmac('{"id":1}', undefined, SECRET), false);
});

test("verifyHmac works with a Buffer body", () => {
  const rawBody = Buffer.from('{"id":1,"amount":"9.99"}', "utf8");
  const header = sign(rawBody.toString("utf8"));
  assert.equal(verifyHmac(rawBody, header, SECRET), true);
});

test("misconfiguredSubscriptions flags non-JSON formats", () => {
  const subs = [
    { id: "1", topic: "ORDERS_PAID", uri: "https://a", format: "JSON" },
    { id: "2", topic: "ORDERS_UPDATED", uri: "https://b", format: "XML" },
  ];
  const result = misconfiguredSubscriptions(subs);
  assert.equal(result.length, 1);
  assert.equal(result[0].topic, "ORDERS_UPDATED");
});

test("misconfiguredSubscriptions is empty when all are JSON", () => {
  const subs = [{ id: "1", topic: "ORDERS_PAID", uri: "https://a", format: "JSON" }];
  assert.deepEqual(misconfiguredSubscriptions(subs), []);
});
