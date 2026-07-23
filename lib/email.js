// ── Email utility for Omix Store — powered by Resend ──
// Free tier: 3,000 emails/month
// Docs: https://resend.com/docs/api-reference/emails/send-email

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Omix Store <onboarding@resend.dev>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://stor1-web.onrender.com';

// ── Brand colors ──
const BRAND = {
  primary: '#ff385c',
  primaryDark: '#e03150',
  dark: '#18181b',
  text: '#27272a',
  textMuted: '#71717a',
  bg: '#fafafa',
  white: '#ffffff',
  success: '#22c55e',
  warning: '#f59e0b',
  border: '#e4e4e7',
};

// ── Brand logo (favicon mark) — inline SVG so every email shows the real logo ──
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#667eea"/><stop offset="1" stop-color="#764ba2"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="#16213e"/><g transform="translate(32,30)"><rect x="-15" y="-22" width="6" height="44" rx="2" fill="url(#g)"/><rect x="-6" y="-22" width="6" height="44" rx="2" fill="url(#g)" opacity="0.7"/><rect x="3" y="-22" width="6" height="44" rx="2" fill="url(#g)" opacity="0.5"/><rect x="12" y="-22" width="6" height="44" rx="2" fill="url(#g)" opacity="0.3"/></g><text x="32" y="56" font-family="system-ui,Arial,sans-serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">OMIX</text></svg>`;
const LOGO_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(LOGO_SVG)}`;

// ── Base email wrapper ──
function emailWrapper({ title, content, footer }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    /* Reset */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: ${BRAND.bg}; }
    /* iOS blue links */
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: inherit !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
    /* Responsive */
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; max-width: 100% !important; }
      .content { padding: 20px !important; }
      .header-text { font-size: 20px !important; }
      .body-text { font-size: 15px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:${BRAND.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <!-- Preheader text (hidden) -->
  <div style="display:none; font-size:1px; color:${BRAND.bg}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
    ${title}
  </div>
  <!-- Outer table -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:${BRAND.bg};">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <!-- Container -->
        <table role="presentation" class="container" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px; background-color:${BRAND.white}; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
          <!-- Header with logo -->
          <tr>
            <td style="background: linear-gradient(135deg, ${BRAND.primary}, ${BRAND.primaryDark}); padding: 24px 32px; text-align: center;">
              <img src="${LOGO_DATA_URI}" alt="Omix Store" width="64" height="64" style="display:inline-block; border-radius:14px; box-shadow:0 4px 12px rgba(0,0,0,0.25);" />
              <p style="margin:10px 0 0; color:#fff; font-size:13px; font-weight:700; letter-spacing:2px; text-transform:uppercase;">Omix Store</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td class="content" style="padding: 32px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color:${BRAND.bg}; border-top: 1px solid ${BRAND.border}; text-align: center;">
              ${footer || defaultFooter()}
            </td>
          </tr>
        </table>
        <!-- End container -->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function defaultFooter() {
  return `
  <p style="font-size:12px; color:${BRAND.textMuted}; margin:0 0 8px; line-height:1.5;">
    <strong style="color:${BRAND.text};">Omix Store</strong> — Kenya<br>
    <a href="mailto:omixsystems@gmail.com" style="color:${BRAND.primary}; text-decoration:none;">omixsystems@gmail.com</a> · +254 768 213 649
  </p>
  <p style="font-size:11px; color:${BRAND.textMuted}; margin:0; line-height:1.5;">
    <a href="${FRONTEND_URL}" style="color:${BRAND.textMuted}; text-decoration:underline;">Visit Store</a> ·
    <a href="${FRONTEND_URL}/privacy" style="color:${BRAND.textMuted}; text-decoration:underline;">Privacy</a> ·
    <a href="${FRONTEND_URL}/terms" style="color:${BRAND.textMuted}; text-decoration:underline;">Terms</a>
  </p>
  <p style="font-size:10px; color:${BRAND.textMuted}; margin:8px 0 0; opacity:0.6;">
    © ${new Date().getFullYear()} Omix Systems. All rights reserved.
  </p>`;
}

// ── Button helper ──
function button({ text, url, color = BRAND.primary }) {
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 24px auto;">
    <tr>
      <td style="background-color: ${color}; border-radius: 10px;">
        <a href="${url}" target="_blank" style="display: inline-block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; border-radius: 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${text}</a>
      </td>
    </tr>
  </table>`;
}

