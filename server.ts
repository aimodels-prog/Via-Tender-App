import dotenv from "dotenv";
dotenv.config({ override: true });

import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import { v4 as uuidv4 } from "uuid";
import { initPostgres, query, writeLog } from "./src/backend/postgres.ts";
import { normalizeExpertCollections } from "./src/lib/cvPostProcess.ts";
import { normalizeTenderRecord } from "./src/lib/tenderPostProcess.ts";

type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "Admin" | "User";
  status: "Active" | "Inactive";
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_COOKIE = "via_session";
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-before-production";
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "via-int.com").trim().toLowerCase();

function isAllowedEmail(value: string) {
  const email = String(value || "").trim().toLowerCase();
  return Boolean(email && email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`));
}

function domainError() {
  return `Only ${ALLOWED_EMAIL_DOMAIN} email addresses are allowed.`;
}

function publicUser(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    lastLogin: row.last_login,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function signSession(user: AuthUser) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    },
    JWT_SECRET,
    { expiresIn: "12h" },
  );
}

function setSessionCookie(res: Response, user: AuthUser) {
  res.cookie(JWT_COOKIE, signSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[JWT_COOKIE];
  if (!token) return res.status(401).json({ error: "Authentication required." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    if (decoded.status === "Inactive") {
      return res.status(403).json({ error: "This account is inactive." });
    }
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "Admin") {
    return res.status(403).json({ error: "Admin access is required." });
  }
  return next();
}

async function getSetting(key: string, fallback: any = null) {
  const result = await query(`select value from settings where key = $1`, [key]);
  return result.rows[0]?.value ?? fallback;
}

async function saveSetting(key: string, value: any) {
  await query(
    `insert into settings (key, value, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

function withData(row: any) {
  if (!row) return null;
  const data = row.data || {};
  const hydrated = {
    ...data,
    id: row.id ?? data.id,
    created_at: row.created_at ?? data.created_at,
    updatedAt: row.updated_at ?? data.updatedAt,
  };
  if (row.tender_title !== undefined || hydrated.positions || hydrated.scope_summary) {
    return normalizeTenderRecord(hydrated);
  }
  return row.full_name !== undefined || hydrated.experiences || hydrated.education || hydrated.languages
    ? normalizeExpertCollections(hydrated)
    : hydrated;
}

function normalizeDeadline(value: any) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function createDriveClient() {
  const oauthTokens = await getSetting("googleDriveOAuth", null);
  if (oauthTokens?.refresh_token && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
    auth.setCredentials(oauthTokens);
    return google.drive({ version: "v3", auth });
  }

  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const apiKey = process.env.GOOGLE_API_KEY;
  const delegatedUserEmail = process.env.GOOGLE_DELEGATED_USER_EMAIL;

  if (rawCredentials) {
    let credentials: any;
    try {
      credentials = JSON.parse(rawCredentials);
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }

    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      subject: delegatedUserEmail || undefined,
    });
    return google.drive({ version: "v3", auth });
  }

  if (apiKey) return google.drive({ version: "v3", auth: apiKey });
  throw new Error("Google Drive is not connected. Connect Google Drive in Settings.");
}

function createGoogleOAuthClient(req?: Request) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for Google Drive OAuth.");
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${req?.protocol || "http"}://${req?.get("host") || `localhost:${process.env.PORT || 3000}`}/api/google-drive/oauth/callback`;

  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
}

