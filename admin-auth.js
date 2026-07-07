const crypto = require("node:crypto");

const ADMIN_SESSION_COOKIE = "op_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

function hasAdminCredentials() {
  const credentials = getAdminCredentials();
  return Boolean(credentials.username && credentials.password);
}

function verifyAdminCredentials(username, password) {
  const credentials = getAdminCredentials();

  return Boolean(credentials.username && credentials.password) &&
    safeEqual(username, credentials.username) &&
    safeEqual(password, credentials.password);
}

function isAdminAuthorized(source) {
  return isAdminSessionAuthorized(source) || isBasicAdminAuthorized(source);
}

function isBasicAdminAuthorized(source) {
  if (!hasAdminCredentials()) {
    return false;
  }

  const header = getHeader(getHeaders(source), "authorization");
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

  return verifyAdminCredentials(
    decoded.slice(0, separatorIndex),
    decoded.slice(separatorIndex + 1)
  );
}

function isAdminSessionAuthorized(source) {
  if (!hasAdminCredentials()) {
    return false;
  }

  const token = parseCookies(source)[ADMIN_SESSION_COOKIE] || "";
  const separatorIndex = token.lastIndexOf(".");

  if (separatorIndex === -1) {
    return false;
  }

  const payload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = signSessionPayload(payload);

  if (!safeEqual(signature, expectedSignature)) {
    return false;
  }

  let session = null;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  const expiresAt = Number(session && session.exp ? session.exp : 0);
  const username = String(session && session.username ? session.username : "");
  const now = Math.floor(Date.now() / 1000);

  return expiresAt > now && verifyAdminCredentials(username, getAdminCredentials().password);
}

function createAdminSessionCookie(options = {}) {
  const credentials = getAdminCredentials();
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const payload = Buffer
    .from(JSON.stringify({ v: 1, username: credentials.username, exp: expiresAt }), "utf8")
    .toString("base64url");
  const signature = signSessionPayload(payload);

  return serializeCookie(payload + "." + signature, ADMIN_SESSION_TTL_SECONDS, options.secure !== false);
}

function clearAdminSessionCookie(options = {}) {
  return serializeCookie("", 0, options.secure !== false);
}

