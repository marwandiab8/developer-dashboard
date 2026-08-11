import assert from "node:assert/strict";
import test from "node:test";
import {
  SAFE_FIREBASE_CONFIG_PATHS,
  detectFirebaseAssociations,
  isSafeFirebaseConfigPath,
} from "../src/github/firebaseDetection";

test("detects project IDs only from safe allowlisted configuration evidence", () => {
  const result = detectFirebaseAssociations([
    { path: ".firebaserc", content: JSON.stringify({ projects: { default: "safe-project-123" } }) },
    { path: ".env.example", content: "NEXT_PUBLIC_FIREBASE_PROJECT_ID=second-project-456\nAPI_SECRET=ignored" },
  ]);
  assert.deepEqual(result.projectIds, ["safe-project-123", "second-project-456"]);
  assert.equal(result.evidence.every((item) => item.status === "detected"), true);
});

test("never permits secret environment or credential files", () => {
  assert.deepEqual(SAFE_FIREBASE_CONFIG_PATHS, [
    ".firebaserc",
    "firebase.json",
    "apphosting.yaml",
    "apphosting.yml",
    ".env.example",
    ".env.sample",
  ]);
  assert.equal(isSafeFirebaseConfigPath(".env.local"), false);
  assert.equal(isSafeFirebaseConfigPath("service-account.json"), false);
  assert.equal(isSafeFirebaseConfigPath("config/private-key.json"), false);
  assert.equal(isSafeFirebaseConfigPath("src/firebase.json"), false);
  assert.equal(isSafeFirebaseConfigPath("nested/.firebaserc"), false);
  assert.equal(isSafeFirebaseConfigPath("repo-name-only"), false);
});

test("parses a Firebase project ID from the App Hosting env list structure", () => {
  const result = detectFirebaseAssociations([{
    path: "apphosting.yaml",
    content: [
      "runConfig:",
      "  minInstances: 0",
      "env:",
      "  - variable: NEXT_PUBLIC_FIREBASE_API_KEY",
      "    value: public-api-key",
      "  - variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "    value: \"app-hosting-project\"",
      "    availability:",
      "      - BUILD",
      "      - RUNTIME",
    ].join("\n"),
  }]);

  assert.deepEqual(result.projectIds, ["app-hosting-project"]);
  assert.deepEqual(result.evidence, [{
    projectId: "app-hosting-project",
    filePath: "apphosting.yaml",
    configKey: "env.NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    status: "detected",
  }]);
});

test("parses inline App Hosting env mappings without treating unrelated values as project IDs", () => {
  const result = detectFirebaseAssociations([{
    path: "apphosting.yml",
    content: [
      "env: [{ variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID, value: inline-firebase-project }, { variable: API_ENDPOINT, value: unrelated-project-id }]",
      "projectId: unrelated-top-level-project",
    ].join("\n"),
  }]);

  assert.deepEqual(result.projectIds, ["inline-firebase-project"]);
});

test("ignores unrelated App Hosting variables and files with no project ID", () => {
  const result = detectFirebaseAssociations([{
    path: "apphosting.yaml",
    content: [
      "env:",
      "  - variable: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      "    value: unrelated-project.firebaseapp.com",
      "  - variable: SOME_PROJECT_NAME",
      "    value: looks-like-project-id",
    ].join("\n"),
  }]);

  assert.deepEqual(result, { projectIds: [], evidence: [], discoveryStatus: "complete" });
});

test("retains explicit partial discovery when no Firebase evidence is available", () => {
  const result = detectFirebaseAssociations([], "partial");

  assert.deepEqual(result, {
    projectIds: [],
    evidence: [],
    discoveryStatus: "partial",
  });
});

test("treats malformed App Hosting env input as nonfatal and continues to later valid entries", () => {
  const result = detectFirebaseAssociations([{
    path: "apphosting.yaml",
    content: [
      "env:",
      "  - variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "    value: \"unterminated-project",
      "  - { variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID, value: malformed-project",
      "  - variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "    value: recovered-project-id",
    ].join("\n"),
  }]);

  assert.deepEqual(result.projectIds, ["recovered-project-id"]);
});
