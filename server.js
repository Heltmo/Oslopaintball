const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  hasAdminCredentials,
  isAdminAuthorized,
  parseFormBody,
  renderAdminLoginPage,
  verifyAdminCredentials
} = require("./admin-auth");
const { notifyBookingConfirmed, notifyNewBooking } = require("./booking-notifications");

const ROOT = __dirname;
loadLocalEnv(path.join(ROOT, ".env"));

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "bookings.db");
const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL || "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const VALID_STATUSES = ["pending", "confirmed", "cancelled", "completed"];
const BOOKING_GROUP_MIN = 10;
const BOOKING_GROUP_MAX = 100;
const BOOKING_ALLOWED_TIMES = ["10:00", "12:00", "14:00", "16:00", "18:00"];
const BOOKING_WEEKEND_DAYS = [0, 6];
const BOOKING_SLOT_CAPACITY = parsePositiveInteger(process.env.BOOKING_SLOT_CAPACITY, 2);
const BOOKING_EXTRA_OPEN_DATES = parseDateList(process.env.BOOKING_EXTRA_OPEN_DATES || "");
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

const NO_STORE_HEADERS = {
  ...SECURITY_HEADERS,
  "Cache-Control": "no-store"
};

const PACKAGE_RULES = {
  "Over 18 år": { min: 10, max: 24 },
  "Under 18 år": { min: 10, max: 24 },
  "Turnering / stor gruppe": { min: 25, max: 100 }
};

let db = null;

if (!USE_SUPABASE) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      "package" TEXT NOT NULL,
      group_size INTEGER NOT NULL,
      preferred_date TEXT NOT NULL,
      preferred_time TEXT NOT NULL,
      extras TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      admin_notes TEXT NOT NULL DEFAULT '',
      privacy_consent INTEGER NOT NULL DEFAULT 1,
      privacy_consent_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'cancelled', 'completed')),
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn("bookings", "admin_notes", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "privacy_consent", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("bookings", "privacy_consent_at", "TEXT NOT NULL DEFAULT ''");
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if ((req.method === "GET" || req.method === "POST") && ["/admin", "/admin/", "/admin.html"].includes(requestUrl.pathname)) {
      return handleAdminPage(req, res);
    }

    if (requiresAdminAuth(req.method, requestUrl.pathname)) {
      if (!hasAdminCredentials()) {
        return sendJson(res, 500, {
          error: "Admin-login er ikke konfigurert. Sett ADMIN_USERNAME og ADMIN_PASSWORD."
        });
      }

      if (!isAdminAuthorized(req)) {
        return sendJson(res, 401, { error: "Admin-login kreves." });
      }
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/booking-rules") {
      return sendJson(res, 200, getBookingRulesPayload());
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/bookings") {
      return sendJson(res, 200, await getBookingsPayload());
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/bookings") {
      const body = await readJsonBody(req);
      const booking = normalizeBookingInput(body);
      const validationError = validateBooking(booking);

      if (validationError) {
        return sendJson(res, 400, { error: validationError });
      }

      if (await isConfirmedSlotFull(booking.preferred_date, booking.preferred_time)) {
        return sendJson(res, 409, {
          error: "Dette tidspunktet er fullt. Velg et annet tidspunkt, eller kontakt oss direkte."
        });
      }

      const createdAt = new Date().toISOString();
      const savedBooking = await insertBooking(booking, createdAt);
      const serializedBooking = serializeBooking(savedBooking);
      const notification = await notifyNewBooking(serializedBooking, { logger: console });

      console.log(
        `[BOOKING] New booking #${savedBooking.id} from ${savedBooking.name} for ${savedBooking.preferred_date} ${savedBooking.preferred_time}`
      );

      return sendJson(res, 201, {
        message: "Booking saved.",
        booking: serializedBooking,
        notification
      });
    }

    if (req.method === "PATCH" && /^\/api\/bookings\/\d+\/status$/.test(requestUrl.pathname)) {
      const bookingId = Number.parseInt(requestUrl.pathname.split("/")[3], 10);
      const body = await readJsonBody(req);
      const nextStatus = typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";

      if (!VALID_STATUSES.includes(nextStatus)) {
        return sendJson(res, 400, { error: "Ugyldig statusverdi." });
      }

      const existingBooking = await selectBookingById(bookingId);
      if (!existingBooking) {
        return sendJson(res, 404, { error: "Fant ikke booking." });
      }

      if (
        nextStatus === "confirmed" &&
        (await isConfirmedSlotFull(existingBooking.preferred_date, existingBooking.preferred_time, bookingId))
      ) {
        return sendJson(res, 409, {
          error: "Dette tidspunktet har allerede to bekreftede bookinger."
        });
      }

      await updateBookingStatus(nextStatus, bookingId);
      const updatedBooking = await selectBookingById(bookingId);

      if (!updatedBooking) {
        return sendJson(res, 404, { error: "Fant ikke booking." });
      }

      const serializedBooking = serializeBooking(updatedBooking);
      const notification = nextStatus === "confirmed" && existingBooking.status !== "confirmed"
        ? await notifyBookingConfirmed(serializedBooking, { logger: console })
        : { event: "status_update", results: [] };

      return sendJson(res, 200, {
        message: "Status updated.",
        booking: serializedBooking,
        notification
      });
    }

    if (req.method === "DELETE" && /^\/api\/bookings\/\d+$/.test(requestUrl.pathname)) {
      const bookingId = Number.parseInt(requestUrl.pathname.split("/")[3], 10);
      const existingBooking = await selectBookingById(bookingId);

      if (!existingBooking) {
        return sendJson(res, 404, { error: "Fant ikke booking." });
      }

      await deleteBooking(bookingId);
      return sendJson(res, 200, {
        message: "Booking deleted.",
        booking: serializeBooking(existingBooking)
      });
    }

    if (req.method === "PATCH" && /^\/api\/bookings\/\d+\/admin-notes$/.test(requestUrl.pathname)) {
      const bookingId = Number.parseInt(requestUrl.pathname.split("/")[3], 10);
      const body = await readJsonBody(req);
      const adminNotes = String(body?.admin_notes || "").trim();

      if (adminNotes.length > 2000) {
        return sendJson(res, 400, { error: "Internt notat kan maks være 2000 tegn." });
      }

      const existingBooking = await selectBookingById(bookingId);
      if (!existingBooking) {
        return sendJson(res, 404, { error: "Fant ikke booking." });
      }

      await updateBookingAdminNotes(adminNotes, bookingId);
      const updatedBooking = await selectBookingById(bookingId);

      return sendJson(res, 200, {
        message: "Admin note updated.",
        booking: serializeBooking(updatedBooking)
      });
    }

    if (req.method === "GET") {
      return serveStatic(requestUrl.pathname, res);
    }

    sendJson(res, 404, { error: "Fant ikke ressurs." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Intern serverfeil." });
  }
});

