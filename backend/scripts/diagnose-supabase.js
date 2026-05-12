require("dotenv").config();

const https = require("https");

const baseUrl = process.env.SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SECRET_KEY || "";

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function readBody(res) {
  return new Promise((resolve) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function request(pathname, options = {}) {
  const insecure = options.insecure === true;
  const method = options.method || "GET";
  const url = new URL(`${trimTrailingSlash(baseUrl)}${pathname}`);

  return new Promise((resolve) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        rejectUnauthorized: !insecure,
        headers: options.headers || {},
      },
      async (res) => {
        const body = await readBody(res);
        const socket = res.socket || res.connection || null;
        const cert = socket?.getPeerCertificate?.() || null;
        resolve({
          ok: true,
          insecure,
          method,
          path: pathname,
          statusCode: res.statusCode || null,
          issuer: cert?.issuer || null,
          subject: cert?.subject || null,
          bodyPreview: body.slice(0, 300),
        });
      },
    );

    req.on("error", (error) => {
      resolve({
        ok: false,
        insecure,
        method,
        path: pathname,
        error: {
          name: error.name,
          code: error.code || null,
          message: error.message,
        },
      });
    });

    req.end();
  });
}

async function main() {
  if (!baseUrl || !serviceKey) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          detail: "SUPABASE_URL and SUPABASE_SECRET_KEY must be set in backend/.env",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const authHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  const results = [];
  results.push(await request("/", { insecure: false }));
  results.push(await request("/", { insecure: true }));
  results.push(
    await request("/auth/v1/admin/users?page=1&per_page=1", {
      insecure: false,
      headers: authHeaders,
    }),
  );
  results.push(
    await request("/auth/v1/admin/users?page=1&per_page=1", {
      insecure: true,
      headers: authHeaders,
    }),
  );
  results.push(
    await request("/rest/v1/user_api_keys?select=id&limit=1", {
      insecure: false,
      headers: authHeaders,
    }),
  );
  results.push(
    await request("/rest/v1/user_api_keys?select=id&limit=1", {
      insecure: true,
      headers: authHeaders,
    }),
  );

  console.log(
    JSON.stringify(
      {
        node: process.version,
        supabaseUrl: baseUrl,
        tests: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: {
          name: error.name,
          message: error.message,
        },
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});