// ── Divider ──
function divider() {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="padding: 16px 0;"><hr style="border: none; border-top: 1px solid ${BRAND.border}; margin: 0;"></td></tr></table>`;
}

// ── Send email via Resend ──
async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email to', to);
    return { sent: false, reason: 'no_api_key' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text: text || subject,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[Email] Resend error:', data);
      return { sent: false, reason: data?.message || 'resend_error' };
    }

    console.log(`[Email] ✅ Sent "${subject}" to ${to} — id: ${data.id}`);
    return { sent: true, id: data.id };
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}


// ═══════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════

// ── 1. Order Confirmation ──
export async function sendOrderConfirmation({ to, orderId, items, total, customerName, deliveryArea, deliveryLandmark }) {
  const itemsHtml = items.map(item => `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:8px;">
      <tr>
        <td style="padding:10px 12px; background-color:${BRAND.bg}; border-radius:8px; border:1px solid ${BRAND.border};">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="font-size:14px; font-weight:600; color:${BRAND.text};">${item.name || item.product_name || 'Product'}</td>
              <td align="right" style="font-size:14px; font-weight:700; color:${BRAND.primary};">KES ${((item.price || 0)).toLocaleString()}</td>
            </tr>
            <tr>
              <td style="font-size:12px; color:${BRAND.textMuted}; padding-top:2px;">Qty: ${item.quantity || 1}</td>
              <td align="right" style="font-size:12px; color:${BRAND.textMuted}; padding-top:2px;">Subtotal: KES ${((item.price || 0) * (item.quantity || 1)).toLocaleString()}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `).join('');

  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Order Confirmed! 🎉</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${customerName || 'there'}, thank you for your order. We're getting it ready for delivery.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:linear-gradient(135deg, ${BRAND.primary}08, ${BRAND.primary}03); border:1px solid ${BRAND.border}; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td>
          <p style="font-size:12px; color:${BRAND.textMuted}; margin:0 0 4px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Order ID</p>
          <p style="font-size:20px; font-weight:800; color:${BRAND.primary}; margin:0;">#${orderId}</p>
        </td>
        <td align="right">
          <p style="font-size:12px; color:${BRAND.textMuted}; margin:0 0 4px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Total</p>
          <p style="font-size:20px; font-weight:800; color:${BRAND.text}; margin:0;">KES ${(total || 0).toLocaleString()}</p>
        </td>
      </tr>
    </table>

    <p style="font-size:13px; font-weight:700; color:${BRAND.text}; margin:0 0 8px; text-transform:uppercase; letter-spacing:0.5px;">Items</p>
    ${itemsHtml}

    ${divider()}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-size:13px; color:${BRAND.textMuted}; padding:4px 0;">Subtotal</td>
        <td align="right" style="font-size:13px; font-weight:600; color:${BRAND.text}; padding:4px 0;">KES ${(total || 0).toLocaleString()}</td>
      </tr>
      <tr>
        <td style="font-size:13px; color:${BRAND.textMuted}; padding:4px 0;">Delivery</td>
        <td align="right" style="font-size:13px; font-weight:600; color:${BRAND.success}; padding:4px 0;">At delivery</td>
      </tr>
      <tr>
        <td colspan="2"><hr style="border:none; border-top:1px solid ${BRAND.border}; margin:8px 0;"></td>
      </tr>
      <tr>
        <td style="font-size:15px; font-weight:800; color:${BRAND.text}; padding:4px 0;">Total</td>
        <td align="right" style="font-size:18px; font-weight:900; color:${BRAND.primary}; padding:4px 0;">KES ${(total || 0).toLocaleString()}</td>
      </tr>
    </table>

    ${deliveryArea ? `
    ${divider()}
    <p style="font-size:13px; font-weight:700; color:${BRAND.text}; margin:0 0 6px; text-transform:uppercase; letter-spacing:0.5px;">📍 Delivery Address</p>
    <p style="font-size:14px; color:${BRAND.text}; margin:0; line-height:1.5;">
      ${deliveryLandmark ? deliveryLandmark + ', ' : ''}${deliveryArea}
    </p>
    ` : ''}

    ${button({ text: 'Track Your Order', url: `${FRONTEND_URL}/track-order?orderId=${orderId}` })}
  `;

  return sendEmail({
    to,
    subject: `Order #${orderId} Confirmed — Omix Store`,
    html: emailWrapper({ title: `Order #${orderId} Confirmed`, content }),
  });
}


