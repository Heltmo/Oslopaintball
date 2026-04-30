const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

exports.handler = async event => {
  if (!hasAdminCredentials()) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      },
      body: "Admin-login er ikke konfigurert. Sett ADMIN_USERNAME og ADMIN_PASSWORD i Netlify."
    };
  }

  if (!isAdminAuthorized(event.headers || {})) {
    return {
      statusCode: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Oslo Paintball Admin"',
        "Content-Type": "text/plain; charset=utf-8"
      },
      body: "Admin login kreves."
    };
  }

  const adminHtmlPath = path.join(process.cwd(), "admin.html");
  const html = fs.readFileSync(adminHtmlPath, "utf8");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8"
    },
    body: html
  };
};

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
