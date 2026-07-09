import bcrypt from "bcryptjs";
import pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { ALL_PRIMARY_POSITIONS } from "../lib/constants.ts";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "via-int.com").trim().toLowerCase();

function isAllowedEmail(value: string) {
  const email = String(value || "").trim().toLowerCase();
  return Boolean(email && email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`));
}

function buildPoolConfig(): pg.PoolConfig {
  if (!connectionString) {
    return {
      host: process.env.PGHOST || "localhost",
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE || "via_cv_generation",
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "postgres",
    };
  }

  if (process.env.PGSSL === "false") {
    return { connectionString, ssl: false };
  }

  const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED === "true";
  let normalizedConnectionString = connectionString;

  if (!rejectUnauthorized) {
    try {
      const url = new URL(connectionString);
      url.searchParams.set("sslmode", "no-verify");
      normalizedConnectionString = url.toString();
    } catch {
      normalizedConnectionString = connectionString;
    }
  }

  return {
    connectionString: normalizedConnectionString,
    ssl: { rejectUnauthorized },
  };
}

export const pool = new Pool(buildPoolConfig());

export async function query<T = any>(text: string, params: any[] = []) {
  return pool.query<T>(text, params);
}

async function upsertSetting(key: string, value: any) {
  await query(
    `insert into settings (key, value)
     values ($1, $2::jsonb)
     on conflict (key) do nothing`,
    [key, JSON.stringify(value)],
  );
}

export async function writeLog(action: string, detail: string, status = "SUCCESS") {
  await query(
    `insert into logs (id, action, detail, status, created_at)
     values ($1, $2, $3, $4, now())`,
    [uuidv4(), action, detail, status],
  );
}

export async function initPostgres() {
  await query(`create extension if not exists pgcrypto`);

  await query(`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      email text not null,
      password_hash text not null,
      role text not null default 'User' check (role in ('Admin', 'User')),
      status text not null default 'Active' check (status in ('Active', 'Inactive')),
      last_login timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await query(`create unique index if not exists users_email_lower_idx on users (lower(email))`);

  await query(`
    create table if not exists settings (
      key text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists user_preferences (
      user_id uuid not null references users(id) on delete cascade,
      key text not null,
      value jsonb not null default 'null'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (user_id, key)
    )
  `);

  await query(`
    create table if not exists experts (
      id text primary key,
      full_name text,
      primary_position text,
      role text,
      data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists tenders (
      id text primary key,
      tender_title text,
      client text,
      status text,
      deadline timestamptz,
      data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists matches (
      id text primary key,
      tender_id text,
      position_id text,
      expert_id text,
      score numeric,
      data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists generated_cvs (
      id text primary key,
      expert_id text,
      tender_id text,
      expert_name text,
      mode text,
      version integer not null default 1,
      data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists logs (
      id text primary key,
      action text not null,
      detail text not null,
      status text not null default 'SUCCESS',
      created_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists parse_jobs (
      id text primary key,
      user_id uuid references users(id) on delete set null,
      type text not null,
      status text not null default 'queued',
      progress integer not null default 0,
      error_message text,
      input jsonb not null default '{}'::jsonb,
      result jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz
    )
  `);
  await query(`create index if not exists parse_jobs_user_created_idx on parse_jobs (user_id, created_at desc)`);

  await query(`
    create table if not exists drive_files (
      id text primary key,
      google_file_id text not null unique,
      name text,
      mime_type text,
      folder_type text,
      status text,
      expert_name text,
      confidence_score numeric,
      error_message text,
      data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists pending_drive_reviews (
      id text primary key,
      google_file_id text not null unique,
      file_name text,
      experts jsonb not null default '[]'::jsonb,
      data jsonb not null default '{}'::jsonb,
      status text not null default 'review_required',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await upsertSetting("taxonomy", ALL_PRIMARY_POSITIONS);
  await upsertSetting("globalBranding", {
    header_base64: "",
    footer_base64: "",
    header_name: "",
    footer_name: "",
  });
  await upsertSetting("googleDrive", {
    cvFolderId: "",
    scanIntervalMinutes: 5,
    autoScanEnabled: false,
  });
  await upsertSetting("aiSettings", {
    provider: "server",
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
  await upsertSetting("lookups", {
    roles: ["Admin", "User"],
    userStatuses: ["Active", "Inactive"],
    expertTypes: ["Internal", "External"],
    tenderStatuses: [
      "New",
      "Tender Extraction Processing",
      "Tender Extraction Completed",
      "Tender Extraction Failed",
      "Matching Processing",
      "Matching Completed",
      "Matching Failed",
      "Matching Partial",
      "Review",
      "Archived",
      "OPEN",
      "CLOSED",
      "WON",
      "LOST",
    ],
    cvModes: ["NORMAL", "ADAPT", "RENDER"],
    languages: ["French", "Spanish", "Arabic", "German"],
    pageSizes: [10, 20, 50],
    matchSorts: [
      { value: "score_desc", label: "Highest Score" },
      { value: "score_asc", label: "Lowest Score" },
      { value: "name_asc", label: "Name (A-Z)" },
    ],
  });

  const count = await query<{ count: string }>(`select count(*)::text as count from users`);
  if (Number(count.rows[0]?.count || 0) === 0) {
    const email = process.env.DEFAULT_ADMIN_EMAIL?.trim();
    const password = process.env.DEFAULT_ADMIN_PASSWORD?.trim();

    if (email && password && isAllowedEmail(email)) {
      const passwordHash = await bcrypt.hash(password, 12);
      await query(
        `insert into users (name, email, password_hash, role, status)
         values ($1, $2, $3, 'Admin', 'Active')`,
        ["Admin User", email.toLowerCase(), passwordHash],
      );
      await writeLog("Admin Seeded", `Created initial admin account ${email}`);
    } else if (email && password) {
      console.warn(`Default admin was not seeded because only ${ALLOWED_EMAIL_DOMAIN} email addresses are allowed.`);
    } else {
      console.warn("No users exist and DEFAULT_ADMIN_EMAIL/DEFAULT_ADMIN_PASSWORD are not set. Create the first user manually.");
    }
  }
}