function serializeCookie(value, maxAge, secure) {
  const parts = [
    ADMIN_SESSION_COOKIE + "=" + value,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=" + maxAge
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function parseFormBody(raw) {
  const params = new URLSearchParams(raw || "");
  return Object.fromEntries(params.entries());
}

function renderAdminLoginPage(options = {}) {
  const errorMessage = options.errorMessage || "";
  const configMissing = options.configMissing || false;
  const message = configMissing
    ? "Admin-login er ikke konfigurert. Sett ADMIN_USERNAME og ADMIN_PASSWORD."
    : errorMessage;
  const messageMarkup = message
    ? "          <div class=\"message\" role=\"alert\">" + escapeHtml(message) + "</div>"
    : "";

  return [
    "<!DOCTYPE html>",
    "<html lang=\"no\">",
    "  <head>",
    "    <meta charset=\"UTF-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    "    <title>Oslo Paintball - Logg inn</title>",
    "    <link href=\"https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\" />",
    "    <style>",
    "      :root {",
    "        --red: #e8191a;",
    "        --red-dark: #ab1010;",
    "        --black: #090909;",
    "        --panel: rgba(18, 18, 18, 0.9);",
    "        --line: rgba(255, 255, 255, 0.12);",
    "        --text: #f3f3f3;",
    "        --muted: #b8b8b8;",
    "      }",
    "",
    "      * {",
    "        box-sizing: border-box;",
    "        margin: 0;",
    "        padding: 0;",
    "      }",
    "",
    "      body {",
    "        min-height: 100vh;",
    "        background:",
    "          linear-gradient(90deg, rgba(9, 9, 9, 0.96), rgba(9, 9, 9, 0.82) 46%, rgba(9, 9, 9, 0.42)),",
    "          url(\"/images/116433177_3278678005553401_288044754070243789_n.webp\") center / cover;",
    "        color: var(--text);",
    "        font-family: \"Barlow\", system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
    "        line-height: 1.5;",
    "      }",
    "",
    "      main {",
    "        display: grid;",
    "        align-items: center;",
    "        min-height: 100vh;",
    "        padding: 32px;",
    "      }",
    "",
    "      .login-shell {",
    "        width: min(100%, 440px);",
    "      }",
    "",
    "      .logo {",
    "        display: inline-flex;",
    "        align-items: baseline;",
    "        gap: 3px;",
    "        margin-bottom: 34px;",
    "        color: #fff;",
    "        font-family: \"Bebas Neue\", sans-serif;",
    "        font-size: 36px;",
    "        letter-spacing: 2px;",
    "        line-height: 1;",
    "        text-decoration: none;",
    "      }",
    "",
    "      .logo span {",
    "        color: var(--red);",
    "      }",
    "",
    "      .login-card {",
    "        width: 100%;",
    "        padding: 30px;",
    "        background: var(--panel);",
    "        border: 1px solid var(--line);",
    "        border-radius: 8px;",
    "        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);",
    "        backdrop-filter: blur(14px);",
    "      }",
    "",
    "      .kicker {",
    "        color: var(--red);",
    "        font-size: 12px;",
    "        font-weight: 800;",
    "        letter-spacing: 1.2px;",
    "        text-transform: uppercase;",
    "      }",
    "",
    "      h1 {",
    "        margin-top: 8px;",
    "        font-size: clamp(34px, 8vw, 52px);",
    "        font-weight: 800;",
    "        line-height: 0.96;",
    "        letter-spacing: 0;",
    "        text-transform: uppercase;",
    "      }",
    "",
    "      p {",
    "        margin-top: 14px;",
    "        color: var(--muted);",
    "        font-size: 15px;",
    "      }",
    "",
    "      form {",
    "        display: grid;",
    "        gap: 16px;",
    "        margin-top: 26px;",
    "      }",
    "",
    "      label {",
    "        display: grid;",
    "        gap: 7px;",
    "        color: #fff;",
    "        font-size: 13px;",
    "        font-weight: 700;",
    "      }",
    "",
    "      input {",
    "        width: 100%;",
    "        min-height: 48px;",
    "        padding: 12px 14px;",
    "        border: 1px solid rgba(255, 255, 255, 0.18);",
    "        border-radius: 4px;",
    "        background: rgba(255, 255, 255, 0.08);",
    "        color: #fff;",
    "        font: inherit;",
    "        outline: none;",
    "      }",
    "",
    "      input:focus {",
    "        border-color: var(--red);",
    "        box-shadow: 0 0 0 3px rgba(232, 25, 26, 0.18);",
    "      }",
    "",
    "      button {",
    "        min-height: 50px;",
    "        margin-top: 4px;",
    "        border: 0;",
    "        border-radius: 4px;",
    "        background: var(--red);",
    "        color: #fff;",
    "        font: inherit;",
    "        font-weight: 800;",
    "        cursor: pointer;",
    "      }",
    "",
    "      button:hover {",
    "        background: var(--red-dark);",
    "      }",
    "",
    "      .message {",
    "        margin-top: 18px;",
    "        padding: 12px 14px;",
    "        border: 1px solid rgba(232, 25, 26, 0.32);",
    "        border-radius: 4px;",
    "        background: rgba(232, 25, 26, 0.12);",
    "        color: #fff;",
    "        font-size: 14px;",
    "        font-weight: 700;",
    "      }",
    "",
    "      .back-link {",
    "        display: inline-flex;",
    "        margin-top: 18px;",
    "        color: var(--muted);",
    "        font-size: 13px;",
    "        font-weight: 700;",
    "        text-decoration: none;",
    "      }",
    "",
    "      .back-link:hover {",
    "        color: #fff;",
    "      }",
    "",
    "      @media (max-width: 640px) {",
    "        body {",
    "          background:",
    "            linear-gradient(180deg, rgba(9, 9, 9, 0.92), rgba(9, 9, 9, 0.86)),",
    "            url(\"/images/116433177_3278678005553401_288044754070243789_n.webp\") center / cover;",
    "        }",
    "",
    "        main {",
    "          padding: 18px;",
    "        }",
    "",
    "        .logo {",
    "          margin-bottom: 22px;",
    "          font-size: 30px;",
    "        }",
    "",
    "        .login-card {",
    "          padding: 22px;",
    "        }",
    "      }",
    "    </style>",
    "  </head>",
    "  <body>",
    "    <main>",
    "      <section class=\"login-shell\" aria-label=\"Admin login\">",
    "        <a class=\"logo\" href=\"/\">OSLO <span>PAINTBALL</span></a>",
    "        <div class=\"login-card\">",
    "          <div class=\"kicker\">Bookingadmin</div>",
    "          <h1>Logg inn</h1>",
    "          <p>Logg inn for å følge opp bookinger, status og interne notater.</p>",
    "          <form method=\"post\" action=\"/admin\">",
    "            <label>",
    "              Brukernavn",
    "              <input name=\"username\" autocomplete=\"username\" required autofocus />",
    "            </label>",
    "            <label>",
    "              Passord",
    "              <input name=\"password\" type=\"password\" autocomplete=\"current-password\" required />",
    "            </label>",
    "            <button type=\"submit\">Logg inn</button>",
    "          </form>",
    messageMarkup,
    "          <a class=\"back-link\" href=\"/\">Tilbake til nettsiden</a>",
    "        </div>",
    "      </section>",
    "    </main>",
    "  </body>",
    "</html>"
  ].join("\n");
}

function getAdminCredentials() {
  return {
    username: process.env.ADMIN_USERNAME || "",
    password: process.env.ADMIN_PASSWORD || ""
  };
}

function getHeaders(source) {
  return source && source.headers ? source.headers : source || {};
}

function getHeader(headers, name) {
  const lowerName = name.toLowerCase();

  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === lowerName) {
      return String(headers[key] || "");
    }
  }

  return "";
}

function parseCookies(source) {
  const cookieHeader = getHeader(getHeaders(source), "cookie");
  const cookies = {};

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key) {
      cookies[key] = value;
    }
  }

  return cookies;
}

function signSessionPayload(payload) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

module.exports = {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  hasAdminCredentials,
  isAdminAuthorized,
  parseFormBody,
  renderAdminLoginPage,
  verifyAdminCredentials
};
