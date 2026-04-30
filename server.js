const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;
loadLocalEnv(path.join(ROOT, ".env"));

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "bookings.db");
const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL || "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const IS_LOCAL_DEV = !USE_SUPABASE && process.env.NODE_ENV !== "production";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || (IS_LOCAL_DEV ? "admin" : "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_LOCAL_DEV ? "paintball2026" : "");
const DEMO_MODE = !USE_SUPABASE && process.env.DEMO_MODE !== "0";
const VALID_STATUSES = ["pending", "confirmed", "cancelled", "completed"];
const BOOKING_GROUP_MIN = 10;
const BOOKING_GROUP_MAX = 100;
const BOOKING_ALLOWED_TIMES = ["10:00", "12:00", "14:00", "16:00", "18:00"];
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
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'cancelled', 'completed')),
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn("bookings", "admin_notes", "TEXT NOT NULL DEFAULT ''");
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (requiresAdminAuth(req.method, requestUrl.pathname)) {
      if (!hasAdminCredentials()) {
        return sendJson(res, 500, {
          error: "Admin-login er ikke konfigurert. Sett ADMIN_USERNAME og ADMIN_PASSWORD."
        });
      }

      if (!isAdminAuthorized(req)) {
        return requestAdminAuth(res);
      }
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

      if (await hasConfirmedSlot(booking.preferred_date, booking.preferred_time)) {
        return sendJson(res, 409, {
          error: "Dette tidspunktet er allerede bekreftet. Velg et annet tidspunkt, eller kontakt oss direkte."
        });
      }

      const createdAt = new Date().toISOString();
      const savedBooking = await insertBooking(booking, createdAt);

      console.log(
        `[BOOKING] New booking #${savedBooking.id} from ${savedBooking.name} for ${savedBooking.preferred_date} ${savedBooking.preferred_time}`
      );

      return sendJson(res, 201, {
        message: "Booking saved.",
        booking: serializeBooking(savedBooking),
        notification: "Business notified via admin queue and server log."
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
        (await hasConfirmedSlot(existingBooking.preferred_date, existingBooking.preferred_time, bookingId))
      ) {
        return sendJson(res, 409, {
          error: "En annen booking er allerede bekreftet på samme dato og tidspunkt."
        });
      }

      await updateBookingStatus(nextStatus, bookingId);
      const updatedBooking = await selectBookingById(bookingId);

      if (!updatedBooking) {
        return sendJson(res, 404, { error: "Fant ikke booking." });
      }

      return sendJson(res, 200, {
        message: "Status updated.",
        booking: serializeBooking(updatedBooking)
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

    if (req.method === "POST" && requestUrl.pathname === "/api/demo/seed") {
      if (!DEMO_MODE) {
        return sendJson(res, 404, { error: "Demo-data er ikke aktivert for denne serveren." });
      }

      const result = await seedDemoBookings();

      return sendJson(res, 200, {
        message: "Demo-data er lastet inn.",
        ...result,
        ...(await getBookingsPayload())
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
  console.log(`Demo mode: ${DEMO_MODE ? "enabled" : "disabled"}`);
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
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
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

async function hasConfirmedSlot(preferredDate, preferredTime, excludedBookingId = 0) {
  if (USE_SUPABASE) {
    const params = new URLSearchParams({
      select: "id",
      preferred_date: `eq.${preferredDate}`,
      preferred_time: `eq.${preferredTime}`,
      status: "eq.confirmed",
      id: `neq.${excludedBookingId}`,
      limit: "1"
    });
    const rows = await supabaseRequest(`/rest/v1/bookings?${params.toString()}`);
    return rows.length > 0;
  }

  const row = db
    .prepare(`
      SELECT id
      FROM bookings
      WHERE preferred_date = ?
        AND preferred_time = ?
        AND status = 'confirmed'
        AND id != ?
      LIMIT 1
    `)
    .get(preferredDate, preferredTime, excludedBookingId);

  return Boolean(row);
}

async function seedDemoBookings() {
  if (USE_SUPABASE || !db) {
    return { inserted: 0, deleted: 0 };
  }

  const deleted = db.prepare("DELETE FROM bookings WHERE email LIKE ?").run("%@demo.oslopaintball.no");
  const demoBookings = getDemoBookings();

  const insertDemoBooking = db.prepare(`
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
      admin_notes,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const booking of demoBookings) {
    insertDemoBooking.run(
      booking.name,
      booking.phone,
      booking.email,
      booking.package,
      booking.group_size,
      booking.preferred_date,
      booking.preferred_time,
      JSON.stringify(booking.extras),
      booking.notes,
      booking.admin_notes,
      booking.status,
      booking.created_at
    );
  }

  return {
    inserted: demoBookings.length,
    deleted: deleted.changes || 0
  };
}

function getDemoBookings() {
  const now = Date.now();

  return [
    {
      name: "Kari Hansen",
      phone: "920 47 177",
      email: "kari.hansen@demo.oslopaintball.no",
      package: "Over 18 år",
      group_size: 14,
      preferred_date: addDaysIso(7),
      preferred_time: "12:00",
      extras: ["Ekstra 200 baller"],
      notes: "Bedriftsgruppe som ønsker en enkel kickoff. Ring helst mellom 10 og 14.",
      admin_notes: "Demo: ring kunden, bekreft antall og spør om faktura.",
      status: "pending",
      created_at: new Date(now - 18 * 60 * 1000).toISOString()
    },
    {
      name: "Marius Solberg",
      phone: "944 44 444",
      email: "marius.solberg@demo.oslopaintball.no",
      package: "Under 18 år",
      group_size: 12,
      preferred_date: addDaysIso(10),
      preferred_time: "14:00",
      extras: ["Engangsdress"],
      notes: "Bursdag for 13-åringer. Foreldre blir med som tilskuere.",
      admin_notes: "Demo: allerede bekreftet. Husk ekstra sikkerhetsgjennomgang.",
      status: "confirmed",
      created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString()
    },
    {
      name: "Nora Bakken",
      phone: "988 88 888",
      email: "nora.bakken@demo.oslopaintball.no",
      package: "Turnering / stor gruppe",
      group_size: 42,
      preferred_date: addDaysIso(14),
      preferred_time: "16:00",
      extras: ["Ekstra 200 baller"],
      notes: "Ønsker turneringsoppsett med finale og laginndeling.",
      admin_notes: "Demo: sjekk bemanning før bekreftelse.",
      status: "pending",
      created_at: new Date(now - 5 * 60 * 60 * 1000).toISOString()
    },
    {
      name: "Anders Moen",
      phone: "977 77 777",
      email: "anders.moen@demo.oslopaintball.no",
      package: "Over 18 år",
      group_size: 18,
      preferred_date: addDaysIso(18),
      preferred_time: "10:00",
      extras: [],
      notes: "Utdrikningslag. Ønsker rask avklaring på om tidspunktet passer.",
      admin_notes: "Demo: kunden avlyste per telefon.",
      status: "cancelled",
      created_at: new Date(now - 24 * 60 * 60 * 1000).toISOString()
    },
    {
      name: "Elin Nilsen",
      phone: "966 66 666",
      email: "elin.nilsen@demo.oslopaintball.no",
      package: "Under 18 år",
      group_size: 16,
      preferred_date: addDaysIso(21),
      preferred_time: "18:00",
      extras: ["Ekstra 200 baller", "Engangsdress"],
      notes: "Skolegruppe som ønsker et rolig opplegg med tydelig instruktør.",
      admin_notes: "Demo: fullført demo-case for å vise historikk.",
      status: "completed",
      created_at: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];
}

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
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
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
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

function normalizeSupabaseUrl(value) {
  return value.replace(/\/+$/, "");
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
    website: String(input?.website || "").trim()
  };
}

function validateBooking(booking) {
  if (booking.website) {
    return "Bookingforespørselen ble avvist.";
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
  if (requestPath === "/admin" || requestPath === "/admin/" || requestPath === "/admin.html") {
    return true;
  }

  if (requestPath === "/admin.css" || requestPath === "/admin.js") {
    return true;
  }

  if (method === "GET" && requestPath === "/api/bookings") {
    return true;
  }

  if (method === "POST" && requestPath === "/api/demo/seed") {
    return true;
  }

  return method === "PATCH" && /^\/api\/bookings\/\d+\/(status|admin-notes)$/.test(requestPath);
}

function isAdminAuthorized(req) {
  if (!hasAdminCredentials()) {
    return false;
  }

  const header = req.headers.authorization || "";
  const match = header.match(/^Basic\s+(.+)$/i);

  if (!match) {
    return false;
  }

  let decoded = "";
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return false;
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return safeEqual(username, ADMIN_USERNAME) && safeEqual(password, ADMIN_PASSWORD);
}

function hasAdminCredentials() {
  return Boolean(ADMIN_USERNAME && ADMIN_PASSWORD);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requestAdminAuth(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Oslo Paintball Admin"',
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end("Admin login kreves.");
}

function isPastDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return true;
  }

  const selected = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Number.isNaN(selected.getTime()) || selected < today;
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
    "/admin.js": "admin.js"
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
      "Content-Type": getContentType(resolvedPath)
    });
    res.end(data);
  });
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
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
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
