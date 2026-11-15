/** Link that opens a WhatsApp chat with a ready message. An empty number lets the person pick the contact. */
export function whatsAppChatUrl(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

function isMobileUserAgent(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

/** Phones open the app through wa.me; computers open WhatsApp Web. */
export function whatsAppSendUrl(input: { text: string; phone: string; userAgent: string }): string {
  const number = input.phone.trim();
  const encodedText = encodeURIComponent(input.text);
  if (isMobileUserAgent(input.userAgent)) {
    return `https://wa.me/${number}?text=${encodedText}`;
  }
  return `https://web.whatsapp.com/send?phone=${number}&text=${encodedText}`;
}
