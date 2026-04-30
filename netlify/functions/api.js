const crypto = require("node:crypto");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL || "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DEMO_MODE = process.env.DEMO_MODE === "1";

const VALID_STATUSES = ["pending", "confirmed", "cancelled", "completed"];
const BOOKING_GROUP_MIN = 10;
const BOOKING_GROUP_MAX = 100;
const BOOKING_ALLOWED_TIMES = ["10:00", "12:00", "14:00", "16:00", "18:00"];
const PACKAGE_RULES = {
  "Over 18 år": { min: 10, max: 24 },
  "Under 18 år": { min: 10, max: 24 },
  "Turnering / stor gruppe": { min: 25, max: 100 }
};

exports.handler = async event => {
  const apiPath = getApiPath(event);
  const method = event.httpMethod || "GET";

  try {
    if (method === "OPTIONS") {
      return json(204, {});
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, {
        error: "Supabase er ikke konfigurert. Sett SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY i Netlify."
      });
    }

    if (requiresAdminAuth(method, apiPath)) {
      if (!hasAdminCredentials()) {
        return json(500, {
          error: "Admin-login er ikke konfigurert. Sett ADMIN_USERNAME og ADMIN_PASSWORD i Netlify."
        });
      }

      if (!isAdminAuthorized(event.headers || {})) {
        return adminAuthResponse();
      }
    }

    if (method === "GET" && apiPath === "/api/bookings") {
      return json(200, await getBookingsPayload());
    }

    if (method === "POST" && apiPath === "/api/bookings") {
      const booking = normalizeBookingInput(parseBody(event));
      const validationError = validateBooking(booking);

      if (validationError) {
        return json(400, { error: validationError });
      }

      if (await hasConfirmedSlot(booking.preferred_date, booking.preferred_time)) {
        return json(409, {
          error: "Dette tidspunktet er allerede bekreftet. Velg et annet tidspunkt, eller kontakt oss direkte."
        });
      }

      const savedBooking = await insertBooking(booking, new Date().toISOString());

      return json(201, {
        message: "Booking saved.",
        booking: serializeBooking(savedBooking),
        notification: "Business notified via admin queue."
      });
    }

    const statusMatch = apiPath.match(/^\/api\/bookings\/(\d+)\/status$/);
    if (method === "PATCH" && statusMatch) {
      const bookingId = Number.parseInt(statusMatch[1], 10);
      const body = parseBody(event);
      const nextStatus = typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";

      if (!VALID_STATUSES.includes(nextStatus)) {
        return json(400, { error: "Ugyldig statusverdi." });
      }

      const existingBooking = await selectBookingById(bookingId);
      if (!existingBooking) {
        return json(404, { error: "Fant ikke booking." });
      }

      if (
        nextStatus === "confirmed" &&
        (await hasConfirmedSlot(existingBooking.preferred_date, existingBooking.preferred_time, bookingId))
      ) {
        return json(409, {
          error: "En annen booking er allerede bekreftet på samme dato og tidspunkt."
        });
      }

      await updateBooking(bookingId, { status: nextStatus });
      const updatedBooking = await selectBookingById(bookingId);

      return json(200, {
        message: "Status updated.",
        booking: serializeBooking(updatedBooking)
      });
    }

    const noteMatch = apiPath.match(/^\/api\/bookings\/(\d+)\/admin-notes$/);
    if (method === "PATCH" && noteMatch) {
      const bookingId = Number.parseInt(noteMatch[1], 10);
      const body = parseBody(event);
      const adminNotes = String(body?.admin_notes || "").trim();

      if (adminNotes.length > 2000) {
        return json(400, { error: "Internt notat kan maks være 2000 tegn." });
      }

      const existingBooking = await selectBookingById(bookingId);
      if (!existingBooking) {
        return json(404, { error: "Fant ikke booking." });
      }

      await updateBooking(bookingId, { admin_notes: adminNotes });
      const updatedBooking = await selectBookingById(bookingId);

      return json(200, {
        message: "Admin note updated.",
        booking: serializeBooking(updatedBooking)
      });
    }

    if (method === "POST" && apiPath === "/api/demo/seed") {
      if (!DEMO_MODE) {
        return json(404, { error: "Demo-data er ikke aktivert for denne serveren." });
      }

      const result = await seedDemoBookings();

      return json(200, {
        message: "Demo-data er lastet inn.",
        ...result,
        ...(await getBookingsPayload())
      });
    }

    return json(404, { error: "Fant ikke ressurs." });
  } catch (error) {
    console.error(error);
    return json(500, { error: "Intern serverfeil." });
  }
};

async function insertBooking(booking, createdAt) {
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

async function selectAllBookings() {
  return supabaseRequest("/rest/v1/bookings?select=*&order=created_at.desc,id.desc");
}

async function selectBookingById(bookingId) {
  const rows = await supabaseRequest(`/rest/v1/bookings?select=*&id=eq.${encodeURIComponent(bookingId)}&limit=1`);
  return rows[0] || null;
}

async function updateBooking(bookingId, patch) {
  await supabaseRequest(`/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify(patch)
  });
}

async function hasConfirmedSlot(preferredDate, preferredTime, excludedBookingId = 0) {
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

async function getBookingsPayload() {
  const rows = await selectAllBookings();
  const bookings = rows.map(serializeBooking);

  return {
    bookings,
    summary: {
      total: bookings.length,
      pending: bookings.filter(booking => booking.status === "pending").length,
      confirmed: bookings.filter(booking => booking.status === "confirmed").length,
      cancelled: bookings.filter(booking => booking.status === "cancelled").length,
      completed: bookings.filter(booking => booking.status === "completed").length
    }
  };
}

async function seedDemoBookings() {
  await supabaseRequest("/rest/v1/bookings?email=like.*%40demo.oslopaintball.no", {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal"
    }
  });

  const rows = await supabaseRequest("/rest/v1/bookings", {
    method: "POST",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify(getDemoBookings())
  });

  return {
    inserted: rows.length,
    deleted: 0
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
    notes: String(input?.notes || "").trim()
  };
}

function validateBooking(booking) {
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

function requiresAdminAuth(method, apiPath) {
  if (method === "GET" && apiPath === "/api/bookings") {
    return true;
  }

  if (method === "POST" && apiPath === "/api/demo/seed") {
    return true;
  }

  return method === "PATCH" && /^\/api\/bookings\/\d+\/(status|admin-notes)$/.test(apiPath);
}

function isAdminAuthorized(headers) {
  if (!hasAdminCredentials()) {
    return false;
  }

  const header = headers.authorization || headers.Authorization || "";
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

function adminAuthResponse() {
  return {
    statusCode: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Oslo Paintball Admin"',
      "Content-Type": "text/plain; charset=utf-8"
    },
    body: "Admin login kreves."
  };
}

function getApiPath(event) {
  const path = event.path || "";
  const marker = "/.netlify/functions/api";

  if (path.startsWith(marker)) {
    const rest = path.slice(marker.length);
    return `/api${rest || ""}`;
  }

  if (path.startsWith("/api")) {
    return path;
  }

  return "/api";
}

function parseBody(event) {
  if (!event.body) {
    return {};
  }

  const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(body);
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

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: statusCode === 204 ? "" : JSON.stringify(payload)
  };
}

function normalizeSupabaseUrl(value) {
  return value.replace(/\/+$/, "");
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

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