server.listen(PORT, () => {
  console.log(`Oslo Paintball V1 server running on http://localhost:${PORT}`);
  console.log(`Booking storage: ${USE_SUPABASE ? "Supabase" : "SQLite"}`);
});

async function insertBooking(booking, createdAt) {
  if (USE_SUPABASE) {
    const rows = await supabaseRequest("/rest/v1/bookings", {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        name: booking.name,
        phone: booking.phone,
        email: booking.email,
        package: booking.package,
        group_size: booking.group_size,
        preferred_date: booking.preferred_date,
        preferred_time: booking.preferred_time,
        extras: booking.extras,
        notes: booking.notes,
        privacy_consent: booking.privacy_consent,
        privacy_consent_at: createdAt,
        status: "pending",
        created_at: createdAt
      })
    });

    return rows[0];
  }

  const result = db
    .prepare(`
      INSERT INTO bookings (
        name,
        phone,
        email,
        "package",
        group_size,
        preferred_date,
        preferred_time,
        extras,
        notes,
        privacy_consent,
        privacy_consent_at,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `)
    .run(
      booking.name,
      booking.phone,
      booking.email,
      booking.package,
      booking.group_size,
      booking.preferred_date,
      booking.preferred_time,
      JSON.stringify(booking.extras),
      booking.notes,
      booking.privacy_consent ? 1 : 0,
      createdAt,
      createdAt
    );

  return selectBookingById(result.lastInsertRowid);
}

async function selectAllBookings() {
  if (USE_SUPABASE) {
    return supabaseRequest("/rest/v1/bookings?select=*&order=created_at.desc,id.desc");
  }

  return db
    .prepare(`
      SELECT
        id,
        name,
        phone,
        email,
        "package",
        group_size,
        preferred_date,
        preferred_time,
        extras,
        notes,
        admin_notes,
        status,
        created_at
      FROM bookings
      ORDER BY datetime(created_at) DESC, id DESC
    `)
    .all();
}

async function updateBookingStatus(status, bookingId) {
  if (USE_SUPABASE) {
    await supabaseRequest(`/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ status })
    });
    return;
  }

  db
    .prepare(`
      UPDATE bookings
      SET status = ?
      WHERE id = ?
    `)
    .run(status, bookingId);
}

async function deleteBooking(bookingId) {
  if (USE_SUPABASE) {
    await supabaseRequest(`/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal"
      }
    });
    return;
  }

  db.prepare("DELETE FROM bookings WHERE id = ?").run(bookingId);
}

