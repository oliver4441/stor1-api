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
            <td style="background: linear-gradient(135deg, ${BRAND.primary}, ${BRAND.primaryDark}); padding: 28px 32px; text-align: center;">
              <!-- Logo: inline SVG favicon as brand mark -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                <tr>
                  <td style="background:rgba(255,255,255,0.15); border-radius:12px; padding:10px 14px; text-align:center;">
                    <span style="color:#fff; font-size:22px; font-weight:900; letter-spacing:-0.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">Omix</span>
                    <span style="color:rgba(255,255,255,0.7); font-size:11px; font-weight:600; display:block; margin-top:2px; text-transform:uppercase; letter-spacing:1.5px;">Store</span>
                  </td>
                </tr>
              </table>
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
    <strong style="color:${BRAND.text};">Omix Store</strong> — Kericho, Kenya<br>
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
      ${deliveryLandmark ? deliveryLandmark + ', ' : ''}${deliveryArea}, Kericho
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
      Hi ${name || 'there'}, we're thrilled to have you join the Omix community. Discover amazing products from right here in Kericho, delivered to your doorstep.
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


export default {
  sendEmail,
  sendOrderConfirmation,
  sendWelcomeEmail,
  sendOrderStatusUpdate,
  sendReferralReward,
  sendPriceDropAlert,
  sendBackInStockAlert,
  sendAbandonedCartReminder,
  sendPaymentFailed,
};
