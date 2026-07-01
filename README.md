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
   DEFAULT_ADMIN_EMAIL=admin@example.com
   DEFAULT_ADMIN_PASSWORD=change-this-password
   GEMINI_API_KEY=your-gemini-key
   GOOGLE_SERVICE_ACCOUNT_JSON=
   GOOGLE_DELEGATED_USER_EMAIL=
   GOOGLE_API_KEY=
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

The server creates the PostgreSQL tables automatically on startup and seeds the first admin account when no users exist.

## Checks

```bash
npm run lint
npm run build
```