// ── 2. Welcome Email ──
export async function sendWelcomeEmail({ to, name }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Welcome to Omix! 🛍️</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${name || 'there'}, we're thrilled to have you join the Omix community. Discover amazing products, delivered to your doorstep.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      <tr>
        <td style="padding:16px; background-color:${BRAND.bg}; border-radius:12px; border:1px solid ${BRAND.border}; text-align:center;">
          <p style="font-size:32px; margin:0 0 8px;">🚀</p>
          <p style="font-size:14px; font-weight:700; color:${BRAND.text}; margin:0 0 4px;">Get Started</p>
          <p style="font-size:13px; color:${BRAND.textMuted}; margin:0; line-height:1.5;">Browse products, add to cart, and pay easily via M-Pesa. It's that simple.</p>
        </td>
      </tr>
    </table>

    ${button({ text: 'Start Shopping', url: `${FRONTEND_URL}/` })}

    <p style="font-size:13px; color:${BRAND.textMuted}; text-align:center; margin:16px 0 0; line-height:1.5;">
      Need help? Reply to this email or WhatsApp us at <strong>+254 768 213 649</strong>
    </p>
  `;

  return sendEmail({
    to,
    subject: 'Welcome to Omix Store — Let\'s Get Shopping! 🛍️',
    html: emailWrapper({ title: 'Welcome to Omix', content }),
  });
}


// ── 3. Order Status Update ──
export async function sendOrderStatusUpdate({ to, orderId, status, customerName }) {
  const statusConfig = {
    processing: { emoji: '📦', title: 'Order Being Prepared', message: 'We\'re getting your order ready for shipment.' },
    shipped: { emoji: '🚚', title: 'Order Shipped!', message: 'Your order is on its way to you.' },
    delivered: { emoji: '✅', title: 'Order Delivered!', message: 'Your order has been delivered. Enjoy!' },
    cancelled: { emoji: '❌', title: 'Order Cancelled', message: 'Your order has been cancelled. Contact us if you have questions.' },
  };

  const cfg = statusConfig[status] || { emoji: '📋', title: `Order ${status}`, message: `Your order status has been updated to: ${status}` };

  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">${cfg.emoji} ${cfg.title}</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${customerName || 'there'}, ${cfg.message}
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg}; border:1px solid ${BRAND.border}; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td>
          <p style="font-size:12px; color:${BRAND.textMuted}; margin:0 0 4px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Order ID</p>
          <p style="font-size:18px; font-weight:800; color:${BRAND.primary}; margin:0;">#${orderId}</p>
        </td>
        <td align="right">
          <p style="font-size:12px; color:${BRAND.textMuted}; margin:0 0 4px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Status</p>
          <p style="font-size:16px; font-weight:700; color:${BRAND.text}; margin:0; text-transform:capitalize;">${status}</p>
        </td>
      </tr>
    </table>

    ${button({ text: 'View Order', url: `${FRONTEND_URL}/track-order?orderId=${orderId}` })}
  `;

  return sendEmail({
    to,
    subject: `${cfg.emoji} Order #${orderId} — ${cfg.title}`,
    html: emailWrapper({ title: cfg.title, content }),
  });
}


