/**
 * Outbound mail.
 *
 * Verso sends exactly one kind of transactional email — a password reset — and
 * has no marketing list, so this is deliberately not an email-service
 * integration. It is a seam.
 *
 *   log      (default) writes the message to the server log. On a
 *            single-operator deployment that is genuinely enough: the operator
 *            reads the log and sends the link. It is also what makes the reset
 *            flow testable without a vendor.
 *   webhook  POSTs {to, subject, text} to VERSO_MAIL_WEBHOOK. Point it at
 *            Postmark, Resend, an SMTP bridge, or a Slack channel.
 *   none     drops mail silently. For CI.
 *
 * Nothing in the app branches on which one is configured: the reset flow
 * behaves identically either way, including its response to an unknown address.
 */

/** @typedef {{to: string, subject: string, text: string}} Mail */

function logTransport(mail) {
  console.info(
    `[mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`,
  );
  return true;
}

async function webhookTransport(mail, endpoint) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.VERSO_MAIL_TOKEN
        ? { authorization: `Bearer ${process.env.VERSO_MAIL_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      to: mail.to,
      from: process.env.VERSO_MAIL_FROM ?? "verso@localhost",
      subject: mail.subject,
      text: mail.text,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`mail webhook ${response.status}`);
  return true;
}

/**
 * @param {Mail} mail
 * @returns {Promise<boolean>} whether the message was handed off
 */
export async function sendMail(mail) {
  const transport = process.env.VERSO_MAIL ?? "log";
  try {
    if (transport === "none") return true;
    if (transport === "webhook") {
      const endpoint = process.env.VERSO_MAIL_WEBHOOK;
      if (!endpoint) return logTransport(mail);
      return await webhookTransport(mail, endpoint);
    }
    return logTransport(mail);
  } catch (error) {
    // A failed send must never surface to the user as "that address exists":
    // the caller's response is identical either way.
    console.error("[mail] send failed", error);
    return false;
  }
}

export function resetEmail(handle, url) {
  return {
    subject: "Reset your Verso password",
    text: [
      `Someone asked to reset the password for @${handle}.`,
      "",
      `Open this link within the hour to choose a new one:`,
      url,
      "",
      "If that wasn't you, ignore this. Nothing has changed, and the link",
      "expires on its own.",
    ].join("\n"),
  };
}
