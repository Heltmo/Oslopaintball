const DEFAULT_BUSINESS_NAME = "Oslo Paintball";
const DEFAULT_TIMEOUT_MS = 8000;

async function notifyNewBooking(booking, options = {}) {
  const config = getNotificationConfig(options.env || process.env);
  const details = getBookingDetails(booking, config);
  const jobs = [];

  if (config.email.enabled) {
    jobs.push({
      channel: "email",
      recipient: "customer",
      run: () => sendEmail(config, {
        to: booking.email,
        subject: `${config.businessName}: bookingforespørsel mottatt`,
        text: [
          `Hei ${booking.name}.`,
          "",
          `Vi har mottatt bookingforespørselen deres hos ${config.businessName}.`,
          "Dette er ikke endelig bekreftelse. Vi tar kontakt for å bekrefte tilgjengelighet og detaljer.",
          "",
          details.text,
          "",
          "Betaling skjer på stedet."
        ].join("\n"),
        html: bookingEmailHtml(
          config,
          "Bookingforespørsel mottatt",
          [
            `Hei ${booking.name}.`,
            `Vi har mottatt bookingforespørselen deres hos ${config.businessName}.`,
            "Dette er ikke endelig bekreftelse. Vi tar kontakt for å bekrefte tilgjengelighet og detaljer.",
            "Betaling skjer på stedet."
          ],
          details.html
        )
      })
    });

    if (config.adminEmail) {
      jobs.push({
        channel: "email",
        recipient: "admin",
        run: () => sendEmail(config, {
          to: config.adminEmail,
          replyTo: booking.email,
          subject: `Ny bookingforespørsel #${booking.id || ""} - ${booking.name}`,
          text: [
            `Ny bookingforespørsel fra ${booking.name}.`,
            "",
            details.text,
            "",
            `Telefon: ${booking.phone}`,
            `E-post: ${booking.email}`,
            booking.notes ? `Melding: ${booking.notes}` : "",
            config.adminUrl ? `Admin: ${config.adminUrl}` : ""
          ].filter(Boolean).join("\n"),
          html: bookingEmailHtml(
            config,
            `Ny bookingforespørsel #${booking.id || ""}`,
            [
              `Kunde: ${booking.name}`,
              `Telefon: ${booking.phone}`,
              `E-post: ${booking.email}`,
              booking.notes ? `Melding: ${booking.notes}` : "",
              config.adminUrl ? `<a href="${escapeAttribute(config.adminUrl)}">Åpne admin</a>` : ""
            ].filter(Boolean),
            details.html
          )
        })
      });
    }
  }

  if (config.sms.enabled) {
    jobs.push({
      channel: "sms",
      recipient: "customer",
      run: () => sendSms(config, booking.phone, `${config.businessName}: Vi har mottatt bookingforespørselen for ${booking.preferred_date} kl. ${booking.preferred_time}. Vi tar kontakt for endelig bekreftelse.`)
    });

    if (config.adminPhone) {
      jobs.push({
        channel: "sms",
        recipient: "admin",
        run: () => sendSms(config, config.adminPhone, `Ny ${config.businessName}-booking #${booking.id || ""}: ${booking.name}, ${booking.group_size} pers, ${booking.preferred_date} kl. ${booking.preferred_time}.`)
      });
    }
  }

  return runNotificationJobs("new_booking", jobs, options.logger);
}

async function notifyBookingConfirmed(booking, options = {}) {
  const config = getNotificationConfig(options.env || process.env);
  const details = getBookingDetails(booking, config, { includeCalendar: true });
  const jobs = [];

  if (config.email.enabled) {
    jobs.push({
      channel: "email",
      recipient: "customer",
      run: () => sendEmail(config, {
        to: booking.email,
        subject: `${config.businessName}: booking bekreftet`,
        text: [
          `Hei ${booking.name}.`,
          "",
          `Bookingen deres hos ${config.businessName} er bekreftet.`,
          "",
          details.text,
          "",
          "Betaling skjer på stedet."
        ].join("\n"),
        html: bookingEmailHtml(
          config,
          "Booking bekreftet",
          [
            `Hei ${booking.name}.`,
            `Bookingen deres hos ${config.businessName} er bekreftet.`,
            "Betaling skjer på stedet."
          ],
          details.html
        )
      })
    });
  }

  if (config.sms.enabled) {
    jobs.push({
      channel: "sms",
      recipient: "customer",
      run: () => sendSms(config, booking.phone, `${config.businessName}: Bookingen er bekreftet for ${booking.preferred_date} kl. ${booking.preferred_time}. Betaling skjer på stedet.`)
    });
  }

  return runNotificationJobs("booking_confirmed", jobs, options.logger);
}

