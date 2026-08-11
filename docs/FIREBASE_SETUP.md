# Firebase setup for Developer Dashboard

Project: marwan-developer-dashboard

Do not deploy any resource until current server-side configuration is verified without reading secret values and the exact deployment is explicitly approved.

Historical evidence in `CODEX_STATUS.md` records the two GitHub synchronization Secret Manager values as enabled on 2026-08-06 and records Functions, scheduler, and App Hosting deployments that day. `CODEX_INGEST_TOKEN` did not exist in that historical check. This document does not claim that the new credential or endpoint is configured or deployed.

## Browser Firebase configuration

The existing browser app uses these public Firebase web configuration values:

- NEXT_PUBLIC_FIREBASE_API_KEY
- NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
- NEXT_PUBLIC_FIREBASE_PROJECT_ID
- NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
- NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
- NEXT_PUBLIC_FIREBASE_APP_ID

These values identify the Firebase web app and are not the GitHub credential. Keep local environment files out of Git even when their values are public configuration.

## Create the fine-grained GitHub token

In GitHub:

1. Open Settings.
2. Open Developer settings.
3. Open Personal access tokens, then Fine-grained tokens.
4. Choose Generate new token.
5. Use a clear name such as Developer Dashboard read-only sync.
6. Select the personal GitHub account as Resource owner when that account owns the repositories to import.
7. Set Repository access to All repositories.
8. Set Contents to Read-only.
9. Set Pull requests to Read-only.
10. Leave Metadata at its automatically included Read-only level.
11. Grant no write permissions and no other repository permissions.
12. Use a 90-day expiration, or a shorter period if regular rotation is practical.
13. Generate the token and move directly to the interactive Secret Manager command.

A fine-grained token can select only one resource owner. If repositories are split across a personal owner and one or more organizations, one token cannot expose every owner. Do not silently claim account-wide coverage across owners. A future multi-token design is required for that case.

Never paste the token into Codex, chat, source code, a command argument, a test, or a report.

## Find the Firebase UID safely

1. Open Firebase Console.
2. Select marwan-developer-dashboard.
3. Open Build, then Authentication.
4. Open the Users tab.
5. Locate the Google account used for this dashboard.
6. Copy the value in the UID column.

The UID is an authorization identifier and operationally sensitive Secret Manager value. It is not the GitHub token, must not be logged or committed, and must not be replaced with an email address.

## Create the Codex ingestion credential

Create a unique high-entropy credential with a trusted password manager or secret generator. It is a purpose-limited bearer credential for `ingestCodexSession`; it is not a GitHub token, Firebase ID token, service-account key, or Firebase Admin credential. Do not reuse another credential.

Keep the value in a trusted local secret store so opted-in Codex sessions can supply it through `DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN`. Do not store it in Developer Dashboard, another project repository, an `.env` file, shell history, chat, documentation, tests, or a command argument.

## Store server-side values interactively

Run these commands in a local terminal. Each command prompts securely for its value:

    cd /home/marwan/Documents/developer-dashboard
    firebase functions:secrets:set GITHUB_READ_TOKEN --project marwan-developer-dashboard
    firebase functions:secrets:set DASHBOARD_OWNER_UID --project marwan-developer-dashboard
    firebase functions:secrets:set CODEX_INGEST_TOKEN --project marwan-developer-dashboard

At the first prompt, paste the fine-grained GitHub token directly into the terminal prompt.

At the second prompt, paste the Firebase Authentication UID copied from the Firebase Console.

At the third prompt, paste the dedicated Codex ingestion credential directly into the terminal prompt.

Do not place any value after a command on the command line. Do not add any value to `.env.local`, `apphosting.yaml`, Firestore, localStorage, or `NEXT_PUBLIC` variables.

## Functions

The owner-only callable exports are:

- getGitHubConnectionStatus
- syncGitHubRepositories

The prepared daily scheduled export is:

- scheduledSyncGitHubRepositories
- Region: us-east4
- Schedule: 15 3 * * *
- Time zone: America/Toronto
- Effective cadence: daily at 03:15 local time

The scheduled function uses DASHBOARD_OWNER_UID internally and shares the same lease as on-demand synchronization. Successful scheduled-day completion is recorded independently of later manual-run status; already-completed duplicate delivery skips without rewriting its original audit, while failed attempts may retry.

The owner-scoped Codex ingestion HTTPS export is:

- ingestCodexSession
- Region: us-east4
- Type: HTTPS `onRequest`; CORS disabled
- Runtime limits: 60 seconds, 256 MiB, maximum two instances
- Authentication: `Authorization: Bearer` using `CODEX_INGEST_TOKEN`
- Owner path: derived only from `DASHBOARD_OWNER_UID`
- Secret bindings: only `CODEX_INGEST_TOKEN` and `DASHBOARD_OWNER_UID`

The endpoint accepts no Firebase Admin or service-account credential from a caller. Its exact V1 contract is in `docs/CODEX_SESSION_INGESTION.md`.

## Configure the local helper

After an approved deployment, set the Function URL and load the credential from a trusted local secret store into the current process environment:

    export DEVELOPER_DASHBOARD_CODEX_INGEST_URL="<deployed-ingestCodexSession-https-url>"
    read -rsp "Developer Dashboard Codex ingestion credential: " DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN
    export DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN

The secure prompt does not echo the value. Do not type the credential directly into an `export` command because that would place it in shell history. Another repository can then invoke the shared helper by absolute path; it does not need a copy of Developer Dashboard source.

## Configuration gate

After each interactive command succeeds, confirm only that the value is configured. Do not reveal it. Configuration does not authorize deployment; follow the current validation and approval gates in `docs/DEPLOYMENT.md`.