// ── 4. Referral Reward ──
export async function sendReferralReward({ to, referralCode, rewardAmount, customerName }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">You Earned a Reward! 🎁</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${customerName || 'there'}, someone just used your referral code <strong>${referralCode}</strong> and made their first order. You've earned a reward!
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:linear-gradient(135deg, ${BRAND.primary}08, ${BRAND.primary}03); border:1px solid ${BRAND.border}; border-radius:12px; padding:20px; margin-bottom:20px; text-align:center;">
      <tr>
        <td>
          <p style="font-size:12px; color:${BRAND.textMuted}; margin:0 0 4px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Reward Earned</p>
          <p style="font-size:32px; font-weight:900; color:${BRAND.primary}; margin:0;">KES ${(rewardAmount || 100).toLocaleString()}</p>
        </td>
      </tr>
    </table>

    <p style="font-size:14px; color:${BRAND.text}; margin:0 0 16px; line-height:1.6;">
      Keep sharing your referral code to earn more rewards!
    </p>

    ${button({ text: 'View Your Referrals', url: `${FRONTEND_URL}/account?tab=referrals` })}
  `;

  return sendEmail({
    to,
    subject: `🎁 You earned KES ${(rewardAmount || 100).toLocaleString()} from a referral!`,
    html: emailWrapper({ title: 'Referral Reward Earned', content }),
  });
}


// ── 5. Price Drop Alert ──
export async function sendPriceDropAlert({ to, productName, productUrl, oldPrice, newPrice, productImage }) {
  const savings = (oldPrice || 0) - (newPrice || 0);
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Price Drop Alert! 📉</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Great news! A product you were watching just dropped in price.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg}; border:1px solid ${BRAND.border}; border-radius:12px; padding:16px; margin-bottom:20px;">
      <tr>
        <td style="font-size:16px; font-weight:700; color:${BRAND.text}; padding-bottom:12px;">${productName || 'Product'}</td>
      </tr>
      <tr>
        <td>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="font-size:13px; color:${BRAND.textMuted}; text-decoration:line-through;">KES ${(oldPrice || 0).toLocaleString()}</td>
              <td align="right" style="font-size:22px; font-weight:900; color:${BRAND.success};">KES ${(newPrice || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding-top:4px;">
                <span style="background:${BRAND.success}15; color:${BRAND.success}; font-size:12px; font-weight:700; padding:3px 8px; border-radius:4px;">Save KES ${savings.toLocaleString()}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${button({ text: 'Buy Now', url: productUrl || FRONTEND_URL })}
  `;

  return sendEmail({
    to,
    subject: `📉 Price Drop: ${productName || 'A product you watched'}`,
    html: emailWrapper({ title: 'Price Drop Alert', content }),
  });
}


// ── 6. Back In Stock Alert ──
export async function sendBackInStockAlert({ to, productName, productUrl, price }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Back In Stock! 🎉</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Good news! <strong>${productName || 'A product you watched'}</strong> is back in stock and available for purchase.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg}; border:1px solid ${BRAND.border}; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td style="font-size:16px; font-weight:700; color:${BRAND.text};">${productName || 'Product'}</td>
        <td align="right" style="font-size:18px; font-weight:800; color:${BRAND.primary};">KES ${(price || 0).toLocaleString()}</td>
      </tr>
    </table>

    ${button({ text: 'Shop Now', url: productUrl || FRONTEND_URL })}
  `;

  return sendEmail({
    to,
    subject: `🎉 Back In Stock: ${productName || 'A product you watched'}`,
    html: emailWrapper({ title: 'Back In Stock', content }),
  });
}


// ── 7. Abandoned Cart Reminder ──
export async function sendAbandonedCartReminder({ to, items, total, customerName }) {
  const itemsHtml = (items || []).slice(0, 3).map(item => `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:6px;">
      <tr>
        <td style="padding:8px 12px; background-color:${BRAND.bg}; border-radius:8px; border:1px solid ${BRAND.border}; font-size:13px;">
          <strong style="color:${BRAND.text};">${item.name || item.product_name || 'Product'}</strong>
          <span style="color:${BRAND.textMuted};"> × ${item.quantity || 1}</span>
          <span style="float:right; font-weight:700; color:${BRAND.primary};">KES ${((item.price || 0) * (item.quantity || 1)).toLocaleString()}</span>
        </td>
      </tr>
    </table>
  `).join('');

  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">You left something behind! 🛒</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${customerName || 'there'}, you have items waiting in your cart. Complete your order before they sell out!
    </p>

    ${itemsHtml}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:12px 0 20px;">
      <tr>
        <td style="font-size:14px; font-weight:700; color:${BRAND.text};">Cart Total</td>
        <td align="right" style="font-size:18px; font-weight:900; color:${BRAND.primary};">KES ${(total || 0).toLocaleString()}</td>
      </tr>
    </table>

    ${button({ text: 'Complete Your Order', url: `${FRONTEND_URL}/checkout` })}
  `;

  return sendEmail({
    to,
    subject: '🛒 Your cart is waiting — complete your order!',
    html: emailWrapper({ title: 'Abandoned Cart', content }),
  });
}