async function startServer() {
  await initPostgres();

  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const upload = multer({ dest: "uploads/" });

  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "50mb" }));
  app.use((error: any, _req: Request, res: Response, next: NextFunction) => {
    if (!error) return next();
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Uploaded document text is too large for the server to process in one request." });
    }
    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({ error: "Invalid JSON request body." });
    }
    return next(error);
  });
  app.use(cookieParser());
  app.use(
    "/api/auth",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 40,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.post("/api/auth/register", async (req, res) => {
    try {
      const name = String(req.body.name || "").trim();
      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");

      if (!name) return res.status(400).json({ error: "Full name is required." });
      if (!email) return res.status(400).json({ error: "Email address is required." });
      if (!isAllowedEmail(email)) return res.status(400).json({ error: domainError() });
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." });
      }

      const existing = await query(`select id from users where lower(email) = lower($1)`, [email]);
      if (existing.rowCount) {
        return res.status(409).json({ error: "A user with this email already exists." });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const inserted = await query(
        `insert into users (name, email, password_hash, role, status)
         values ($1, $2, $3, 'User', 'Active')
         returning *`,
        [name, email, passwordHash],
      );
      await writeLog("User Registered", `Created user account ${email}`);
      const user = publicUser(inserted.rows[0]) as AuthUser;
      setSessionCookie(res, user);
      return res.json({ success: true, user });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");
      if (!isAllowedEmail(email)) return res.status(401).json({ error: domainError() });
      const result = await query(`select * from users where lower(email) = lower($1)`, [email]);
      const userRow = result.rows[0];
      if (!userRow) return res.status(401).json({ error: "No user exists with this email address." });
      if (userRow.status === "Inactive") return res.status(403).json({ error: "This user account is inactive." });

      const ok = await bcrypt.compare(password, userRow.password_hash);
      if (!ok) return res.status(401).json({ error: "Incorrect password." });

      const updated = await query(`update users set last_login = now(), updated_at = now() where id = $1 returning *`, [
        userRow.id,
      ]);
      const user = publicUser(updated.rows[0]) as AuthUser;
      setSessionCookie(res, user);
      await writeLog("User Login", `User ${email} signed in`);
      return res.json({ success: true, user });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const token = req.cookies?.[JWT_COOKIE];
    if (!token) return res.json({ user: null });
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
      const result = await query(`select * from users where id = $1`, [decoded.id]);
      const row = result.rows[0];
      if (!row || row.status === "Inactive") return res.json({ user: null });
      return res.json({ user: publicUser(row) });
    } catch {
      return res.json({ user: null });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(JWT_COOKIE);
    res.json({ success: true });
  });

  app.get("/api/stats", requireAuth, async (_req, res) => {
    const result = await query(`
      select
        (select count(*)::int from experts) as "totalExperts",
        (select count(*)::int from tenders) as "activeTenders",
        (select count(*)::int from generated_cvs) as "cvsGenerated",
        coalesce((select round(avg(score))::int from matches), 0) as "matchRate"
    `);
    res.json(result.rows[0]);
  });

  app.get("/api/logs", requireAuth, async (_req, res) => {
    const result = await query(
      `select id, action, detail, status, created_at as timestamp from logs order by created_at desc limit 100`,
    );
    res.json(result.rows);
  });

  app.get("/api/users", requireAuth, requireAdmin, async (_req, res) => {
    const result = await query(`select * from users order by created_at desc`);
    res.json(result.rows.map(publicUser));
  });

  app.post("/api/users", requireAuth, requireAdmin, async (req, res) => {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || uuidv4()).slice(0, 128);
    const role = req.body.role === "Admin" ? "Admin" : "User";
    const status = req.body.status === "Inactive" ? "Inactive" : "Active";
    if (!name || !email) return res.status(400).json({ error: "Name and email are required." });
    if (!isAllowedEmail(email)) return res.status(400).json({ error: domainError() });
    const existing = await query(`select id from users where lower(email) = lower($1)`, [email]);
    if (existing.rowCount) return res.status(409).json({ error: "A user with this email already exists." });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `insert into users (name, email, password_hash, role, status)
       values ($1, $2, $3, $4, $5) returning *`,
      [name, email, passwordHash, role, status],
    );
    await writeLog("User Created", `Created ${role} user ${email}`);
    res.json({ success: true, user: publicUser(result.rows[0]) });
  });

  app.patch("/api/users/:id", requireAuth, async (req, res) => {
    const isSelf = String(req.user?.id) === String(req.params.id);
    if (!isSelf && req.user?.role !== "Admin") return res.status(403).json({ error: "Admin access is required." });

    const current = await query(`select * from users where id = $1`, [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: "User not found." });

    const existing = current.rows[0];
    const nextName = String(req.body.name ?? existing.name).trim();
    const nextEmail = String(req.body.email ?? existing.email).trim().toLowerCase();
    if (!isAllowedEmail(nextEmail)) return res.status(400).json({ error: domainError() });
    if (!nextName || !nextEmail) return res.status(400).json({ error: "Name and email are required." });
    if (nextEmail !== String(existing.email || "").toLowerCase()) {
      const duplicate = await query(`select id from users where lower(email) = lower($1) and id <> $2`, [nextEmail, req.params.id]);
      if (duplicate.rowCount) return res.status(409).json({ error: "A user with this email already exists." });
    }
    const nextRole = req.user?.role === "Admin" && req.body.role === "Admin" ? "Admin" : req.user?.role === "Admin" ? req.body.role || existing.role : existing.role;
    const nextStatus = req.user?.role === "Admin" ? (req.body.status === "Inactive" ? "Inactive" : req.body.status === "Active" ? "Active" : existing.status) : existing.status;
    const passwordHash = req.body.password ? await bcrypt.hash(String(req.body.password), 12) : existing.password_hash;

    const updated = await query(
      `update users
       set name = $1, email = $2, role = $3, status = $4, password_hash = $5, updated_at = now()
       where id = $6 returning *`,
      [nextName, nextEmail, passwordHash ? nextRole : nextRole, nextStatus, passwordHash, req.params.id],
    );
    await writeLog("User Updated", `Updated user ${nextEmail}`);
    res.json({ success: true, user: publicUser(updated.rows[0]) });
  });

  app.delete("/api/users/:id", requireAuth, requireAdmin, async (req, res) => {
    if (String(req.user?.id) === String(req.params.id)) {
      return res.status(400).json({ error: "You cannot delete your own signed-in admin account." });
    }
    await query(`delete from users where id = $1`, [req.params.id]);
    await writeLog("User Deleted", "Deleted user record");
    res.json({ success: true });
  });

  app.get("/api/settings/:key", requireAuth, async (req, res) => {
    const value = await getSetting(req.params.key);
    if (req.params.key === "googleDrive") {
      const oauthTokens = await getSetting("googleDriveOAuth", null);
      return res.json({
        ...(value || {}),
        oauthConnected: Boolean(oauthTokens?.refresh_token),
        oauthEmail: oauthTokens?.email || "",
        oauthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        serviceAccountConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
        apiKeyConfigured: Boolean(process.env.GOOGLE_API_KEY),
      });
    }
    if (req.params.key === "aiSettings") {
      return res.json({ ...(value || {}), apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY), apiKey: "" });
    }
    res.json(value);
  });

  app.put("/api/settings/:key", requireAuth, requireAdmin, async (req, res) => {
    let value = req.body || {};
    if (req.params.key === "googleDrive") {
      value = {
        cvFolderId: value.cvFolderId || "",
        scanIntervalMinutes: Number(value.scanIntervalMinutes || 5),
        autoScanEnabled: Boolean(value.autoScanEnabled),
      };
    }
    if (req.params.key === "aiSettings") {
      value = { provider: "server", apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY) };
    }
    await saveSetting(req.params.key, value);
    await writeLog("Settings Updated", `Updated ${req.params.key} settings`);
    res.json({ success: true, value });
  });

  app.get("/api/lookups", requireAuth, async (_req, res) => {
    res.json(await getSetting("lookups", {}));
  });

  app.get("/api/user-state/:key", requireAuth, async (req, res) => {
    const result = await query(
      `select value from user_preferences where user_id = $1 and key = $2`,
      [req.user!.id, req.params.key],
    );
    res.json({ key: req.params.key, value: result.rows[0]?.value ?? null });
  });

  app.put("/api/user-state/:key", requireAuth, async (req, res) => {
    const value = req.body?.value ?? null;
    await query(
      `insert into user_preferences (user_id, key, value, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`,
      [req.user!.id, req.params.key, JSON.stringify(value)],
    );
    res.json({ success: true, key: req.params.key, value });
  });

  app.delete("/api/user-state/:key", requireAuth, async (req, res) => {
    await query(`delete from user_preferences where user_id = $1 and key = $2`, [
      req.user!.id,
      req.params.key,
    ]);
    res.json({ success: true });
  });

  app.get("/api/google-drive/oauth/status", requireAuth, async (_req, res) => {
    const tokens = await getSetting("googleDriveOAuth", null);
    res.json({
      connected: Boolean(tokens?.refresh_token),
      email: tokens?.email || "",
      connectedAt: tokens?.connectedAt || null,
      oauthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    });
  });

  app.get("/api/google-drive/oauth/start", requireAuth, requireAdmin, async (req, res) => {
    try {
      const state = uuidv4();
      const auth = createGoogleOAuthClient(req);
      res.cookie("google_drive_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 10 * 60 * 1000,
      });
      const url = auth.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
          "https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/userinfo.email",
        ],
        state,
      });
      res.redirect(url);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/google-drive/oauth/callback", async (req, res) => {
    try {
      const state = String(req.query.state || "");
      const expectedState = req.cookies?.google_drive_oauth_state;
      if (!state || !expectedState || state !== expectedState) {
        return res.status(400).send("Invalid Google Drive OAuth state.");
      }

      const code = String(req.query.code || "");
      if (!code) return res.status(400).send("Google Drive OAuth code is missing.");

      const auth = createGoogleOAuthClient(req);
      const { tokens } = await auth.getToken(code);
      auth.setCredentials(tokens);

      let email = "";
      try {
        const oauth2 = google.oauth2({ version: "v2", auth });
        const userInfo = await oauth2.userinfo.get();
        email = userInfo.data.email || "";
      } catch {
        email = "";
      }

      if (!isAllowedEmail(email)) {
        return res.status(403).send(domainError());
      }

      const existingTokens = await getSetting("googleDriveOAuth", {});
      await saveSetting("googleDriveOAuth", {
        ...existingTokens,
        ...tokens,
        refresh_token: tokens.refresh_token || existingTokens.refresh_token,
        email,
        connectedAt: new Date().toISOString(),
      });
      await writeLog("Google Drive Connected", email ? `Connected Google Drive for ${email}` : "Connected Google Drive");
      res.clearCookie("google_drive_oauth_state");
      res.redirect("/settings?tab=integrations&drive=connected");
    } catch (error: any) {
      res.status(500).send(`Google Drive OAuth failed: ${error.message}`);
    }
  });

  app.delete("/api/google-drive/oauth", requireAuth, requireAdmin, async (_req, res) => {
    await saveSetting("googleDriveOAuth", {});
    await writeLog("Google Drive Disconnected", "Removed Google Drive OAuth tokens");
    res.json({ success: true });
  });

  app.get("/api/google-drive/list", requireAuth, async (_req, res) => {
    try {
      const config = await getSetting("googleDrive", {});
      if (!config.cvFolderId) return res.status(400).json({ error: "Google Drive CV folder ID is required." });
      const drive = await createDriveClient();
      const response = await drive.files.list({
        q: `'${config.cvFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: "files(id,name,mimeType,modifiedTime,size,md5Checksum,webViewLink)",
        orderBy: "modifiedTime desc",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: 100,
      });
      res.json({ files: response.data.files || [] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google-drive/download", requireAuth, async (req, res) => {
    try {
      const { fileId } = req.body;
      if (!fileId) return res.status(400).json({ error: "fileId is required" });
      const drive = await createDriveClient();
      const meta = await drive.files.get({ fileId, fields: "name,mimeType", supportsAllDrives: true });
      const response = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
      );
      const buffer = Buffer.from(response.data as ArrayBuffer);
      res.setHeader("Content-Type", meta.data.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${meta.data.name || fileId}"`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/drive-files", requireAuth, async (_req, res) => {
    const result = await query(`select * from drive_files order by updated_at desc`);
    res.json(
      result.rows.map((row: any) => ({
        ...(row.data || {}),
        id: row.id,
        googleFileId: row.google_file_id,
        name: row.name,
        mimeType: row.mime_type,
        folderType: row.folder_type,
        status: row.status,
        expertName: row.expert_name,
        confidenceScore: row.confidence_score,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );
  });

  app.post("/api/drive-files", requireAuth, async (req, res) => {
    const file = req.body || {};
    const id = file.id || `drive_${uuidv4()}`;
    await query(
      `insert into drive_files
       (id, google_file_id, name, mime_type, folder_type, status, expert_name, confidence_score, error_message, data)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       on conflict (google_file_id) do update set
         name = excluded.name,
         mime_type = excluded.mime_type,
         folder_type = excluded.folder_type,
         status = excluded.status,
         expert_name = excluded.expert_name,
         confidence_score = excluded.confidence_score,
         error_message = excluded.error_message,
         data = drive_files.data || excluded.data,
         updated_at = now()`,
      [
        id,
        file.googleFileId,
        file.name,
        file.mimeType,
        file.folderType,
        file.status,
        file.expertName,
        file.confidenceScore ?? null,
        file.errorMessage || "",
        JSON.stringify(file),
      ],
    );
    res.json({ success: true, driveFile: { ...file, id } });
  });

  app.patch("/api/drive-files/:googleFileId", requireAuth, async (req, res) => {
    const updates = req.body || {};
    const result = await query(
      `update drive_files set
        status = coalesce($2, status),
        expert_name = coalesce($3, expert_name),
        confidence_score = coalesce($4, confidence_score),
        error_message = coalesce($5, error_message),
        data = data || $6::jsonb,
        updated_at = now()
       where google_file_id = $1
       returning *`,
      [
        req.params.googleFileId,
        updates.status,
        updates.expertName,
        updates.confidenceScore ?? null,
        updates.errorMessage,
        JSON.stringify(updates),
      ],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Drive file not found." });
    res.json({ success: true });
  });

  app.get("/api/pending-drive-reviews", requireAuth, async (_req, res) => {
    const result = await query(`select * from pending_drive_reviews order by created_at desc`);
    res.json(
      result.rows.map((row: any) => ({
        ...(row.data || {}),
        id: row.id,
        googleFileId: row.google_file_id,
        fileName: row.file_name,
        experts: row.experts,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );
  });

  app.post("/api/pending-drive-reviews", requireAuth, async (req, res) => {
    const review = req.body || {};
    const id = review.id || `review_${uuidv4()}`;
    await query(
      `insert into pending_drive_reviews (id, google_file_id, file_name, experts, data, status)
       values ($1,$2,$3,$4::jsonb,$5::jsonb,'review_required')
       on conflict (google_file_id) do update set
         file_name = excluded.file_name,
         experts = excluded.experts,
         data = pending_drive_reviews.data || excluded.data,
         status = 'review_required',
         updated_at = now()`,
      [id, review.googleFileId, review.fileName, JSON.stringify(review.experts || []), JSON.stringify(review)],
    );
    res.json({ success: true, review: { ...review, id, status: "review_required" } });
  });

  app.delete("/api/pending-drive-reviews", requireAuth, async (req, res) => {
    const ids: string[] = req.body?.googleFileIds || [];
    if (ids.length) {
      await query(`delete from pending_drive_reviews where google_file_id = any($1::text[])`, [ids.map(String)]);
    } else {
      await query(`delete from pending_drive_reviews`);
    }
    res.json({ success: true });
  });

  app.get("/api/experts", requireAuth, async (_req, res) => {
    const result = await query(`select * from experts order by created_at desc`);
    res.json(result.rows.map(withData));
  });

  app.post("/api/experts/save", requireAuth, async (req, res) => {
    const experts = Array.isArray(req.body.experts) ? req.body.experts : [];
    let added = 0;
    let updated = 0;
    for (const expert of experts) {
      const normalizedExpert = normalizeExpertCollections(expert);
      const fullName = (normalizedExpert.fullName || normalizedExpert.name || "").trim();
      const existing = fullName
        ? await query(`select id from experts where lower(full_name) = lower($1) limit 1`, [fullName])
        : { rows: [] };
      const id = existing.rows[0]?.id || normalizedExpert.id || `expert_${uuidv4()}`;
      const data = { ...normalizedExpert, id, updatedAt: new Date().toISOString() };
      await query(
        `insert into experts (id, full_name, primary_position, role, data)
         values ($1,$2,$3,$4,$5::jsonb)
         on conflict (id) do update set
           full_name = excluded.full_name,
           primary_position = excluded.primary_position,
           role = excluded.role,
           data = excluded.data,
           updated_at = now()`,
        [id, fullName, normalizedExpert.primary_position || normalizedExpert.primaryPosition || normalizedExpert.role || "Uncategorized", normalizedExpert.role, JSON.stringify(data)],
      );
      existing.rows[0]?.id ? updated++ : added++;
    }
    await writeLog("Expert Ingestion", `Added ${added} and updated ${updated} expert profiles`);
    res.json({ success: true, added, updated });
  });

  app.patch("/api/experts/:id", requireAuth, async (req, res) => {
    const current = await query(`select * from experts where id = $1`, [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: "Expert not found." });
    const next = normalizeExpertCollections({ ...(current.rows[0].data || {}), ...req.body, id: req.params.id, updatedAt: new Date().toISOString() });
    const result = await query(
      `update experts set full_name = $2, primary_position = $3, role = $4, data = $5::jsonb, updated_at = now()
       where id = $1 returning *`,
      [
        req.params.id,
        next.fullName || next.name || "",
        next.primary_position || next.primaryPosition || next.role || "Uncategorized",
        next.role,
        JSON.stringify(next),
      ],
    );
    await writeLog("Expert Updated", `Updated expert record for ${next.fullName || next.name || "Expert"}`);
    res.json({ success: true, expert: withData(result.rows[0]) });
  });

  app.delete("/api/experts/:id", requireAuth, requireAdmin, async (req, res) => {
    await query(`delete from experts where id = $1`, [req.params.id]);
    await writeLog("Expert Deleted", "Deleted expert record");
    res.json({ success: true });
  });

  app.get("/api/tenders", requireAuth, async (_req, res) => {
    const result = await query(`select * from tenders order by created_at desc`);
    res.json(result.rows.map(withData));
  });

  app.get("/api/tenders/:id", requireAuth, async (req, res) => {
    const result = await query(`select * from tenders where id = $1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Tender not found." });
    res.json(withData(result.rows[0]));
  });

  app.post("/api/tenders", requireAuth, async (req, res) => {
    const tender = req.body || {};
    const id = tender.id || `tender_${uuidv4()}`;
    const data = normalizeTenderRecord({
      ...tender,
      id,
      status: tender.status || "OPEN",
      created_at: tender.created_at || new Date().toISOString(),
      positions: (tender.positions || []).map((p: any, i: number) => ({ ...p, id: p.id || `pos_${Date.now()}_${i}` })),
    });
    await query(
      `insert into tenders (id, tender_title, client, status, deadline, data)
       values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [id, data.tender_title || data.name || "", data.client || "", data.status, normalizeDeadline(data.deadline), JSON.stringify(data)],
    );
    await writeLog("Tender Integration", `Opportunity "${data.tender_title || data.name || "Tender"}" added to pipeline`);
    res.json(data);
  });

  app.patch("/api/tenders/:id", requireAuth, async (req, res) => {
    const current = await query(`select * from tenders where id = $1`, [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: "Tender not found." });
    const next = normalizeTenderRecord({ ...(current.rows[0].data || {}), ...req.body, id: req.params.id, updatedAt: new Date().toISOString() });
    const result = await query(
      `update tenders set tender_title = $2, client = $3, status = $4, deadline = $5, data = $6::jsonb, updated_at = now()
       where id = $1 returning *`,
      [req.params.id, next.tender_title || next.name || "", next.client || "", next.status || "OPEN", normalizeDeadline(next.deadline), JSON.stringify(next)],
    );
    await writeLog("Tender Updated", `Details updated for "${next.tender_title || next.name || "Tender"}"`);
    res.json(withData(result.rows[0]));
  });

  app.delete("/api/tenders/:id", requireAuth, requireAdmin, async (req, res) => {
    await query(`delete from matches where tender_id = $1`, [req.params.id]);
    await query(`delete from tenders where id = $1`, [req.params.id]);
    await writeLog("Tender Deleted", "Deleted tender record");
    res.json({ success: true });
  });

  app.get("/api/matches", requireAuth, async (req, res) => {
    const tenderId = String(req.query.tenderId || "");
    const result = tenderId
      ? await query(`select * from matches where tender_id = $1 order by created_at desc`, [tenderId])
      : await query(`select * from matches order by created_at desc`);
    res.json(result.rows.map(withData));
  });

  app.post("/api/matches/save", requireAuth, async (req, res) => {
    const { tenderId, positionId, positionTitle, matches } = req.body;
    const incoming = Array.isArray(matches) ? matches : [];
    const incomingIds = incoming.map((m: any) => m.expertId || m.expert?.id).filter(Boolean);
    if (incomingIds.length) {
      await query(
        `delete from matches where tender_id = $1 and position_id = $2 and expert_id = any($3::text[])`,
        [tenderId, positionId, incomingIds.map(String)],
      );
    }
    for (const match of incoming) {
      const id = match.id || `match_${uuidv4()}`;
      const data = { ...match, id, tenderId, positionId, positionTitle };
      await query(
        `insert into matches (id, tender_id, position_id, expert_id, score, data)
         values ($1,$2,$3,$4,$5,$6::jsonb)`,
        [id, tenderId, positionId, match.expertId || match.expert?.id || "", Number(match.score || 0), JSON.stringify(data)],
      );
    }
    await query(`update tenders set data = data || $2::jsonb, updated_at = now() where id = $1`, [
      tenderId,
      JSON.stringify({ last_matched_at: new Date().toISOString() }),
    ]);
    await writeLog("Match Execution", `Ran AI matching engine for position ${positionTitle}`);
    res.json({ success: true });
  });

  app.patch("/api/matches/:id", requireAuth, async (req, res) => {
    const current = await query(`select * from matches where id = $1`, [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: "Match not found." });
    const next = { ...(current.rows[0].data || {}), ...req.body, id: req.params.id };
    await query(`update matches set score = $2, data = $3::jsonb, updated_at = now() where id = $1`, [
      req.params.id,
      Number(next.score || current.rows[0].score || 0),
      JSON.stringify(next),
    ]);
    res.json({ success: true });
  });

  app.delete("/api/matches/:id", requireAuth, requireAdmin, async (req, res) => {
    await query(`delete from matches where id = $1`, [req.params.id]);
    res.json({ success: true });
  });

  app.get("/api/cvs", requireAuth, async (_req, res) => {
    const result = await query(`select * from generated_cvs order by created_at desc`);
    res.json(result.rows.map(withData));
  });

  app.post("/api/cvs", requireAuth, async (req, res) => {
    const cv = req.body || {};
    const id = cv.id || `cv_${Date.now()}`;
    const data = { ...cv, id, mode: cv.mode || "NORMAL", version: cv.version || 1, timestamp: cv.timestamp || new Date().toISOString() };
    await query(
      `insert into generated_cvs (id, expert_id, tender_id, expert_name, mode, version, data)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [id, data.expertId || "", data.tenderId || "", data.expertName || "", data.mode, data.version, JSON.stringify(data)],
    );
    await writeLog("CV Generation", `Branded CV generated for ${data.expertName || "Expert"}`);
    res.json({ success: true, cv: data });
  });

  app.patch("/api/cvs/:id", requireAuth, async (req, res) => {
    const current = await query(`select * from generated_cvs where id = $1`, [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: "CV not found." });
    const nextVersion = Number(current.rows[0].version || 1) + 1;
    const next = { ...(current.rows[0].data || {}), ...req.body, id: req.params.id, version: nextVersion, updatedAt: new Date().toISOString() };
    await query(
      `update generated_cvs set expert_id = $2, tender_id = $3, expert_name = $4, mode = $5, version = $6, data = $7::jsonb, updated_at = now()
       where id = $1`,
      [req.params.id, next.expertId || "", next.tenderId || "", next.expertName || "", next.mode || "NORMAL", nextVersion, JSON.stringify(next)],
    );
    res.json(next);
  });

  app.delete("/api/cvs/:id", requireAuth, requireAdmin, async (req, res) => {
    await query(`delete from generated_cvs where id = $1`, [req.params.id]);
    await writeLog("CV Deleted", "Deleted generated CV");
    res.json({ success: true });
  });

  app.delete("/api/data", requireAuth, requireAdmin, async (_req, res) => {
    await query(`truncate table experts, tenders, matches, generated_cvs, logs, drive_files, pending_drive_reviews`);
    res.json({ success: true });
  });

  app.post("/api/upload", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    res.json({ filename: req.file.filename, originalname: req.file.originalname });
  });

  app.use("/uploads", requireAuth);
  app.get("/uploads/:filename", (req, res) => {
    res.sendFile(path.join(process.cwd(), "uploads", req.params.filename));
  });

  const aiRoute = [requireAuth] as const;
  app.post("/api/parse-cv", ...aiRoute, async (req, res) => {
    try {
      const { runParseCVText } = await import("./src/backend/ai.ts");
      const experts = await runParseCVText(req.body.text, req.body.taxonomy);
      res.json({ experts });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/audit-cv", ...aiRoute, async (req, res) => {
    try {
      const { runAuditExtractedCV } = await import("./src/backend/ai.ts");
      const expert = await runAuditExtractedCV(req.body.rawText, req.body.expert);
      res.json({ expert });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  async function runTenderParseJob(jobId: string, originalTenderText: string) {
    try {
      await query(
        `update parse_jobs set status = 'processing', progress = 10, updated_at = now() where id = $1`,
        [jobId],
      );
      const { runParseTenderText } = await import("./src/backend/ai.ts");
      const tender = await runParseTenderText(originalTenderText);
      tender.original_tender_text = originalTenderText;
      tender.original_tender_text_length = originalTenderText.length;
      tender.extraction_audit = {
        ...(tender.extraction_audit || {}),
        originalTenderTextStored: true,
        originalTenderTextLength: originalTenderText.length,
        extractedAt: new Date().toISOString(),
        asyncJobId: jobId,
      };
      await query(
        `update parse_jobs
         set status = 'completed', progress = 100, result = $2::jsonb, updated_at = now(), completed_at = now()
         where id = $1`,
        [jobId, JSON.stringify({ tender })],
      );
      await writeLog("Tender Parsed", `Tender extraction job ${jobId} completed`);
    } catch (error: any) {
      console.error("Tender parse job failed:", error);
      await query(
        `update parse_jobs
         set status = 'failed', progress = 100, error_message = $2, updated_at = now(), completed_at = now()
         where id = $1`,
        [jobId, error?.message || "Tender parsing failed"],
      );
      await writeLog("Tender Parse Failed", `Tender extraction job ${jobId} failed: ${error?.message || error}`, "ERROR");
    }
  }

  app.post("/api/parse-tender", ...aiRoute, async (req, res) => {
    try {
      const originalTenderText = String(req.body.text || "");
      if (!originalTenderText.trim()) return res.status(400).json({ error: "Tender text is required." });
      const jobId = `parse_tender_${uuidv4()}`;
      await query(
        `insert into parse_jobs (id, user_id, type, status, progress, input)
         values ($1, $2, 'tender', 'queued', 0, $3::jsonb)`,
        [
          jobId,
          req.user?.id || null,
          JSON.stringify({
            originalTenderText,
            originalTenderTextLength: originalTenderText.length,
            startedAt: new Date().toISOString(),
          }),
        ],
      );
      void runTenderParseJob(jobId, originalTenderText);
      res.status(202).json({ jobId, status: "queued", progress: 0 });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/parse-tender/:jobId", ...aiRoute, async (req, res) => {
    const result = await query(
      `select id, user_id, type, status, progress, error_message, result, created_at, updated_at, completed_at
       from parse_jobs
       where id = $1 and type = 'tender' and (user_id = $2 or $3 = 'Admin')`,
      [req.params.jobId, req.user?.id || null, req.user?.role || "User"],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Tender parse job not found." });
    const job = result.rows[0];
    res.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error_message,
      tender: job.result?.tender,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      completedAt: job.completed_at,
    });
  });

  app.post("/api/match-engine", ...aiRoute, async (req, res) => {
    try {
      const { runVectorMatchEngine } = await import("./src/backend/ai.ts");
      const matches = await runVectorMatchEngine(req.body.tender, req.body.positionId, req.body.experts);
      res.json({ matches });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/expert/translate", ...aiRoute, async (req, res) => {
    try {
      const { translateExpertProfile } = await import("./src/backend/ai.ts");
      const translated = await translateExpertProfile(req.body.expert, req.body.language);
      res.json({ translated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/expert/render", ...aiRoute, async (req, res) => {
    try {
      const { runRenderCV } = await import("./src/backend/ai.ts");
      const expert = await runRenderCV(req.body.expert, req.body.tender, req.body.positionTitle);
      res.json({ expert });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/expert/adapt", ...aiRoute, async (req, res) => {
    try {
      const { runAdaptCV } = await import("./src/backend/ai.ts");
      const expert = await runAdaptCV(req.body.expert, req.body.tender, req.body.positionTitle);
      res.json({ expert });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/expert/optimize", ...aiRoute, async (req, res) => {
    try {
      const { runOptimizeCV } = await import("./src/backend/ai.ts");
      const expert = await runOptimizeCV(req.body.expert, req.body.tender, req.body.positionTitle, req.body.isAccepted);
      res.json({ expert });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(
      express.static(distPath, {
        immutable: true,
        maxAge: "1y",
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
          }
        },
      }),
    );
    app.get("/assets/*", (_req, res) => {
      res.status(404).type("text/plain").send("Asset not found. Refresh the page to load the latest app version.");
    });
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
