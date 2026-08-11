import assert from "node:assert/strict";
import test from "node:test";
import { HttpsError } from "firebase-functions/v2/https";
import { redactSensitiveText, requireDashboardOwner, requireGithubCredential } from "../src/github/auth";

const secret = (value: string) => ({ value: () => value });
const expectCode = (action: () => unknown, code: string) => {
  assert.throws(action, (error) => error instanceof HttpsError && error.code === code);
};

test("rejects missing authentication", () => expectCode(() => requireDashboardOwner(undefined, secret("owner")), "unauthenticated"));
test("rejects the wrong authenticated uid", () => expectCode(() => requireDashboardOwner({ uid: "other" }, secret("owner")), "permission-denied"));
test("rejects a non-owner before manual synchronization can mutate the import gate", () => {
  let synchronizationInvoked = false;
  const ownerOnlyManualImport = () => {
    const uid = requireDashboardOwner({ uid: "other" }, secret("owner"));
    synchronizationInvoked = true;
    return uid;
  };
  expectCode(ownerOnlyManualImport, "permission-denied");
  assert.equal(synchronizationInvoked, false);
});
test("accepts the configured owner uid", () => assert.equal(requireDashboardOwner({ uid: "owner" }, secret("owner")), "owner"));
test("reports a missing GitHub credential without naming or exposing it", () => expectCode(() => requireGithubCredential(secret("")), "failed-precondition"));
test("redacts credentials from errors", () => {
  const credential = "github_pat_DO_NOT_EXPOSE";
  const redacted = redactSensitiveText(`Bearer ${credential} failed token=${credential}`, [credential]);
  assert.equal(redacted.includes(credential), false);
});