// ── 8. Payment Failed ──
export async function sendPaymentFailed({ to, orderId, customerName, amount, reference }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Payment Not Completed</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${customerName || 'there'}, we couldn't complete your payment for order <strong>#${orderId}</strong>. Don't worry — your order is saved and you can try again anytime.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#fef2f2; border:1px solid #fecaca; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td>
          <p style="font-size:12px; color:#dc2626; margin:0 0 4px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Payment Failed</p>
          <p style="font-size:18px; font-weight:800; color:#991b1b; margin:0;">KES ${((amount || 0)).toLocaleString()}</p>
        </td>
        <td align="right">
          <p style="font-size:12px; color:#71717a; margin:0 0 4px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Order ID</p>
          <p style="font-size:16px; font-weight:700; color:#991b1b; margin:0;">#${orderId}</p>
        </td>
      </tr>
    </table>

    <p style="font-size:14px; color:${BRAND.text}; margin:0 0 16px; line-height:1.6;">
      Common reasons: insufficient M-Pesa balance, wrong PIN, or session timeout. You can retry from your account page.
    </p>

    ${button({ text: 'Retry Payment', url: `${FRONTEND_URL}/track-order?orderId=${orderId}`, color: BRAND.primary })}
    ${button({ text: 'Contact Support', url: 'mailto:omixsystems@gmail.com', color: BRAND.textMuted })}
  `;

  return sendEmail({
    to,
    subject: `Payment failed for Order #${orderId} — Omix Store`,
    html: emailWrapper({ title: 'Payment Not Completed', content }),
  });
}


// ── 9. Referral Signup (affiliate notified when someone signs up using their code) ──
export async function sendReferralSignup({ to, referralCode, customerName, referredName }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">New Referral Signup!</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${customerName || 'there'}, <strong>${referredName || 'Someone'}</strong> just signed up using your referral code <strong>${referralCode}</strong>!
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg}; border:1px solid ${BRAND.border}; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td style="font-size:14px; color:${BRAND.text}; line-height:1.6; text-align:center;">
          They haven't made a purchase yet. You'll earn commission when they place their first order. Keep sharing your link to grow your referrals!
        </td>
      </tr>
    </table>
    <p style="font-size:14px; color:${BRAND.text}; margin:0 0 16px; line-height:1.6;">
      Your commission will be calculated based on your current tier rate when they complete their first qualifying order.
    </p>
    ${button({ text: 'View Your Referrals', url: `${FRONTEND_URL}/affiliate-referrals` })}
  `;
  return sendEmail({
    to,
    subject: 'New Referral Signup — Omix Store Affiliate',
    html: emailWrapper({ title: 'New Referral Signup', content }),
  });
}

// ── 10. Affiliate Approved ──
export async function sendAffiliateApproved({ to, name, referralCode, dashboardUrl }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Welcome to the Team!</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${name || 'there'}, congratulations! Your application to join the Omix Store Affiliate Program has been approved. You are now ready to start earning commissions by promoting products.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg}; border:1px solid ${BRAND.border}; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td style="text-align:center;">
          <p style="font-size:12px; color:${BRAND.textMuted}; margin:0 0 6px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Your Referral Code</p>
          <p style="font-size:32px; font-weight:900; color:${BRAND.primary}; margin:0; letter-spacing:4px;">${referralCode || '---'}</p>
          <p style="font-size:13px; color:${BRAND.textMuted}; margin:6px 0 0;">Share this code with customers when they checkout</p>
        </td>
      </tr>
    </table>

    <p style="font-size:14px; color:${BRAND.text}; margin:0 0 16px; line-height:1.6;">
      <strong>Next steps:</strong>
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      <tr><td style="padding:6px 0; font-size:14px; color:${BRAND.text};">1. Log in to your affiliate dashboard</td></tr>
      <tr><td style="padding:6px 0; font-size:14px; color:${BRAND.text};">2. Copy your unique referral link from the dashboard</td></tr>
      <tr><td style="padding:6px 0; font-size:14px; color:${BRAND.text};">3. Start sharing on social media, WhatsApp, or your blog</td></tr>
      <tr><td style="padding:6px 0; font-size:14px; color:${BRAND.text};">4. Earn up to 12% commission on every qualifying sale</td></tr>
    </table>

    ${button({ text: 'Go to Dashboard', url: dashboardUrl || `${FRONTEND_URL}/affiliate-dashboard` })}
  `;

  return sendEmail({
    to,
    subject: 'Welcome to the Omix Store Affiliate Program!',
    html: emailWrapper({ title: 'Affiliate Application Approved', content }),
  });
}


