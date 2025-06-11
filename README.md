# SanNext

This project provides serverless functions and static front-end for the virtual queue system.

## Push Notifications

Push notifications require VAPID credentials so the backend can send messages through `web-push`.
Set the following environment variables on your deployment:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Generate them using `npx web-push generate-vapid-keys` and deploy the values to the environment where the Netlify functions run.