function getNotificationConfig(env) {
  const publicUrl = trimTrailingSlash(env.PUBLIC_SITE_URL || env.URL || "");

  return {
    businessName: env.BOOKING_BUSINESS_NAME || DEFAULT_BUSINESS_NAME,
    publicUrl,
    adminUrl: env.ADMIN_URL || (publicUrl ? `${publicUrl}/admin` : ""),
    adminEmail: env.ADMIN_NOTIFY_EMAIL || "",
    adminPhone: env.ADMIN_NOTIFY_PHONE || "",
    location: env.BOOKING_LOCATION || "Oslo Paintball, Stuaveien, 1480 Slattum",
    eventDurationMinutes: parsePositiveInteger(env.BOOKING_EVENT_DURATION_MINUTES, 120),
    timeoutMs: parsePositiveInteger(env.NOTIFICATION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    email: {
      enabled: Boolean(env.RESEND_API_KEY && (env.BOOKING_FROM_EMAIL || env.RESEND_FROM_EMAIL)),
      apiKey: env.RESEND_API_KEY || "",
      from: env.BOOKING_FROM_EMAIL || env.RESEND_FROM_EMAIL || "",
      replyTo: env.BOOKING_REPLY_TO_EMAIL || env.ADMIN_NOTIFY_EMAIL || ""
    },
    sms: {
      enabled: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER),
      accountSid: env.TWILIO_ACCOUNT_SID || "",
      authToken: env.TWILIO_AUTH_TOKEN || "",
      from: env.TWILIO_FROM_NUMBER || ""
    }
  };
}

async function runNotificationJobs(event, jobs, logger = console) {
  if (!jobs.length) {
    return {
      event,
      results: [{ channel: "none", recipient: "none", status: "skipped", reason: "No notification provider configured." }]
    };
  }

  const results = await Promise.all(jobs.map(async job => {
    try {
      await job.run();
      return { channel: job.channel, recipient: job.recipient, status: "sent" };
    } catch (error) {
      logger?.warn?.(`[NOTIFICATION] ${event} ${job.channel}/${job.recipient} failed: ${error.message}`);
      return { channel: job.channel, recipient: job.recipient, status: "failed", reason: error.message };
    }
  }));

  return { event, results };
}

async function sendEmail(config, email) {
  const payload = {
    from: config.email.from,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html
  };

  if (email.replyTo || config.email.replyTo) {
    payload.reply_to = email.replyTo || config.email.replyTo;
  }

  const response = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.email.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, config.timeoutMs);

  await assertOk(response, "Resend");
}

async function sendSms(config, rawTo, body) {
  const to = normalizeNorwegianPhone(rawTo);
  if (!to) {
    throw new Error("Telefonnummer må være norsk eller E.164-formatert for SMS.");
  }

  const params = new URLSearchParams({
    From: config.sms.from,
    To: to,
    Body: body
  });
  const auth = Buffer.from(`${config.sms.accountSid}:${config.sms.authToken}`).toString("base64");
  const response = await fetchWithTimeout(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.sms.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    },
    config.timeoutMs
  );

  await assertOk(response, "Twilio");
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function assertOk(response, providerName) {
  if (response.ok) {
    return;
  }

  const raw = await response.text();
  let message = raw.slice(0, 240);

  try {
    const parsed = raw ? JSON.parse(raw) : null;
    message = parsed?.message || parsed?.error || parsed?.errors?.[0]?.message || message;
  } catch {
    // Keep raw provider text.
  }

  throw new Error(`${providerName} svarte ${response.status}: ${message || "ukjent feil"}`);
}

