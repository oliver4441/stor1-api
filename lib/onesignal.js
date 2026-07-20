// ── OneSignal API client ─────────────────────────────────
// Sends push, email, and in-app messages via OneSignal REST API.
// Docs: https://documentation.onesignal.com/reference

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
// ponytail: single shared send function. Splitting into push/email/in-app
// helpers when we have >3 callers with different payload shapes.
const API = 'https://api.onesignal.com';

export async function sendNotification({ segments = ['All'], headings, contents, url, emailSubject, emailBody, includeEmail, data } = {}) {
  if (!(ONESIGNAL_APP_ID && ONESIGNAL_API_KEY)) {
    console.warn('[OneSignal] App ID or API key not set — skipping');
    return { sent: 0, reason: 'not_configured' };
  }

  const payload = { app_id: ONESIGNAL_APP_ID };

  // Push
  if (headings || contents) {
    payload.headings = { en: headings || '' };
    payload.contents = { en: contents || '' };
    payload.included_segments = segments;
    if (url) payload.url = url;
    if (data) payload.data = data;
  } else if (includeEmail && emailSubject) {
    // Email-only
    payload.email_subject = emailSubject;
    payload.email_body = emailBody || emailSubject;
    payload.include_email_tokens = Array.isArray(includeEmail) ? includeEmail : [includeEmail];
    payload.email_from_address = process.env.ONESIGNAL_FROM || 'omixstore@omix.store';
  }

  // In-app (Journeys) — bundled with push payload via chrome_web_icon etc.
  if (data?.inApp) payload.chrome_web_icon = data.inApp;

  try {
    const res = await fetch(`${API}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      console.error('[OneSignal] API error:', json);
      return { sent: 0, reason: json.errors?.[0] || res.statusText };
    }
    console.log(`[OneSignal] Sent to ${segments.join(',')} — id: ${json.id}`);
    return { sent: 1, id: json.id };
  } catch (err) {
    console.error('[OneSignal] Send failed:', err.message);
    return { sent: 0, reason: err.message };
  }
}
