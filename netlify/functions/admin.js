const fs = require("node:fs");
const path = require("node:path");
const {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  hasAdminCredentials,
  isAdminAuthorized,
  parseFormBody,
  renderAdminLoginPage,
  verifyAdminCredentials
} = require("../../admin-auth");

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

exports.handler = async event => {
  if (!hasAdminCredentials()) {
    return {
      statusCode: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "text/html; charset=utf-8"
      },
      body: renderAdminLoginPage({ configMissing: true })
    };
  }

  if ((event.httpMethod || "GET") === "POST") {
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    const form = parseFormBody(rawBody);

    if (form.logout === "1") {
      return redirectToAdmin([clearAdminSessionCookie()]);
    }

    if (verifyAdminCredentials(form.username || "", form.password || "")) {
      return redirectToAdmin([createAdminSessionCookie()]);
    }

    return {
      statusCode: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "text/html; charset=utf-8"
      },
      body: renderAdminLoginPage({ errorMessage: "Feil brukernavn eller passord." })
    };
  }

  if (!isAdminAuthorized(event.headers || {})) {
    return {
      statusCode: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "text/html; charset=utf-8"
      },
      body: renderAdminLoginPage()
    };
  }

  const adminHtmlPath = path.join(process.cwd(), "admin.html");
  const html = fs.readFileSync(adminHtmlPath, "utf8");

  return {
    statusCode: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8"
    },
    body: html
  };
};

function redirectToAdmin(cookies = []) {
  return {
    statusCode: 303,
    headers: {
      ...SECURITY_HEADERS,
      Location: "/admin"
    },
    multiValueHeaders: {
      "Set-Cookie": cookies
    },
    body: ""
  };
}