async function updateBookingAdminNotes(adminNotes, bookingId) {
  if (USE_SUPABASE) {
    await supabaseRequest(`/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ admin_notes: adminNotes })
    });
    return;
  }

  db
    .prepare(`
      UPDATE bookings
      SET admin_notes = ?
      WHERE id = ?
    `)
    .run(adminNotes, bookingId);
}

async function selectBookingById(bookingId) {
  if (USE_SUPABASE) {
    const rows = await supabaseRequest(`/rest/v1/bookings?select=*&id=eq.${encodeURIComponent(bookingId)}&limit=1`);
    return rows[0] || null;
  }

  return db
    .prepare(`
      SELECT
        id,
        name,
        phone,
        email,
        "package",
        group_size,
        preferred_date,
        preferred_time,
        extras,
        notes,
        admin_notes,
        status,
        created_at
      FROM bookings
      WHERE id = ?
    `)
    .get(bookingId);
}

async function isConfirmedSlotFull(preferredDate, preferredTime, excludedBookingId = 0) {
  if (USE_SUPABASE) {
    const params = new URLSearchParams({
      select: "id",
      preferred_date: `eq.${preferredDate}`,
      preferred_time: `eq.${preferredTime}`,
      status: "eq.confirmed",
      id: `neq.${excludedBookingId}`,
      limit: String(BOOKING_SLOT_CAPACITY)
    });
    const rows = await supabaseRequest(`/rest/v1/bookings?${params.toString()}`);
    return rows.length >= BOOKING_SLOT_CAPACITY;
  }

  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM bookings
      WHERE preferred_date = ?
        AND preferred_time = ?
        AND status = 'confirmed'
        AND id != ?
    `)
    .get(preferredDate, preferredTime, excludedBookingId);

  return Number(row?.count || 0) >= BOOKING_SLOT_CAPACITY;
}

async function getBookingsPayload() {
  const rows = await selectAllBookings();
  const bookings = rows.map(serializeBooking);

  const summary = {
    total: bookings.length,
    pending: bookings.filter(booking => booking.status === "pending").length,
    confirmed: bookings.filter(booking => booking.status === "confirmed").length,
    cancelled: bookings.filter(booking => booking.status === "cancelled").length,
    completed: bookings.filter(booking => booking.status === "completed").length
  };

  return { bookings, summary };
}

function getBookingRulesPayload() {
  return {
    allowed_times: BOOKING_ALLOWED_TIMES,
    weekend_days: BOOKING_WEEKEND_DAYS,
    extra_open_dates: [...BOOKING_EXTRA_OPEN_DATES],
    slot_capacity: BOOKING_SLOT_CAPACITY,
    timezone: "Europe/Oslo"
  };
}

function serializeBooking(row) {
  return {
    ...row,
    extras: parseExtras(row.extras)
  };
}

function parseExtras(value) {
  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ensureColumn(tableName, columnName, columnDefinition) {
  if (!db) {
    return;
  }

  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some(column => column.name === columnName);

  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

async function supabaseRequest(pathname, init = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...init,
    headers: getSupabaseHeaders(init.headers)
  });

  const raw = await response.text();
  let payload = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("Supabase svarte med ugyldig JSON.");
    }
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error_description || payload?.hint || "Supabase-kall feilet.";
    throw new Error(message);
  }

  return payload || [];
}

function getSupabaseHeaders(extraHeaders = {}) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
    ...extraHeaders
  };

  if (!SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_")) {
    headers.Authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  }

  return headers;
}

function normalizeSupabaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDateList(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map(item => item.trim())
      .filter(isValidIsoDate)
  );
}

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function normalizeBookingInput(input) {
  const extras = Array.isArray(input?.extras)
    ? input.extras.map(item => String(item).trim()).filter(Boolean)
    : [];

  return {
    name: String(input?.name || "").trim(),
    phone: String(input?.phone || "").trim(),
    email: String(input?.email || "").trim(),
    package: String(input?.package || "").trim(),
    group_size: Number.parseInt(String(input?.group_size || "").trim(), 10),
    preferred_date: String(input?.preferred_date || "").trim(),
    preferred_time: String(input?.preferred_time || "").trim(),
    extras,
    notes: String(input?.notes || "").trim(),
    privacy_consent: input?.privacy_consent === true || input?.privacy_consent === "1",
    website: String(input?.website || "").trim()
  };
}