function getBookingDetails(booking, config, options = {}) {
  const extras = Array.isArray(booking.extras) && booking.extras.length ? booking.extras.join(", ") : "Ingen tillegg";
  const notes = booking.notes || "Ingen kundemelding.";
  const calendarUrl = options.includeCalendar ? getGoogleCalendarUrl(booking, config) : "";
  const text = [
    `Pakke: ${booking.package}`,
    `Dato/tid: ${booking.preferred_date} kl. ${booking.preferred_time}`,
    `Antall: ${booking.group_size} personer`,
    `Sted: ${config.location}`,
    `Tillegg: ${extras}`,
    `Melding: ${notes}`,
    calendarUrl ? `Kalender: ${calendarUrl}` : ""
  ].filter(Boolean).join("\n");
  const html = `
    <dl>
      <dt>Pakke</dt><dd>${escapeHtml(booking.package)}</dd>
      <dt>Dato/tid</dt><dd>${escapeHtml(booking.preferred_date)} kl. ${escapeHtml(booking.preferred_time)}</dd>
      <dt>Antall</dt><dd>${escapeHtml(booking.group_size)} personer</dd>
      <dt>Sted</dt><dd>${escapeHtml(config.location)}</dd>
      <dt>Tillegg</dt><dd>${escapeHtml(extras)}</dd>
      <dt>Melding</dt><dd>${escapeHtml(notes)}</dd>
    </dl>
    ${calendarUrl ? `<p><a href="${escapeAttribute(calendarUrl)}">Legg til i Google Kalender</a></p>` : ""}
    ${config.publicUrl ? `<p><a href="${escapeAttribute(config.publicUrl)}">${escapeHtml(config.businessName)}</a></p>` : ""}
  `;

  return { text, html };
}

function getGoogleCalendarUrl(booking, config) {
  const date = String(booking.preferred_date || "").trim();
  const time = String(booking.preferred_time || "").trim();
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);

  if (!dateMatch || !timeMatch) {
    return "";
  }

  const year = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2], 10);
  const day = Number.parseInt(dateMatch[3], 10);
  const hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2], 10);
  const end = new Date(Date.UTC(year, month - 1, day, hour, minute + config.eventDurationMinutes));
  const startStamp = `${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}T${timeMatch[1]}${timeMatch[2]}00`;
  const endStamp = [
    end.getUTCFullYear(),
    String(end.getUTCMonth() + 1).padStart(2, "0"),
    String(end.getUTCDate()).padStart(2, "0")
  ].join("") + `T${String(end.getUTCHours()).padStart(2, "0")}${String(end.getUTCMinutes()).padStart(2, "0")}00`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${config.businessName}: ${booking.package}`,
    dates: `${startStamp}/${endStamp}`,
    details: [
      `Booking hos ${config.businessName}`,
      `Pakke: ${booking.package}`,
      `Antall: ${booking.group_size} personer`,
      "Betaling skjer på stedet."
    ].join("\n"),
    location: config.location,
    ctz: "Europe/Oslo"
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function bookingEmailHtml(config, title, paragraphs, detailsHtml) {
  return `
    <!doctype html>
    <html lang="no">
      <body style="font-family:Arial,sans-serif;color:#1d1d1d;line-height:1.5;">
        <h1>${escapeHtml(title)}</h1>
        ${paragraphs.map(paragraph => paragraph.startsWith("<a ") ? `<p>${paragraph}</p>` : `<p>${escapeHtml(paragraph)}</p>`).join("")}
        ${detailsHtml}
        <p>Hilsen ${escapeHtml(config.businessName)}</p>
      </body>
    </html>
  `;
}

function normalizeNorwegianPhone(value) {
  const input = String(value || "").trim();
  if (!input) {
    return "";
  }

  if (input.startsWith("+")) {
    return `+${input.slice(1).replace(/\D/g, "")}`;
  }

  const digits = input.replace(/\D/g, "");
  if (digits.length === 8) {
    return `+47${digits}`;
  }

  if (digits.startsWith("47") && digits.length === 10) {
    return `+${digits}`;
  }

  if (digits.startsWith("00") && digits.length > 4) {
    return `+${digits.slice(2)}`;
  }

  return "";
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

module.exports = {
  getNotificationConfig,
  notifyBookingConfirmed,
  notifyNewBooking
};
