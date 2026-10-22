/**
 * The first link matching `pattern` in the newest Mailpit message to
 * `recipient` received at or after `since` that has one, waiting up to 20
 * seconds for it to arrive.
 */
export async function mailedLink(
  mailUrl: string,
  recipient: string,
  pattern: RegExp,
  since = new Date(0),
): Promise<string> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const search = (await (
      await fetch(
        `${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
      )
    ).json()) as { messages: { ID: string; Created: string }[] };
    for (const summary of search.messages) {
      if (new Date(summary.Created) < since) continue;
      const message = (await (
        await fetch(`${mailUrl}/api/v1/message/${summary.ID}`)
      ).json()) as { Text: string };
      const match = pattern.exec(message.Text);
      if (match) return match[1];
    }
    if (Date.now() > deadline)
      throw new Error(`No matching email reached ${recipient}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Keycloak's single-use action links: email verification, password reset. */
export const actionLink = /(https?:\/\/\S+\/login-actions\/action-token\?\S+)/;
