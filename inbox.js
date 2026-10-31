export const CHANNELS = {
  airbnb: "Airbnb",
  whatsapp: "WhatsApp",
  email: "Email",
  booking: "Booking.com",
  vrbo: "Vrbo",
  sms: "SMS"
};

export const TRIGGERS = {
  booking_confirmation: "Booking confirmation",
  pre_arrival: "Pre-arrival instructions",
  check_out: "Check-out rules",
  review_request: "Review request",
  auto_reply: "Auto-reply (keywords)"
};

// offset_days is relative to check-in for pre_arrival and to check-out for check_out/review_request.
export const STARTER_TEMPLATES = [
  { trigger: "booking_confirmation", name: "Booking confirmation", offset_days: 0, keywords: "", body: "Hi {guest}, your stay at {property} is confirmed for {check_in} to {check_out}. We can't wait to host you. Walk good!" },
  { trigger: "pre_arrival", name: "Pre-arrival instructions", offset_days: -1, keywords: "", body: "Hi {guest}, see you tomorrow! Check-in at {property} starts at 3 PM. Message me when you're on your way and I'll share the entry details." },
  { trigger: "check_out", name: "Check-out rules", offset_days: 0, keywords: "", body: "Hi {guest}, check-out from {property} is by 11 AM today. Please lock up, leave the keys inside, and let me know if you need anything." },
  { trigger: "review_request", name: "Review request", offset_days: 1, keywords: "", body: "Thanks for staying at {property}, {guest}! If you enjoyed your visit, a quick review would mean a lot to us. One love!" },
  { trigger: "auto_reply", name: "Wi-Fi & check-in questions", offset_days: 0, keywords: "wifi, wi-fi, password, check-in time, check in time", body: "Hi {guest}, thanks for reaching out! Check-in is from 3 PM and check-out by 11 AM. I'll send the Wi-Fi details shortly." }
];

export function fillTemplate(body, vars) {
  return body.replace(/\{(guest|property|check_in|check_out)\}/g, (_, key) => vars[key] ?? "");
}

const addDays = (iso, days) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export function dueDate(template, reservation) {
  if (template.trigger === "booking_confirmation") return reservation.createdAt || reservation.checkIn;
  if (template.trigger === "pre_arrival") return addDays(reservation.checkIn, template.offsetDays);
  return addDays(reservation.checkOut, template.offsetDays);
}

// Returns [{ template, reservation }] for automated messages that are due and not yet created.
export function dueMessages({ templates, reservations, sentKeys, today }) {
  const due = [];
  for (const template of templates) {
    if (!template.enabled || template.trigger === "auto_reply") continue;
    for (const reservation of reservations) {
      if (reservation.status === "cancelled" || reservation.source !== "direct") continue;
      if (sentKeys.has(`${reservation.id}:${template.trigger}`)) continue;
      const date = dueDate(template, reservation).slice(0, 10);
      // Ignore triggers that were due more than two weeks ago so enabling a template doesn't flood old stays.
      if (date <= today && date >= addDays(today, -14)) due.push({ template, reservation });
    }
  }
  return due;
}

export function matchAutoReply(templates, text) {
  const haystack = String(text).toLowerCase();
  return templates.find((template) =>
    template.enabled && template.trigger === "auto_reply" &&
    template.keywords.split(",").map((word) => word.trim().toLowerCase()).filter(Boolean).some((word) => haystack.includes(word))
  ) || null;
}

export function deliveryLink(conversation, body) {
  const contact = conversation.guestContact.trim();
  if (conversation.channel === "whatsapp" || conversation.channel === "sms") {
    const digits = contact.replace(/\D/g, "");
    return conversation.channel === "whatsapp" && digits ? `https://wa.me/${digits}?text=${encodeURIComponent(body)}` : contact ? `sms:${contact}?body=${encodeURIComponent(body)}` : null;
  }
  if (conversation.channel === "email" && contact.includes("@")) return `mailto:${contact}?subject=${encodeURIComponent("Your stay")}&body=${encodeURIComponent(body)}`;
  return null;
}