// ── 10. Affiliate Credentials (sent after successful signup) ──
export async function sendAffiliateCredentials({ to, name, email, loginUrl }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Application Submitted</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${name || 'there'}, thank you for applying to join the Omix Store Affiliate Program. Your application has been received and is now under review.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg}; border:1px solid ${BRAND.border}; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td style="text-align:center;">
          <p style="font-size:12px; color:${BRAND.textMuted}; margin:0 0 6px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Your Login Email</p>
          <p style="font-size:18px; font-weight:700; color:${BRAND.text}; margin:0;">${email || '---'}</p>
          <p style="font-size:12px; color:${BRAND.textMuted}; margin:6px 0 0;">Use the password you created during signup to log in</p>
        </td>
      </tr>
    </table>

    <p style="font-size:14px; color:${BRAND.text}; margin:0 0 16px; line-height:1.6;">
      <strong>What happens next?</strong>
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      <tr><td style="padding:6px 0; font-size:14px; color:${BRAND.text};">1. Our team reviews your application</td></tr>
      <tr><td style="padding:6px 0; font-size:14px; color:${BRAND.text};">2. You receive an email once approved</td></tr>
      <tr><td style="padding:6px 0; font-size:14px; color:${BRAND.text};">3. Log in to access your dashboard and referral links</td></tr>
      <tr><td style="padding:6px 0; font-size:14px; color:${BRAND.text};">4. Start sharing and earning commissions</td></tr>
    </table>

    ${button({ text: 'Track Your Application', url: loginUrl || `${FRONTEND_URL}/login` })}

    <p style="font-size:13px; color:${BRAND.textMuted}; margin:16px 0 0; line-height:1.5;">
      You can check your application status anytime by logging into your account.
    </p>
  `;

  return sendEmail({
    to,
    subject: 'Affiliate Application Received — Omix Store',
    html: emailWrapper({ title: 'Application Submitted', content }),
  });
}


// ── 11. Affiliate Rejected ──
export async function sendAffiliateRejected({ to, name }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Application Status Update</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${name || 'there'}, thank you for your interest in the Omix Store Affiliate Program. After reviewing your application, we are unable to approve it at this time.
    </p>

    <p style="font-size:14px; color:${BRAND.text}; margin:0 0 16px; line-height:1.6;">
      You are welcome to reapply after 90 days with updated information. If you have any questions, please feel free to contact us.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:24px 0;">
      <tr>
        <td style="padding:16px; background-color:${BRAND.bg}; border-radius:12px; border:1px solid ${BRAND.border}; text-align:center;">
          <p style="font-size:13px; color:${BRAND.textMuted}; margin:0 0 4px;">Questions?</p>
          <p style="font-size:15px; font-weight:600; color:${BRAND.primary}; margin:0;">
            <a href="mailto:omixsystems@gmail.com" style="color:${BRAND.primary}; text-decoration:none;">omixsystems@gmail.com</a>
          </p>
        </td>
      </tr>
    </table>
  `;

  return sendEmail({
    to,
    subject: 'Your Omix Store Affiliate Application',
    html: emailWrapper({ title: 'Affiliate Application Update', content }),
  });
}


// ── 12. Password Reset ──
export async function sendPasswordReset({ to, name, resetUrl }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Reset Your Password</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${name || 'there'}, we received a request to reset your Omix Store account password. Click the button below to set a new password.
    </p>
    <p style="font-size:13px; color:${BRAND.textMuted}; margin:0 0 16px; line-height:1.5;">
      This link expires in 1 hour. If you didn't request this, ignore this email.
    </p>
    ${button({ text: 'Reset Password', url: resetUrl })}
    <p style="font-size:13px; color:${BRAND.textMuted}; text-align:center; margin:16px 0 0; line-height:1.5;">
      Or paste this link in your browser:<br>
      <span style="font-size:12px; word-break:break-all;">${resetUrl}</span>
    </p>`;
  return sendEmail({
    to, subject: 'Reset Your Password — Omix Store',
    html: emailWrapper({ title: 'Password Reset', content }),
  });
}

// ── 13. Email Verification ──
export async function sendEmailVerification({ to, name, verifyUrl }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Verify Your Email</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${name || 'there'}, welcome to Omix Store! Please confirm your email address to activate your account.
    </p>
    ${button({ text: 'Verify Email', url: verifyUrl })}
    <p style="font-size:13px; color:${BRAND.textMuted}; text-align:center; margin:16px 0 0; line-height:1.5;">
      This link expires in 24 hours. If you didn't create an account, ignore this email.
    </p>`;
  return sendEmail({
    to, subject: 'Verify your email — Omix Store',
    html: emailWrapper({ title: 'Email Verification', content }),
  });
}

