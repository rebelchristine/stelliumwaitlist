// Vercel function: POST /api/waitlist
// Creates (or updates) a person in Customer.io with signup_source = "waitlist".
// Secrets live only in Vercel environment variables, never in the browser:
//   CUSTOMERIO_SITE_ID, CUSTOMERIO_TRACK_API_KEY
// Docs: https://docs.customer.io/integrations/api/track/ (PUT /api/v1/customers/{identifier}, Basic auth)

const TRACK_URL = "https://track.customer.io/api/v1/customers/"; // US region
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IDENTIFIER_BYTES = 150; // Customer.io limit for an identifier

export async function POST(request) {
  const contentType = request.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  // JSON from the page's script, or a plain form post when JavaScript is off.
  let fields;
  try {
    fields = isJson
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return reply(isJson, 400, { error: "Invalid request." });
  }

  // Bot trap: people never see the "company" field, so anything in it is a bot.
  // Pretend it worked so the bot learns nothing.
  if (fields && typeof fields.company === "string" && fields.company.trim() !== "") {
    return reply(isJson, 200, { ok: true });
  }

  const email = String((fields && fields.email) || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || new TextEncoder().encode(email).length > MAX_IDENTIFIER_BYTES) {
    return reply(isJson, 400, { error: "Please enter a valid email address." });
  }

  const siteId = process.env.CUSTOMERIO_SITE_ID;
  const apiKey = process.env.CUSTOMERIO_TRACK_API_KEY;
  if (!siteId || !apiKey) {
    console.error("waitlist: Customer.io environment variables are not set");
    return reply(isJson, 500, { error: "Waitlist is not configured yet." });
  }

  try {
    const response = await fetch(TRACK_URL + encodeURIComponent(email), {
      method: "PUT",
      headers: {
        Authorization: "Basic " + Buffer.from(siteId + ":" + apiKey).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        signup_source: "waitlist",
        waitlist_joined_at: Math.floor(Date.now() / 1000),
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      // Log the status only. Never log credentials or the request headers.
      console.error("waitlist: Customer.io responded " + response.status);
      return reply(isJson, 502, { error: "Could not join right now." });
    }
  } catch (error) {
    console.error("waitlist: Customer.io request failed: " + (error && error.name));
    return reply(isJson, 502, { error: "Could not join right now." });
  }

  return reply(isJson, 200, { ok: true });
}

// The page's script gets JSON back. A plain form post is sent back to the page,
// which shows the confirmation when it sees ?joined=1 (or ?error=1 on failure).
function reply(isJson, status, body) {
  if (isJson) return Response.json(body, { status });
  const target = status === 200 ? "/?joined=1#join" : "/?error=1#join";
  return new Response(null, { status: 303, headers: { Location: target } });
}
