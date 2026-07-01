# VIA Tender CV App

PostgreSQL-backed tender CV extraction, review, matching, and CV generation workspace.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and set:

   ```env
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
   JWT_SECRET=change-this-to-a-long-random-secret
   ALLOWED_EMAIL_DOMAIN=via-int.com
   DEFAULT_ADMIN_EMAIL=
   DEFAULT_ADMIN_PASSWORD=
   GEMINI_API_KEY=your-gemini-key
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/google-drive/oauth/callback
   GOOGLE_SERVICE_ACCOUNT_JSON=
   GOOGLE_DELEGATED_USER_EMAIL=
   GOOGLE_API_KEY=
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

The server creates the PostgreSQL tables automatically on startup. It only seeds the first admin account if both `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` are set; otherwise, create the first user manually in PostgreSQL.

## Google Drive OAuth

Create a Google OAuth web client and add this redirect URI:

```text
http://localhost:3000/api/google-drive/oauth/callback
```

For DigitalOcean, use your live app URL instead:

```text
https://YOUR-APP-URL/api/google-drive/oauth/callback
```

Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. Admin users can connect Google Drive from Settings.

## Checks

```bash
npm run lint
npm run build
```