// ── 14. Seller Approved ──
export async function sendSellerApproved({ to, name, dashboardUrl }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Your Seller Account is Live!</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${name || 'there'}, congratulations! Your seller application has been approved. You can now list products and start selling on Omix Store.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      <tr><td style="padding:12px; background:${BRAND.bg}; border-radius:8px; border:1px solid ${BRAND.border}; font-size:14px; color:${BRAND.text}; line-height:1.6;">
        <strong>What's next:</strong><br>
        1. Log in to your seller dashboard<br>
        2. Add your products with photos, sizes, and prices<br>
        3. Start receiving orders from customers across Kenya
      </td></tr>
    </table>
    ${button({ text: 'Go to Dashboard', url: dashboardUrl || `${FRONTEND_URL}/seller/dashboard` })}
    <p style="font-size:13px; color:${BRAND.textMuted}; text-align:center; margin:16px 0 0; line-height:1.5;">
      Questions? WhatsApp us at <strong>+254 768 213 649</strong>
    </p>`;
  return sendEmail({
    to, subject: 'Your Seller Account is Live — Omix Store',
    html: emailWrapper({ title: 'Seller Approved', content }),
  });
}

// ── 15. Refund Confirmation ──
export async function sendRefundConfirmation({ to, orderId, amount, customerName, reason }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Refund Processed</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${customerName || 'there'}, a refund has been processed for your order <strong>#${orderId}</strong>.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td style="text-align:center;">
          <p style="font-size:12px; color:#16a34a; margin:0 0 6px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Refund Amount</p>
          <p style="font-size:32px; font-weight:900; color:#15803d; margin:0;">KES ${(amount || 0).toLocaleString()}</p>
          ${reason ? `<p style="font-size:13px; color:#71717a; margin:6px 0 0;">Reason: ${reason}</p>` : ''}
        </td>
      </tr>
    </table>
    <p style="font-size:14px; color:${BRAND.text}; margin:0 0 16px; line-height:1.6;">
      Refunds typically reflect in your M-Pesa account within 24-48 hours. Contact us if you don't see it by then.
    </p>
    ${button({ text: 'View Order', url: `${FRONTEND_URL}/track-order?orderId=${orderId}` })}`;
  return sendEmail({
    to, subject: `Refund Processed for Order #${orderId} — Omix Store`,
    html: emailWrapper({ title: 'Refund Processed', content }),
  });
}

// ── 16. Order Cancellation ──
export async function sendOrderCancellation({ to, orderId, customerName, reason, refundAmount }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Order Cancelled</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${customerName || 'there'}, your order <strong>#${orderId}</strong> has been cancelled.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#fef2f2; border:1px solid #fecaca; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td style="text-align:center;">
          <p style="font-size:12px; color:#dc2626; margin:0 0 6px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Order #${orderId}</p>
          ${refundAmount ? `<p style="font-size:24px; font-weight:900; color:#991b1b; margin:0;">KES ${refundAmount.toLocaleString()} refunded</p>` : '<p style="font-size:16px; font-weight:600; color:#991b1b; margin:0;">No payment was charged</p>'}
          ${reason ? `<p style="font-size:13px; color:#71717a; margin:6px 0 0;">Reason: ${reason}</p>` : ''}
        </td>
      </tr>
    </table>
    <p style="font-size:14px; color:${BRAND.text}; margin:0 0 16px; line-height:1.6;">
      ${refundAmount ? 'The refund will reflect in your M-Pesa within 24-48 hours.' : 'No payment was processed for this order.'}
    </p>
    ${button({ text: 'Continue Shopping', url: FRONTEND_URL })}
    <p style="font-size:13px; color:${BRAND.textMuted}; text-align:center; margin:16px 0 0; line-height:1.5;">
      Need help? <a href="mailto:omixsystems@gmail.com" style="color:${BRAND.primary}; text-decoration:none;">Contact support</a>
    </p>`;
  return sendEmail({
    to, subject: `Order #${orderId} Cancelled — Omix Store`,
    html: emailWrapper({ title: 'Order Cancelled', content }),
  });
}

