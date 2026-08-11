# Firebase setup for Developer Dashboard

Project: marwan-developer-dashboard

Do not deploy any resource until current server-side configuration is verified without reading secret values and the exact deployment is explicitly approved.

Historical evidence in `CODEX_STATUS.md` records both required Secret Manager versions as enabled on 2026-08-06 and records Functions, scheduler, and App Hosting deployments that day. This remediation did not reverify production or secret metadata.

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

## Store both server-side values interactively

Run these commands in a local terminal. Each command prompts securely for its value:

    cd /home/marwan/Documents/developer-dashboard
    firebase functions:secrets:set GITHUB_READ_TOKEN --project marwan-developer-dashboard
    firebase functions:secrets:set DASHBOARD_OWNER_UID --project marwan-developer-dashboard

At the first prompt, paste the fine-grained GitHub token directly into the terminal prompt.

At the second prompt, paste the Firebase Authentication UID copied from the Firebase Console.

Do not place either value after the command on the command line. Do not add either value to .env.local, apphosting.yaml, Firestore, localStorage, or NEXT_PUBLIC variables.

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

## Configuration gate

After either interactive command succeeds, confirm only that the value is configured. Do not reveal it. Configuration does not authorize deployment; follow the current validation and approval gates in `docs/DEPLOYMENT.md`.
