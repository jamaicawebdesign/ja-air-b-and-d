export const STATUSES = { todo: "To do", in_progress: "In progress", done: "Done" };
export const KINDS = { cleaning: "Cleaning", maintenance: "Maintenance" };
export const ROLES = { cleaner: "Cleaner", maintenance: "Maintenance", manager: "Manager" };

const addDays = (iso, days) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// Least-loaded active cleaner among open tasks; ties go to the earliest-added staff member.
export function pickCleaner(staff, tasks) {
  const cleaners = staff.filter((member) => member.active && member.role === "cleaner");
  if (!cleaners.length) return null;
  const load = (member) => tasks.filter((task) => task.staffId === member.id && task.status !== "done").length;
  return cleaners.reduce((best, member) => (load(member) < load(best) ? member : best));
}

// Reservations checking out from 7 days ago to 3 days ahead that have no turnover task yet.
export function turnoversToCreate({ reservations, tasks, today }) {
  const known = new Set(tasks.filter((task) => task.reservationId && task.auto).map((task) => task.reservationId));
  return reservations.filter((reservation) =>
    reservation.status !== "cancelled" && !known.has(reservation.id) &&
    reservation.checkOut >= addDays(today, -7) && reservation.checkOut <= addDays(today, 3));
}

export function isOverdue(task, today) {
  return task.status !== "done" && task.dueDate < today;
}

export function notifyLink(member, message) {
  const digits = (member.phone || "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function smsLink(member, message) {
  return member.phone ? `sms:${member.phone}?body=${encodeURIComponent(message)}` : null;
}