// ── 17. Review Request ──
export async function sendReviewRequest({ to, customerName, productName, productUrl, orderId }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">How was your purchase?</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${customerName || 'there'}, thanks for ordering from Omix Store! We'd love to hear your thoughts on <strong>${productName || 'your recent purchase'}</strong>.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg}; border:1px solid ${BRAND.border}; border-radius:12px; padding:16px; margin-bottom:20px; text-align:center;">
      <tr><td style="font-size:36px; padding-bottom:8px;">⭐</td></tr>
      <tr><td style="font-size:14px; color:${BRAND.textMuted}; line-height:1.5;">Your review helps other shoppers make informed decisions and helps us improve.</td></tr>
    </table>
    ${button({ text: 'Write a Review', url: productUrl || `${FRONTEND_URL}/track-order?orderId=${orderId}` })}
    <p style="font-size:12px; color:${BRAND.textMuted}; text-align:center; margin:12px 0 0;">Takes less than a minute.</p>`;
  return sendEmail({
    to, subject: `Review your purchase from Omix Store`,
    html: emailWrapper({ title: 'Review Request', content }),
  });
}

// ── 18. Payout Confirmation ──
export async function sendPayoutConfirmation({ to, name, amount, paymentMethod, payoutDate, paymentRef }) {
  const content = `
    <h1 class="header-text" style="font-size:24px; font-weight:800; color:${BRAND.dark}; margin:0 0 8px;">Payout Sent!</h1>
    <p class="body-text" style="font-size:15px; color:${BRAND.text}; margin:0 0 20px; line-height:1.6;">
      Hi ${name || 'there'}, a payout of <strong>KES ${(amount || 0).toLocaleString()}</strong> has been sent to you.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg}; border:1px solid ${BRAND.border}; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
      <tr>
        <td style="font-size:12px; color:${BRAND.textMuted}; padding:4px 0;">Amount</td>
        <td align="right" style="font-size:18px; font-weight:800; color:${BRAND.success}; padding:4px 0;">KES ${(amount || 0).toLocaleString()}</td>
      </tr>
      <tr>
        <td style="font-size:12px; color:${BRAND.textMuted}; padding:4px 0;">Method</td>
        <td align="right" style="font-size:14px; font-weight:600; color:${BRAND.text}; padding:4px 0;">${paymentMethod || 'M-Pesa'}</td>
      </tr>
      <tr>
        <td style="font-size:12px; color:${BRAND.textMuted}; padding:4px 0;">Date</td>
        <td align="right" style="font-size:14px; font-weight:600; color:${BRAND.text}; padding:4px 0;">${payoutDate ? new Date(payoutDate).toLocaleDateString() : 'Today'}</td>
      </tr>
      ${paymentRef ? `<tr><td style="font-size:12px; color:${BRAND.textMuted}; padding:4px 0;">Reference</td><td align="right" style="font-size:13px; font-weight:600; color:${BRAND.text}; padding:4px 0;">${paymentRef}</td></tr>` : ''}
    </table>
    <p style="font-size:14px; color:${BRAND.text}; margin:0 0 16px; line-height:1.5;">
      Thank you for being part of the Omix Store community!
    </p>
    ${button({ text: 'View Dashboard', url: `${FRONTEND_URL}/affiliate-dashboard` })}`;
  return sendEmail({
    to, subject: `KES ${(amount || 0).toLocaleString()} Payout Sent — Omix Store`,
    html: emailWrapper({ title: 'Payout Confirmation', content }),
  });
}

export default {
  emailWrapper,
  sendEmail,
  sendOrderConfirmation,
  sendWelcomeEmail,
  sendOrderStatusUpdate,
  sendReferralReward,
  sendPriceDropAlert,
  sendBackInStockAlert,
  sendAbandonedCartReminder,
  sendPaymentFailed,
  sendReferralSignup,
  sendAffiliateApproved,
  sendAffiliateCredentials,
  sendAffiliateRejected,
  sendPasswordReset,
  sendEmailVerification,
  sendSellerApproved,
  sendRefundConfirmation,
  sendOrderCancellation,
  sendReviewRequest,
  sendPayoutConfirmation,
};