function validateBooking(booking) {
  if (booking.website) {
    return "Bookingforespørselen ble avvist.";
  }

  if (!booking.privacy_consent) {
    return "Du må bekrefte at opplysningene kan brukes til å behandle bookingforespørselen.";
  }

  if (
    !booking.name ||
    !booking.phone ||
    !booking.email ||
    !booking.package ||
    !booking.preferred_date ||
    !booking.preferred_time
  ) {
    return "Mangler påkrevde bookingfelter.";
  }

  if (!Number.isFinite(booking.group_size) || booking.group_size < BOOKING_GROUP_MIN || booking.group_size > BOOKING_GROUP_MAX) {
    return `Gruppestørrelse må være mellom ${BOOKING_GROUP_MIN} og ${BOOKING_GROUP_MAX}.`;
  }

  const packageRule = PACKAGE_RULES[booking.package];
  if (!packageRule) {
    return "Ugyldig pakkevalg.";
  }

  if (booking.group_size < packageRule.min) {
    return `Valgt pakke krever minst ${packageRule.min} personer.`;
  }

  if (packageRule.max && booking.group_size > packageRule.max) {
    return `Valgt pakke tillater maks ${packageRule.max} personer.`;
  }

  if (isPastDate(booking.preferred_date)) {
    return "Velg dagens dato eller en dato frem i tid.";
  }

  if (!BOOKING_ALLOWED_TIMES.includes(booking.preferred_time)) {
    return "Ugyldig tidspunkt.";
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(booking.email)) {
    return "Ugyldig e-postadresse.";
  }

  const phoneRegex = /^[\d\s+().-]{6,}$/;
  if (!phoneRegex.test(booking.phone)) {
    return "Ugyldig telefonnummer.";
  }

  return "";
}

function requiresAdminAuth(method, requestPath) {
  if (requestPath === "/admin.html") {
    return true;
  }

  if (requestPath === "/admin.css" || requestPath === "/admin.js") {
    return true;
  }

  if (method === "GET" && requestPath === "/api/bookings") {
    return true;
  }

  return (method === "PATCH" && /^\/api\/bookings\/\d+\/(status|admin-notes)$/.test(requestPath)) ||
    (method === "DELETE" && /^\/api\/bookings\/\d+$/.test(requestPath));
}

async function handleAdminPage(req, res) {
  if (!hasAdminCredentials()) {
    sendHtml(res, 200, renderAdminLoginPage({ configMissing: true }));
    return;
  }

  if (req.method === "POST") {
    const rawBody = await readRawBody(req);
    const form = parseFormBody(rawBody);
    const secureCookie = isSecureRequest(req);

    if (form.logout === "1") {
      sendRedirect(res, "/admin", [clearAdminSessionCookie({ secure: secureCookie })]);
      return;
    }

    if (verifyAdminCredentials(form.username || "", form.password || "")) {
      sendRedirect(res, "/admin", [createAdminSessionCookie({ secure: secureCookie })]);
      return;
    }

    sendHtml(res, 200, renderAdminLoginPage({ errorMessage: "Feil brukernavn eller passord." }));
    return;
  }

  if (!isAdminAuthorized(req)) {
    sendHtml(res, 200, renderAdminLoginPage());
    return;
  }

  return serveStatic("/admin", res);
}

function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https";
}

function isPastDate(value) {
  if (!isValidIsoDate(value)) {
    return true;
  }

  return value < getTodayIsoOslo();
}

function isValidIsoDate(value) {
  return Boolean(parseIsoDate(value));
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function getTodayIsoOslo() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function serveStatic(requestPath, res) {
  const routeMap = {
    "/": "index.html",
    "/booking": "booking.html",
    "/booking/": "booking.html",
    "/admin": "admin.html",
    "/booking.html": "booking.html",
    "/styles.css": "styles.css",
    "/script.js": "script.js",
    "/admin.css": "admin.css",
    "/admin.js": "admin.js",
    "/robots.txt": "robots.txt",
    "/sitemap.xml": "sitemap.xml"
  };

  let filePath = routeMap[requestPath];

  if (!filePath && requestPath.startsWith("/images/")) {
    filePath = path.join("images", requestPath.replace(/^\/images\//, ""));
  }

  if (!filePath) {
    sendJson(res, 404, { error: "Fant ikke fil." });
    return;
  }

  const resolvedPath = path.resolve(ROOT, filePath);
  if (!resolvedPath.startsWith(ROOT)) {
    sendJson(res, 403, { error: "Ugyldig sti." });
    return;
  }

  fs.readFile(resolvedPath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Fant ikke fil." });
      return;
    }

    res.writeHead(200, {
      ...getSecurityHeadersForPath(resolvedPath),
      "Content-Type": getContentType(resolvedPath)
    });
    res.end(data);
  });
}

function getSecurityHeadersForPath(filePath) {
  const basename = path.basename(filePath);
  return basename === "admin.html" ? NO_STORE_HEADERS : SECURITY_HEADERS;
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...NO_STORE_HEADERS,
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    ...NO_STORE_HEADERS,
    "Content-Type": "text/html; charset=utf-8"
  });
  res.end(html);
}

function sendRedirect(res, location, cookies = []) {
  const headers = {
    ...NO_STORE_HEADERS,
    Location: location
  };

  if (cookies.length > 0) {
    headers["Set-Cookie"] = cookies;
  }

  res.writeHead(303, headers);
  res.end();
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });

    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}
