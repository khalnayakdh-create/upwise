/**
 * Common throwaway-email domains. Short on purpose: it catches the bulk of
 * low-effort fake sign-ups without shipping a large list to every request.
 */
const DOMAINS = `
0-mail.com 10minutemail.com 10minutemail.net 20minutemail.com 33mail.com
anonaddy.me anonbox.net burnermail.io byom.de
cock.li correotemporal.org crazymailing.com
discard.email discardmail.com dispostable.com dropmail.me
emailondeck.com emailtemporanea.net emltmp.com
fakeinbox.com fakemail.net fakemailgenerator.com filzmail.com
getairmail.com getnada.com guerrillamail.biz guerrillamail.com guerrillamail.de guerrillamail.info guerrillamail.net guerrillamail.org guerrillamailblock.com
harakirimail.com
inboxbear.com incognitomail.org
jetable.org
mail-temp.com mail.tm mail7.io mailcatch.com maildrop.cc mailinator.com mailinator.net mailinator2.com mailnesia.com mailpoof.com mailsac.com mailtemp.info mintemail.com moakt.com mohmal.com mytemp.email mytrashmail.com
nada.email nwldx.com
one-time.email
sharklasers.com spam4.me spambox.us spamgourmet.com spamex.com
temp-mail.io temp-mail.org tempail.com tempinbox.com tempmail.dev tempmail.net tempmail.plus tempmailo.com tempr.email throwawaymail.com tmail.ws tmpmail.net tmpmail.org trash-mail.com trashmail.com trashmail.de trashmail.net
yopmail.com yopmail.fr yopmail.net
`
  .split(/\s+/)
  .filter(Boolean);

const SET = new Set(DOMAINS);

export function isDisposable(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (SET.has(domain)) return true;
  // Subdomains of listed services (e.g. x.mailinator.com).
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) if (SET.has(parts.slice(i).join("."))) return true;
  return false;
}
