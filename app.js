"use strict";

import { createClient } from "@supabase/supabase-js";
import { PLATFORMS, findConflicts, parseIcal } from "./ical.js";
import { CATEGORIES, monthRange, ownerPayout, propertyStats, statementHtml, sumStats } from "./reports.js";
import { KINDS, ROLES, STATUSES, isOverdue, notifyLink, pickCleaner, smsLink, turnoversToCreate } from "./ops.js";
import { CHANNELS, STARTER_TEMPLATES, TRIGGERS, deliveryLink, dueMessages, fillTemplate, matchAutoReply } from "./inbox.js";

const CURRENCY_KEY = "havenstay-currency-v1";
const viewRoot = document.querySelector("#view-root");
const dialog = document.querySelector("#editor-dialog");
const form = document.querySelector("#editor-form");
const formFields = document.querySelector("#form-fields");
const toast = document.querySelector("#toast");
const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector(".app-shell");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const authSubmit = document.querySelector("#auth-submit");
const authMode = () => authForm.dataset.mode || "signin";
let currentView = "overview";
let editor = { type: null, id: null };
let toastTimer;
let supabase = null;
let currentUser = null;
let loadingUserId = null;

const dateOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
};

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

let data = { properties: [], reservations: [], channels: [], conversations: [], messages: [], templates: [], staff: [], tasks: [], owners: [], expenses: [], site: null };
let reportMonth = "";
let reportOwner = "all";
let opsRunning = false;
const photoUrls = new Map();
let selectedConversationId = null;
let automating = false;
let syncing = false;

function mapProperty(row) {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    bedrooms: row.bedrooms,
    rate: Number(row.rate),
    description: row.description || "",
    ownerId: row.owner_id || null,
    listed: Boolean(row.listed)
  };
}

function mapReservation(row) {
  return {
    id: row.id,
    propertyId: row.property_id,
    guest: row.guest,
    email: row.email,
    phone: row.phone || "",
    checkIn: row.check_in,
    checkOut: row.check_out,
    guests: row.guests,
    amount: Number(row.amount),
    status: row.status,
    notes: row.notes || "",
    source: row.source || "direct",
    channelId: row.channel_id || null,
    externalUid: row.external_uid || null,
    createdAt: row.created_at || ""
  };
}

function mapConversation(row) {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    guestName: row.guest_name,
    guestContact: row.guest_contact || "",
    channel: row.channel,
    unread: row.unread || 0,
    lastMessageAt: row.last_message_at
  };
}

function mapMessage(row) {
  return { id: row.id, conversationId: row.conversation_id, reservationId: row.reservation_id, direction: row.direction, body: row.body, status: row.status, triggerKey: row.trigger_key, createdAt: row.created_at };
}

function mapTemplate(row) {
  return { id: row.id, trigger: row.trigger, name: row.name, body: row.body, offsetDays: row.offset_days, keywords: row.keywords || "", enabled: row.enabled };
}

function mapStaff(row) {
  return { id: row.id, name: row.name, phone: row.phone || "", role: row.role, active: row.active };
}

function mapTask(row) {
  return {
    id: row.id, propertyId: row.property_id, reservationId: row.reservation_id, staffId: row.staff_id, kind: row.kind,
    title: row.title, notes: row.notes || "", dueDate: row.due_date, status: row.status, auto: row.auto,
    notifiedAt: row.notified_at, photos: row.photo_paths || [], completedAt: row.completed_at
  };
}

function mapOwner(row) {
  return { id: row.id, name: row.name, email: row.email || "", phone: row.phone || "", feePct: Number(row.fee_pct) };
}

function mapExpense(row) {
  return { id: row.id, propertyId: row.property_id, category: row.category, description: row.description || "", amount: Number(row.amount), date: row.expense_date };
}

function mapSite(row) {
  return row ? { id: row.id, slug: row.slug, brandName: row.brand_name, tagline: row.tagline || "", email: row.contact_email || "", phone: row.contact_phone || "", enabled: row.enabled } : null;
}

function mapChannel(row) {
  return {
    id: row.id,
    propertyId: row.property_id,
    platform: row.platform,
    icalUrl: row.ical_url || "",
    priceAdjust: Number(row.price_adjust_pct) || 0,
    token: row.export_token,
    lastSyncedAt: row.last_synced_at,
    lastStatus: row.last_status || "never synced"
  };
}

async function loadData() {
  const requestedUserId = currentUser?.id;
  const [propertiesResult, reservationsResult, channelsResult, conversationsResult, messagesResult, templatesResult, staffResult, tasksResult, ownersResult, expensesResult, siteResult] = await Promise.all([
    supabase.from("properties").select("*").order("created_at", { ascending: true }),
    supabase.from("reservations").select("*").order("check_in", { ascending: true }),
    supabase.from("channels").select("*").order("created_at", { ascending: true }),
    supabase.from("conversations").select("*").order("last_message_at", { ascending: false }),
    supabase.from("messages").select("*").order("created_at", { ascending: true }),
    supabase.from("message_templates").select("*").order("created_at", { ascending: true }),
    supabase.from("staff").select("*").order("created_at", { ascending: true }),
    supabase.from("tasks").select("*").order("due_date", { ascending: true }),
    supabase.from("owners").select("*").order("created_at", { ascending: true }),
    supabase.from("expenses").select("*").order("expense_date", { ascending: false }),
    supabase.from("booking_sites").select("*").maybeSingle()
  ]);
  if (siteResult.error) console.warn("Website unavailable. Run the direct booking section of supabase/schema.sql.", siteResult.error);
  const financeMissing = Boolean(ownersResult.error || expensesResult.error);
  if (financeMissing) console.warn("Reports unavailable. Run the owner/reporting section of supabase/schema.sql.", ownersResult.error || expensesResult.error);
  const opsMissing = Boolean(staffResult.error || tasksResult.error);
  if (opsMissing) console.warn("Operations unavailable. Run the operations section of supabase/schema.sql.", staffResult.error || tasksResult.error);
  const inboxMissing = Boolean(conversationsResult.error || messagesResult.error || templatesResult.error);
  if (inboxMissing) console.warn("Inbox unavailable. Run the inbox section of supabase/schema.sql.", conversationsResult.error || messagesResult.error || templatesResult.error);
  if (propertiesResult.error) throw propertiesResult.error;
  if (reservationsResult.error) throw reservationsResult.error;
  const channelsMissing = Boolean(channelsResult.error);
  if (channelsMissing) console.warn("Channels unavailable. Run the channel section of supabase/schema.sql.", channelsResult.error);
  if (!requestedUserId || currentUser?.id !== requestedUserId) return;
  data = {
    properties: propertiesResult.data.map(mapProperty),
    reservations: reservationsResult.data.map(mapReservation),
    channels: channelsMissing ? [] : channelsResult.data.map(mapChannel),
    conversations: inboxMissing ? [] : conversationsResult.data.map(mapConversation),
    messages: inboxMissing ? [] : messagesResult.data.map(mapMessage),
    templates: inboxMissing ? [] : templatesResult.data.map(mapTemplate),
    staff: opsMissing ? [] : staffResult.data.map(mapStaff),
    tasks: opsMissing ? [] : tasksResult.data.map(mapTask),
    owners: financeMissing ? [] : ownersResult.data.map(mapOwner),
    expenses: financeMissing ? [] : expensesResult.data.map(mapExpense),
    site: siteResult.error ? null : mapSite(siteResult.data)
  };
  void runOps({ quiet: true });
  void runAutomations({ quiet: true });
  render();
}

function setAuthMessage(message, isError = true) {
  authMessage.textContent = message;
  authMessage.classList.toggle("auth-success", !isError);
}

function showAuth() {
  authScreen.hidden = false;
  appShell.hidden = true;
}

function showApp() {
  authScreen.hidden = true;
  appShell.hidden = false;
}

async function handleSession(session) {
  const nextUser = session?.user || null;
  if (!nextUser) {
    currentUser = null;
    loadingUserId = null;
    data = { properties: [], reservations: [] };
    showAuth();
    return;
  }
  if (currentUser?.id === nextUser.id && loadingUserId === nextUser.id) return;
  currentUser = nextUser;
  loadingUserId = nextUser.id;
  showApp();
  const name = displayName();
  document.querySelector("#profile-name").textContent = name;
  document.querySelectorAll(".avatar").forEach((avatar) => { avatar.textContent = initials(name); });
  document.querySelector("#page-title").innerHTML = `${greeting()}, ${escapeHtml(name)} <span class="wave">✦</span>`;
  viewRoot.innerHTML = `<section class="panel"><div class="empty-state">Loading your workspace…</div></section>`;
  try {
    await loadData();
  } catch (error) {
    console.error("Could not load your Supabase workspace.", error);
    viewRoot.innerHTML = `<section class="panel"><div class="empty-state"><strong>Couldn't load your workspace</strong><p>${escapeHtml(error.message || "Check your Supabase setup and try again.")}</p><button class="button button-secondary" id="retry-load">Try again</button></div></section>`;
    document.querySelector("#retry-load").addEventListener("click", async () => {
      try { await loadData(); } catch (retryError) {
        console.error("Could not reload your Supabase workspace.", retryError);
        showToast(retryError.message || "Could not reload workspace.");
      }
    });
  }
}

function initializeSupabase() {
  showAuth();
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("your-project-id") || key.includes("your-supabase")) {
    showAuth();
    document.querySelector("#auth-config-warning").hidden = false;
    authSubmit.disabled = true;
    return;
  }
  try {
    supabase = createClient(url, key);
    supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => { void handleSession(session); }, 0);
    });
  } catch (error) {
    console.error("Could not initialize Supabase.", error);
    const warning = document.querySelector("#auth-config-warning");
    warning.textContent = `Supabase configuration is invalid: ${error.message}`;
    warning.hidden = false;
    authSubmit.disabled = true;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function currencyCode() {
  return document.querySelector("#currency-select").value;
}

function displayName() {
  const fullName = currentUser?.user_metadata?.full_name?.trim();
  if (fullName) return fullName;
  const emailName = currentUser?.email?.split("@")[0] || "Landlord";
  return emailName.split(/[._-]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ") || "Landlord";
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function nightsBetween(start, end) {
  return Math.round((parseDate(end) - parseDate(start)) / 86400000);
}

function occupancyFor(property, today) {
  const windowEnd = localDate(new Date(parseDate(today).getTime() + 30 * 86400000));
  const nights = data.reservations
    .filter((reservation) => reservation.propertyId === property.id && reservation.status !== "cancelled")
    .reduce((total, reservation) => {
      const from = reservation.checkIn > today ? reservation.checkIn : today;
      const to = reservation.checkOut < windowEnd ? reservation.checkOut : windowEnd;
      return total + Math.max(0, nightsBetween(from, to));
    }, 0);
  return { nights, percent: Math.min(100, Math.round((nights / 30) * 100)) };
}

function storedCurrency() {
  try {
    return localStorage.getItem(CURRENCY_KEY) || "USD";
  } catch (error) {
    console.error("Could not load currency preference.", error);
    return "USD";
  }
}

function money(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode(),
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function formatDate(value, options = { month: "short", day: "numeric" }) {
  if (!value) return "—";
  return parseDate(value).toLocaleDateString(undefined, options);
}

function propertyFor(reservation) {
  return data.properties.find((property) => property.id === reservation.propertyId);
}

function sourceBadge(reservation) {
  const label = PLATFORMS[reservation.source] || "Direct";
  const conflict = findConflicts(data.reservations).ids.has(reservation.id) ? `<span class="chip chip-conflict">Double booked</span>` : "";
  return `<span class="chip chip-${escapeHtml(reservation.source)}">${escapeHtml(label)}</span>${conflict}`;
}

function updateConflictBadge() {
  const count = findConflicts(data.reservations).pairs.length;
  const badge = document.querySelector("#channels-badge");
  if (!badge) return;
  badge.textContent = count;
  badge.hidden = count === 0;
  const opsBadge = document.querySelector("#ops-badge");
  if (opsBadge) {
    const open = data.tasks.filter((task) => task.status !== "done").length;
    opsBadge.textContent = open;
    opsBadge.hidden = open === 0;
  }
  const inboxBadge = document.querySelector("#inbox-badge");
  if (inboxBadge) {
    const pending = data.conversations.reduce((total, entry) => total + entry.unread, 0) + data.messages.filter((entry) => entry.status === "queued").length;
    inboxBadge.textContent = pending;
    inboxBadge.hidden = pending === 0;
  }
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setTodayLabel() {
  document.querySelector("#today-label").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  }).toUpperCase();
}

function navTo(view) {
  currentView = view;
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const labels = { overview: "Overview", reservations: "Reservations", properties: "Properties", channels: "Channels", inbox: "Inbox", operations: "Operations", reports: "Reports", website: "Website" };
  document.querySelector("#breadcrumb-current").textContent = labels[view];
  const title = document.querySelector("#page-title");
  const subtitle = document.querySelector("#page-subtitle");
  title.innerHTML = view === "overview" ? `${greeting()}, ${escapeHtml(displayName())} <span class="wave">✦</span>` : labels[view];
  subtitle.textContent = {
    overview: "Here’s what’s happening with your stays.",
    reservations: "Keep guest details and upcoming stays organized.",
    properties: "Manage the places you welcome guests to.",
    website: "Launch your own booking site and skip OTA service fees.",
    reports: "Revenue, occupancy, ADR, expenses and owner statements.",
    operations: "Turnover cleaning and maintenance, assigned and tracked.",
    inbox: "Every guest conversation in one place, with automated messages.",
    channels: "Keep Airbnb, Vrbo and Booking.com calendars in sync to prevent double bookings."
  }[view];
  render();
  if (view === "channels") void syncAll({ quiet: true });
  if (view === "inbox") void runAutomations({ quiet: true });
  if (view === "operations") void runOps({ quiet: true });
}

function render() {
  if (currentView === "overview") renderOverview();
  if (currentView === "reservations") renderReservations();
  if (currentView === "properties") renderProperties();
  if (currentView === "channels") renderChannels();
  if (currentView === "inbox") renderInbox();
  if (currentView === "operations") renderOperations();
  if (currentView === "reports") renderReports();
  if (currentView === "website") renderWebsite();
  updateConflictBadge();
}

function statCard(label, value, note, icon) {
  return `<article class="stat-card">
    <div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div>
    <div class="stat-value">${value}</div><div class="stat-note">${note}</div>
  </article>`;
}

function reservationRows(reservations) {
  if (!reservations.length) return `<tr><td colspan="5"><div class="empty-state"><span class="empty-icon">▤</span><strong>No reservations yet</strong><p>Add a reservation to see it here.</p></div></td></tr>`;
  return reservations.map((reservation) => {
    const property = propertyFor(reservation);
    return `<tr>
      <td><div class="guest-cell"><span class="mini-avatar">${escapeHtml(initials(reservation.guest))}</span><span><span class="guest-name">${escapeHtml(reservation.guest)}</span><span class="guest-property">${escapeHtml(property?.name || "Property removed")} ${sourceBadge(reservation)}</span></span></div></td>
      <td>${formatDate(reservation.checkIn)} – ${formatDate(reservation.checkOut)}</td>
      <td>${Number(reservation.guests) || 1} ${Number(reservation.guests) === 1 ? "guest" : "guests"}</td>
      <td><span class="status status-${escapeHtml(reservation.status)}">${escapeHtml(reservation.status)}</span></td>
      <td>${money(reservation.amount)}</td>
    </tr>`;
  }).join("");
}

function renderOverview() {
  const today = localDate(new Date());
  const upcoming = data.reservations
    .filter((reservation) => reservation.status !== "cancelled" && reservation.checkOut >= today)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const confirmedBookings = upcoming.filter((reservation) => reservation.status === "confirmed");
  const expectedRevenue = confirmedBookings.reduce((total, reservation) => total + (Number(reservation.amount) || 0), 0);
  const nextSevenDays = data.reservations.filter((reservation) => {
    const days = (parseDate(reservation.checkIn) - parseDate(today)) / 86400000;
    return reservation.status !== "cancelled" && days >= 0 && days <= 7;
  }).length;
  const recent = upcoming.slice(0, 4);
  const recentActivity = upcoming.slice(0, 3);

  viewRoot.innerHTML = `
    <div class="stats-grid">
      ${statCard("Total properties", data.properties.length, "Places in your portfolio", "⌂")}
      ${statCard("Confirmed stays", confirmedBookings.length, "Across all your properties", "▤")}
      ${statCard("Expected revenue", money(expectedRevenue), "From upcoming confirmed stays", "$")}
      ${statCard("Arrivals this week", nextSevenDays, "Guests checking in soon", "↗")}
    </div>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-heading"><div><h2>Upcoming reservations</h2><p>Your next guest arrivals</p></div><button class="text-button" data-navigate="reservations">View all →</button></div>
        <div class="table-wrap"><table><thead><tr><th>GUEST</th><th>DATES</th><th>PARTY</th><th>STATUS</th><th>TOTAL</th></tr></thead><tbody>${reservationRows(recent)}</tbody></table></div>
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Coming up</h2><p>A quick look at your calendar</p></div></div>
        <div class="activity-list">
          ${recentActivity.length ? recentActivity.map((reservation) => {
            const property = propertyFor(reservation);
            return `<div class="activity-item"><span class="activity-dot ${reservation.status === "pending" ? "pending" : ""}"></span><div class="activity-copy"><strong>${escapeHtml(reservation.guest)} ${reservation.status === "pending" ? "requested a stay" : "checks in"} ${formatDate(reservation.checkIn, { month: "short", day: "numeric" })}</strong><p>${escapeHtml(property?.name || "Property removed")} · ${Number(reservation.guests) || 1} ${Number(reservation.guests) === 1 ? "guest" : "guests"}</p></div></div>`;
          }).join("") : `<div class="empty-state"><strong>Nothing on the calendar</strong><p>New stays will appear here.</p></div>`}
        </div>
      </section>
    </div>
    <section class="panel occupancy-panel">
      <div class="panel-heading"><div><h2>Occupancy</h2><p>Booked nights over the next 30 days</p></div></div>
      <div class="occupancy-list">
        ${data.properties.length ? data.properties.map((property) => {
          const { nights, percent } = occupancyFor(property, today);
          return `<div class="occupancy-row"><div class="occupancy-name"><strong>${escapeHtml(property.name)}</strong><span>${escapeHtml(property.location)}</span></div><div class="occupancy-bar" role="img" aria-label="${percent}% occupied"><span style="width:${percent}%"></span></div><div class="occupancy-value"><strong>${percent}%</strong><span>${nights} ${nights === 1 ? "night" : "nights"}</span></div></div>`;
        }).join("") : `<div class="empty-state"><strong>No properties yet</strong><p>Add a property to track how often it's booked.</p></div>`}
      </div>
    </section>`;
}

function renderReservations() {
  const query = (document.querySelector("#reservation-search")?.value || "").trim().toLowerCase();
  const statusFilter = document.querySelector("#reservation-status")?.value || "all";
  const filtered = data.reservations
    .filter((reservation) => {
      const property = propertyFor(reservation);
      const matchesQuery = [reservation.guest, reservation.email, property?.name].some((value) => String(value || "").toLowerCase().includes(query));
      return matchesQuery && (statusFilter === "all" || reservation.status === statusFilter);
    })
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  viewRoot.innerHTML = `
    <div class="toolbar">
      <span class="toolbar-title">${filtered.length} ${filtered.length === 1 ? "reservation" : "reservations"}</span>
      <div class="toolbar-filters">
        <input id="reservation-search" class="search-input" type="search" placeholder="Search guests or properties" value="${escapeHtml(query)}" aria-label="Search reservations">
        <select id="reservation-status" class="filter-select" aria-label="Filter by status">
          <option value="all" ${statusFilter === "all" ? "selected" : ""}>All statuses</option>
          <option value="confirmed" ${statusFilter === "confirmed" ? "selected" : ""}>Confirmed</option>
          <option value="pending" ${statusFilter === "pending" ? "selected" : ""}>Pending</option>
          <option value="cancelled" ${statusFilter === "cancelled" ? "selected" : ""}>Cancelled</option>
        </select>
      </div>
    </div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>GUEST</th><th>DATES</th><th>PARTY</th><th>STATUS</th><th>TOTAL</th><th></th></tr></thead>
      <tbody>${filtered.length ? filtered.map((reservation) => {
        const property = propertyFor(reservation);
        return `<tr>
          <td><div class="guest-cell"><span class="mini-avatar">${escapeHtml(initials(reservation.guest))}</span><span><span class="guest-name">${escapeHtml(reservation.guest)}</span><span class="guest-property">${escapeHtml(property?.name || "Property removed")} ${sourceBadge(reservation)}</span></span></div></td>
          <td>${formatDate(reservation.checkIn)} – ${formatDate(reservation.checkOut)}</td>
          <td>${Number(reservation.guests) || 1} ${Number(reservation.guests) === 1 ? "guest" : "guests"}</td>
          <td><span class="status status-${escapeHtml(reservation.status)}">${escapeHtml(reservation.status)}</span></td>
          <td>${money(reservation.amount)}</td>
          <td><div class="property-actions"><button class="small-button" data-action="edit-reservation" data-id="${escapeHtml(reservation.id)}">Edit</button><button class="small-button danger" data-action="delete-reservation" data-id="${escapeHtml(reservation.id)}">Remove</button></div></td>
        </tr>`;
      }).join("") : `<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">▤</span><strong>No matching reservations</strong><p>Try changing your search or add a new reservation.</p></div></td></tr>`}</tbody>
    </table></div></section>`;
}

function exportUrl(channel) {
  return `${window.location.origin}/api/calendar?token=${channel.token}`;
}

function renderCalendarGrid() {
  const days = 30;
  const start = parseDate(localDate(new Date()));
  const dates = Array.from({ length: days }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return localDate(day);
  });
  const { ids } = findConflicts(data.reservations);
  const header = dates.map((date) => `<span class="cal-day ${parseDate(date).getDate() === 1 ? "cal-first" : ""}" title="${date}">${parseDate(date).getDate()}</span>`).join("");
  const rows = data.properties.map((property) => {
    const cells = dates.map((date) => {
      const hits = data.reservations.filter((entry) => entry.propertyId === property.id && entry.status !== "cancelled" && entry.checkIn <= date && date < entry.checkOut);
      if (!hits.length) return `<span class="cal-cell"></span>`;
      const conflict = hits.length > 1 || hits.some((entry) => ids.has(entry.id));
      const top = hits[0];
      return `<span class="cal-cell booked src-${escapeHtml(top.source)} ${conflict ? "conflict" : ""}" title="${escapeHtml(top.guest)} · ${escapeHtml(PLATFORMS[top.source] || "Direct")}${conflict ? " · DOUBLE BOOKED" : ""}"></span>`;
    }).join("");
    return `<div class="cal-row"><span class="cal-name">${escapeHtml(property.name)}</span><div class="cal-cells">${cells}</div></div>`;
  }).join("");
  return `<div class="cal-grid"><div class="cal-row cal-head"><span class="cal-name"></span><div class="cal-cells">${header}</div></div>${rows}</div>
    <div class="cal-legend"><span><i class="src-direct"></i>Direct</span><span><i class="src-airbnb"></i>Airbnb</span><span><i class="src-vrbo"></i>Vrbo</span><span><i class="src-booking"></i>Booking.com</span><span><i class="src-other"></i>Other</span><span><i class="conflict-key"></i>Double booked</span></div>`;
}

function renderChannels() {
  const { pairs } = findConflicts(data.reservations);
  const conflictHtml = pairs.length ? `<section class="panel conflict-panel"><div class="panel-heading"><div><h2>⚠ ${pairs.length} double ${pairs.length === 1 ? "booking" : "bookings"} to resolve</h2><p>These stays overlap on the same property. Cancel or move one of each pair.</p></div></div>
    <div class="activity-list">${pairs.map(([a, b]) => `<div class="activity-item"><span class="activity-dot conflict-dot"></span><div class="activity-copy"><strong>${escapeHtml(propertyFor(a)?.name || "Property")}</strong><p>${escapeHtml(a.guest)} (${escapeHtml(PLATFORMS[a.source] || "Direct")}, ${formatDate(a.checkIn)}–${formatDate(a.checkOut)}) overlaps ${escapeHtml(b.guest)} (${escapeHtml(PLATFORMS[b.source] || "Direct")}, ${formatDate(b.checkIn)}–${formatDate(b.checkOut)})</p></div></div>`).join("")}</div></section>` : "";
  const channelRows = data.channels.map((channel) => {
    const property = data.properties.find((entry) => entry.id === channel.propertyId);
    const price = property ? money(property.rate * (1 + channel.priceAdjust / 100)) : "–";
    const synced = channel.lastSyncedAt ? new Date(channel.lastSyncedAt).toLocaleString() : "Never";
    return `<tr>
      <td><span class="chip chip-${escapeHtml(channel.platform)}">${escapeHtml(PLATFORMS[channel.platform])}</span></td>
      <td>${escapeHtml(property?.name || "Property removed")}</td>
      <td>${price}<span class="guest-property">${channel.priceAdjust >= 0 ? "+" : ""}${channel.priceAdjust}% on base rate</span></td>
      <td>${escapeHtml(channel.lastStatus)}<span class="guest-property">${escapeHtml(synced)}</span></td>
      <td><div class="property-actions">
        <button class="small-button" data-action="sync-channel" data-id="${escapeHtml(channel.id)}" ${channel.icalUrl ? "" : "disabled"}>Sync</button>
        <button class="small-button" data-action="copy-feed" data-id="${escapeHtml(channel.id)}">Copy export link</button>
        <button class="small-button" data-action="edit-channel" data-id="${escapeHtml(channel.id)}">Edit</button>
        <button class="small-button danger" data-action="delete-channel" data-id="${escapeHtml(channel.id)}">Remove</button>
      </div></td></tr>`;
  }).join("");
  viewRoot.innerHTML = `
    <div class="toolbar">
      <span class="toolbar-title">${data.channels.length} connected ${data.channels.length === 1 ? "channel" : "channels"}</span>
      <div class="toolbar-filters">
        <button class="button button-secondary" data-action="sync-all" ${syncing || !data.channels.some((c) => c.icalUrl) ? "disabled" : ""}>${syncing ? "Syncing…" : "Sync all now"}</button>
        <button class="button button-primary" data-action="add-channel">+ Connect channel</button>
      </div>
    </div>
    ${conflictHtml}
    <section class="panel"><div class="panel-heading"><div><h2>Multi-calendar</h2><p>Next 30 days across every property and channel</p></div></div>${data.properties.length ? renderCalendarGrid() : `<div class="empty-state"><strong>No properties yet</strong><p>Add a property to see its calendar.</p></div>`}</section>
    <section class="panel"><div class="panel-heading"><div><h2>Connected channels</h2><p>Import each channel's calendar link, then paste your export link into that channel so it sees your other bookings.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>CHANNEL</th><th>PROPERTY</th><th>CHANNEL RATE</th><th>LAST SYNC</th><th></th></tr></thead>
      <tbody>${channelRows || `<tr><td colspan="5"><div class="empty-state"><span class="empty-icon">⇄</span><strong>No channels connected</strong><p>Connect Airbnb, Vrbo or Booking.com to keep calendars in sync.</p></div></td></tr>`}</tbody></table></div></section>
    <p class="note">Availability syncs through each channel's iCal calendar (imports run when you press Sync or when you open this page, then every 15 minutes while it stays open). Pricing shown per channel is your base rate plus the adjustment; push prices, photos and policies in each channel's own settings.</p>`;
}

async function syncChannel(channel, { quiet = false } = {}) {
  const property = data.properties.find((entry) => entry.id === channel.propertyId);
  let status = "";
  try {
    const response = await fetch(`/api/ical-proxy?url=${encodeURIComponent(channel.icalUrl)}`);
    if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
    const events = parseIcal(await response.text());
    const today = localDate(new Date());
    const known = new Map(data.reservations.filter((entry) => entry.channelId === channel.id).map((entry) => [entry.externalUid, entry]));
    const rows = events.filter((event) => event.end >= today).map((event) => ({
      user_id: currentUser.id,
      property_id: channel.propertyId,
      channel_id: channel.id,
      external_uid: event.uid,
      source: channel.platform,
      guest: event.summary.slice(0, 120) || "Reserved",
      email: "",
      guests: 1,
      amount: 0,
      check_in: event.start,
      check_out: event.end,
      status: "confirmed",
      notes: `Imported from ${PLATFORMS[channel.platform]}`
    }));
    if (rows.length) {
      const { error } = await supabase.from("reservations").upsert(rows, { onConflict: "channel_id,external_uid" });
      if (error) throw error;
    }
    const seen = new Set(events.map((event) => event.uid));
    const goneIds = [...known.values()].filter((entry) => entry.checkOut >= today && entry.status !== "cancelled" && !seen.has(entry.externalUid)).map((entry) => entry.id);
    if (goneIds.length) {
      const { error } = await supabase.from("reservations").update({ status: "cancelled" }).in("id", goneIds);
      if (error) throw error;
    }
    status = `${rows.length} blocked ${rows.length === 1 ? "range" : "ranges"} imported`;
  } catch (error) {
    console.error("Channel sync failed.", error);
    status = `Failed: ${String(error.message || error).slice(0, 80)}`;
  }
  const { data: saved } = await supabase.from("channels").update({ last_synced_at: new Date().toISOString(), last_status: status }).eq("id", channel.id).select("*").single();
  if (saved) data.channels = data.channels.map((entry) => entry.id === channel.id ? mapChannel(saved) : entry);
  if (!quiet) showToast(`${PLATFORMS[channel.platform]}${property ? ` · ${property.name}` : ""}: ${status}`);
  return !status.startsWith("Failed");
}

async function syncAll({ quiet = false } = {}) {
  if (syncing || !supabase || !currentUser) return;
  const targets = data.channels.filter((channel) => channel.icalUrl);
  if (!targets.length) return;
  syncing = true;
  if (currentView === "channels") render();
  try {
    for (const channel of targets) await syncChannel(channel, { quiet });
    const { data: rows, error } = await supabase.from("reservations").select("*").order("check_in", { ascending: true });
    if (!error) data.reservations = rows.map(mapReservation);
  } finally {
    syncing = false;
    render();
  }
}

function conversationMessages(id) {
  return data.messages.filter((message) => message.conversationId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function messageVars(reservation) {
  const property = reservation ? propertyFor(reservation) : null;
  return {
    guest: reservation?.guest || "there",
    property: property?.name || "our place",
    check_in: reservation ? formatDate(reservation.checkIn, { month: "short", day: "numeric", year: "numeric" }) : "",
    check_out: reservation ? formatDate(reservation.checkOut, { month: "short", day: "numeric", year: "numeric" }) : ""
  };
}

function formatStamp(value) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function renderInbox() {
  const conversations = [...data.conversations].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  if (!conversations.some((entry) => entry.id === selectedConversationId)) selectedConversationId = conversations[0]?.id || null;
  const active = conversations.find((entry) => entry.id === selectedConversationId);
  const list = conversations.map((entry) => {
    const last = conversationMessages(entry.id).at(-1);
    return `<button class="convo ${entry.id === selectedConversationId ? "active" : ""}" data-action="open-conversation" data-id="${escapeHtml(entry.id)}">
      <span class="mini-avatar">${escapeHtml(initials(entry.guestName))}</span>
      <span class="convo-body"><span class="convo-top"><strong>${escapeHtml(entry.guestName)}</strong>${entry.unread ? `<span class="nav-badge">${entry.unread}</span>` : ""}</span>
      <span class="chip chip-${escapeHtml(entry.channel)}">${escapeHtml(CHANNELS[entry.channel])}</span>
      <span class="convo-preview">${escapeHtml(last?.body || "No messages yet")}</span></span></button>`;
  }).join("");
  const thread = active ? conversationMessages(active.id).map((message) => {
    const link = message.direction === "out" ? deliveryLink(active, message.body) : null;
    const queued = message.status === "queued";
    return `<div class="bubble ${message.direction === "out" ? "bubble-out" : "bubble-in"} ${queued ? "bubble-queued" : ""}">
      <p>${escapeHtml(message.body)}</p>
      <span class="bubble-meta">${message.triggerKey ? `⚙ ${escapeHtml(TRIGGERS[message.triggerKey] || "Automated")} · ` : ""}${queued ? "Ready to send · " : ""}${escapeHtml(formatStamp(message.createdAt))}
      ${message.direction === "out" && queued ? (link ? `<a class="small-button" href="${escapeHtml(link)}" target="_blank" rel="noopener" data-action="mark-sent" data-id="${escapeHtml(message.id)}">Send via ${escapeHtml(CHANNELS[active.channel])} ↗</a>` : `<button class="small-button" data-action="mark-sent" data-id="${escapeHtml(message.id)}">Mark as sent</button>`) : ""}
      ${message.direction === "out" && !queued && link ? `<a class="small-button" href="${escapeHtml(link)}" target="_blank" rel="noopener">Open in ${escapeHtml(CHANNELS[active.channel])} ↗</a>` : ""}</span></div>`;
  }).join("") || `<div class="empty-state"><strong>No messages yet</strong><p>Write the first message below.</p></div>` : "";
  const templateRows = data.templates.map((template) => `<tr>
    <td><strong>${escapeHtml(template.name)}</strong><span class="guest-property">${escapeHtml(TRIGGERS[template.trigger])}${template.trigger === "auto_reply" ? ` · keywords: ${escapeHtml(template.keywords || "none")}` : template.trigger === "booking_confirmation" ? "" : ` · ${template.offsetDays > 0 ? `${template.offsetDays} day(s) after` : template.offsetDays < 0 ? `${-template.offsetDays} day(s) before` : "on"} ${template.trigger === "pre_arrival" ? "check-in" : "check-out"}`}</span></td>
    <td class="template-body">${escapeHtml(template.body)}</td>
    <td><span class="status status-${template.enabled ? "confirmed" : "cancelled"}">${template.enabled ? "On" : "Off"}</span></td>
    <td><div class="property-actions"><button class="small-button" data-action="toggle-template" data-id="${escapeHtml(template.id)}">${template.enabled ? "Turn off" : "Turn on"}</button><button class="small-button" data-action="edit-template" data-id="${escapeHtml(template.id)}">Edit</button><button class="small-button danger" data-action="delete-template" data-id="${escapeHtml(template.id)}">Remove</button></div></td></tr>`).join("");
  viewRoot.innerHTML = `
    <div class="toolbar"><span class="toolbar-title">${conversations.length} ${conversations.length === 1 ? "conversation" : "conversations"}</span>
      <div class="toolbar-filters"><button class="button button-secondary" data-action="run-automations" ${automating ? "disabled" : ""}>${automating ? "Checking…" : "Run automations"}</button><button class="button button-primary" data-action="add-conversation">+ New conversation</button></div></div>
    <section class="panel inbox-panel">
      <div class="inbox-list">${list || `<div class="empty-state"><span class="empty-icon">✉</span><strong>No conversations</strong><p>Start one, or add a reservation to trigger automated messages.</p></div>`}</div>
      <div class="inbox-thread">${active ? `
        <div class="thread-head"><div><strong>${escapeHtml(active.guestName)}</strong><span class="guest-property">${escapeHtml(CHANNELS[active.channel])}${active.guestContact ? ` · ${escapeHtml(active.guestContact)}` : ""}</span></div>
          <button class="small-button danger" data-action="delete-conversation" data-id="${escapeHtml(active.id)}">Delete</button></div>
        <div class="thread-messages">${thread}</div>
        <form class="composer" id="composer-form"><textarea id="composer-text" required maxlength="4000" placeholder="Write a message…" aria-label="Message"></textarea>
          <div class="composer-actions"><select id="composer-direction" class="filter-select" aria-label="Message type"><option value="out">Reply to guest</option><option value="in">Log message from guest</option></select><button class="button button-primary" type="submit">Save message</button></div></form>` : `<div class="empty-state"><strong>Select a conversation</strong></div>`}</div>
    </section>
    <section class="panel"><div class="panel-heading"><div><h2>Automated messages</h2><p>Triggered by reservations. Use {guest}, {property}, {check_in} and {check_out}.</p></div>
      <div class="toolbar-filters">${data.templates.length ? "" : `<button class="button button-secondary" data-action="starter-templates">Add starter templates</button>`}<button class="button button-primary" data-action="add-template">+ New template</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>TEMPLATE</th><th>MESSAGE</th><th>STATUS</th><th></th></tr></thead><tbody>${templateRows || `<tr><td colspan="4"><div class="empty-state"><strong>No automations</strong><p>Add the starter set for confirmation, pre-arrival, check-out and review messages.</p></div></td></tr>`}</tbody></table></div></section>
    <p class="note">Messages from Airbnb, Booking.com and Vrbo can't be pulled in automatically without each platform's partner API, so log guest messages here (or forward them) and reply from one place. Automated messages are queued for you to send with one click via WhatsApp, SMS or email; the auto-reply matches keywords and drafts a response, with no external AI service.</p>`;
  const threadEl = viewRoot.querySelector(".thread-messages");
  if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
}

async function addMessage(conversation, { direction, body, status = "sent", triggerKey = null, reservationId = null }) {
  const { data: row, error } = await supabase.from("messages").insert({
    user_id: currentUser.id, conversation_id: conversation.id, reservation_id: reservationId, direction, body, status, trigger_key: triggerKey
  }).select("*").single();
  if (error) throw error;
  data.messages = [...data.messages, mapMessage(row)];
  const unread = direction === "in" ? conversation.unread + 1 : conversation.unread;
  const { data: saved } = await supabase.from("conversations").update({ unread, last_message_at: row.created_at }).eq("id", conversation.id).select("*").single();
  if (saved) data.conversations = data.conversations.map((entry) => entry.id === conversation.id ? mapConversation(saved) : entry);
  return row;
}

async function runAutomations({ quiet = false } = {}) {
  if (automating || !supabase || !currentUser || !data.templates.length) return;
  automating = true;
  let created = 0;
  try {
    const sentKeys = new Set(data.messages.filter((entry) => entry.triggerKey && entry.reservationId).map((entry) => `${entry.reservationId}:${entry.triggerKey}`));
    const due = dueMessages({ templates: data.templates, reservations: data.reservations, sentKeys, today: localDate(new Date()) });
    for (const { template, reservation } of due) {
      let conversation = data.conversations.find((entry) => entry.reservationId === reservation.id);
      if (!conversation) {
        const contact = reservation.phone || reservation.email;
        const { data: row, error } = await supabase.from("conversations").insert({
          user_id: currentUser.id, reservation_id: reservation.id, guest_name: reservation.guest,
          guest_contact: contact, channel: reservation.phone ? "whatsapp" : "email"
        }).select("*").single();
        if (error) throw error;
        conversation = mapConversation(row);
        data.conversations = [conversation, ...data.conversations];
      }
      try {
        await addMessage(conversation, { direction: "out", status: "queued", triggerKey: template.trigger, reservationId: reservation.id, body: fillTemplate(template.body, messageVars(reservation)) });
        created += 1;
      } catch (error) {
        if (error.code !== "23505") throw error;
      }
    }
  } catch (error) {
    console.error("Automations failed.", error);
    if (!quiet) showToast(error.message || "Could not run automations.");
  } finally {
    automating = false;
    if (created) {
      render();
      if (!quiet) showToast(`${created} automated ${created === 1 ? "message" : "messages"} ready to send.`);
    } else if (!quiet) {
      render();
      showToast("No automated messages are due.");
    }
  }
}

async function saveInboxItem(values) {
  const type = editor.type;
  const saveButton = document.querySelector("#save-button");
  saveButton.disabled = true;
  try {
    if (type === "conversation") {
      const reservation = data.reservations.find((entry) => entry.id === values.reservationId);
      const { data: row, error } = await supabase.from("conversations").insert({
        user_id: currentUser.id, reservation_id: reservation?.id || null, guest_name: values.guestName.trim(),
        guest_contact: values.guestContact.trim(), channel: values.channel
      }).select("*").single();
      if (error) throw error;
      const conversation = mapConversation(row);
      data.conversations = [conversation, ...data.conversations];
      selectedConversationId = conversation.id;
    } else {
      const payload = { trigger: values.trigger, name: values.name.trim(), body: values.body.trim(), offset_days: Number(values.offsetDays) || 0, keywords: (values.keywords || "").trim(), enabled: true };
      const request = editor.id ? supabase.from("message_templates").update(payload).eq("id", editor.id) : supabase.from("message_templates").insert({ ...payload, user_id: currentUser.id });
      const { data: row, error } = await request.select("*").single();
      if (error) throw error;
      const template = mapTemplate(row);
      data.templates = editor.id ? data.templates.map((entry) => entry.id === template.id ? template : entry) : [...data.templates, template];
    }
    dialog.close();
    render();
    showToast(type === "conversation" ? "Conversation started." : "Template saved.");
    if (type === "template") void runAutomations({ quiet: true });
  } catch (error) {
    console.error(`Could not save ${type}.`, error);
    showToast(error.message || `Could not save ${type}.`);
  } finally {
    saveButton.disabled = false;
  }
}

async function submitComposer(event) {
  event.preventDefault();
  const textarea = document.querySelector("#composer-text");
  const direction = document.querySelector("#composer-direction").value;
  const conversation = data.conversations.find((entry) => entry.id === selectedConversationId);
  const body = textarea.value.trim();
  if (!conversation || !body) return;
  event.submitter.disabled = true;
  try {
    const reservation = data.reservations.find((entry) => entry.id === conversation.reservationId);
    await addMessage(conversation, { direction, body, reservationId: null });
    if (direction === "in") {
      const reply = matchAutoReply(data.templates, body);
      const fresh = data.conversations.find((entry) => entry.id === conversation.id);
      if (reply && fresh) {
        await addMessage(fresh, { direction: "out", status: "queued", body: fillTemplate(reply.body, messageVars(reservation || { guest: conversation.guestName })) });
        showToast(`Auto-reply drafted: ${reply.name}.`);
      }
    }
    render();
  } catch (error) {
    console.error("Could not save message.", error);
    showToast(error.message || "Could not save message.");
    event.submitter.disabled = false;
  }
}

function taskMessage(task) {
  const property = data.properties.find((entry) => entry.id === task.propertyId);
  return `${KINDS[task.kind]} task: ${task.title}\n${property?.name || ""}${property?.location ? `, ${property.location}` : ""}\nDue ${formatDate(task.dueDate, { month: "short", day: "numeric", year: "numeric" })}${task.notes ? `\nNotes: ${task.notes}` : ""}\nPlease send a photo when done.`;
}

async function photoUrl(path) {
  if (photoUrls.has(path)) return photoUrls.get(path);
  const { data: signed } = await supabase.storage.from("task-photos").createSignedUrl(path, 3600);
  if (signed?.signedUrl) photoUrls.set(path, signed.signedUrl);
  return signed?.signedUrl || "";
}

async function hydratePhotos() {
  const images = [...viewRoot.querySelectorAll("img[data-photo-path]")];
  await Promise.all(images.map(async (image) => {
    const url = await photoUrl(image.dataset.photoPath);
    if (url) image.src = url;
  }));
}

function renderOperations() {
  const today = localDate(new Date());
  const open = data.tasks.filter((task) => task.status !== "done");
  const overdue = open.filter((task) => isOverdue(task, today)).length;
  const done = data.tasks.filter((task) => task.status === "done").length;
  const filter = viewRoot.dataset.taskFilter || "open";
  const shown = data.tasks
    .filter((task) => filter === "all" || (filter === "open" ? task.status !== "done" : task.status === "done"))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const card = (task) => {
    const property = data.properties.find((entry) => entry.id === task.propertyId);
    const member = data.staff.find((entry) => entry.id === task.staffId);
    const late = isOverdue(task, today);
    const message = taskMessage(task);
    const wa = member ? notifyLink(member, message) : null;
    const sms = member ? smsLink(member, message) : null;
    return `<article class="task-card ${late ? "task-late" : ""} task-${escapeHtml(task.status)}">
      <div class="task-top"><div><strong>${escapeHtml(task.title)}</strong><span class="guest-property">${escapeHtml(property?.name || "Property removed")} · due ${formatDate(task.dueDate)}${late ? " · OVERDUE" : ""}${task.auto ? " · auto" : ""}</span></div>
        <span class="chip chip-${task.kind === "cleaning" ? "direct" : "other"}">${escapeHtml(KINDS[task.kind])}</span></div>
      ${task.notes ? `<p class="task-notes">${escapeHtml(task.notes)}</p>` : ""}
      <div class="task-row"><label>Assigned to <select class="filter-select" data-task-assign="${escapeHtml(task.id)}"><option value="">Unassigned</option>${data.staff.filter((entry) => entry.active || entry.id === task.staffId).map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === task.staffId ? "selected" : ""}>${escapeHtml(entry.name)} (${escapeHtml(ROLES[entry.role])})</option>`).join("")}</select></label>
        <label>Status <select class="filter-select" data-task-status="${escapeHtml(task.id)}">${Object.entries(STATUSES).map(([value, label]) => `<option value="${value}" ${value === task.status ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>
      <div class="task-photos">${task.photos.map((path) => `<a href="#" data-action="open-photo" data-path="${escapeHtml(path)}"><img alt="Photo proof" data-photo-path="${escapeHtml(path)}" loading="lazy"></a>`).join("")}
        <label class="small-button photo-button">📷 Add photo<input type="file" accept="image/*" capture="environment" hidden data-task-photo="${escapeHtml(task.id)}"></label></div>
      <div class="property-actions">
        ${wa ? `<a class="small-button" href="${escapeHtml(wa)}" target="_blank" rel="noopener" data-action="mark-notified" data-id="${escapeHtml(task.id)}">Notify on WhatsApp ↗</a>` : ""}
        ${sms ? `<a class="small-button" href="${escapeHtml(sms)}" data-action="mark-notified" data-id="${escapeHtml(task.id)}">Notify by SMS ↗</a>` : ""}
        ${!member ? `<span class="guest-property">Assign staff with a phone number to notify them.</span>` : task.notifiedAt ? `<span class="guest-property">Notified ${escapeHtml(formatStamp(task.notifiedAt))}</span>` : ""}
        <button class="small-button" data-action="edit-task" data-id="${escapeHtml(task.id)}">Edit</button>
        <button class="small-button danger" data-action="delete-task" data-id="${escapeHtml(task.id)}">Remove</button></div>
      ${task.completedAt ? `<span class="guest-property">Completed ${escapeHtml(formatStamp(task.completedAt))}${task.photos.length ? "" : " · no photo proof"}</span>` : ""}
    </article>`;
  };
  const staffRows = data.staff.map((member) => {
    const count = data.tasks.filter((task) => task.staffId === member.id && task.status !== "done").length;
    return `<tr><td><strong>${escapeHtml(member.name)}</strong><span class="guest-property">${escapeHtml(member.phone || "No phone")}</span></td><td>${escapeHtml(ROLES[member.role])}</td><td>${count} open</td>
      <td><span class="status status-${member.active ? "confirmed" : "cancelled"}">${member.active ? "Active" : "Inactive"}</span></td>
      <td><div class="property-actions"><button class="small-button" data-action="edit-staff" data-id="${escapeHtml(member.id)}">Edit</button><button class="small-button danger" data-action="delete-staff" data-id="${escapeHtml(member.id)}">Remove</button></div></td></tr>`;
  }).join("");
  viewRoot.innerHTML = `
    <div class="stats-grid">
      ${statCard("Open tasks", open.length, "Cleaning and maintenance", "▤")}
      ${statCard("Overdue", overdue, "Past their due date", "!")}
      ${statCard("Completed", done, "Finished tasks", "✓")}
      ${statCard("Staff", data.staff.filter((member) => member.active).length, "Active team members", "☺")}
    </div>
    <div class="toolbar"><span class="toolbar-title">${shown.length} ${shown.length === 1 ? "task" : "tasks"}</span>
      <div class="toolbar-filters"><select id="task-filter" class="filter-select" aria-label="Filter tasks"><option value="open" ${filter === "open" ? "selected" : ""}>Open</option><option value="done" ${filter === "done" ? "selected" : ""}>Completed</option><option value="all" ${filter === "all" ? "selected" : ""}>All</option></select>
      <button class="button button-secondary" data-action="run-ops" ${opsRunning ? "disabled" : ""}>${opsRunning ? "Checking…" : "Generate checkout tasks"}</button><button class="button button-primary" data-action="add-task">+ New task</button></div></div>
    <div class="task-grid">${shown.map(card).join("") || `<div class="panel"><div class="empty-state"><span class="empty-icon">✓</span><strong>No tasks here</strong><p>Cleaning tasks are created automatically after each checkout, or add one yourself.</p></div></div>`}</div>
    <section class="panel"><div class="panel-heading"><div><h2>Staff and cleaning crews</h2><p>New turnover tasks go to the active cleaner with the fewest open tasks.</p></div><button class="button button-primary" data-action="add-staff">+ Add staff</button></div>
      <div class="table-wrap"><table><thead><tr><th>NAME</th><th>ROLE</th><th>WORKLOAD</th><th>STATUS</th><th></th></tr></thead><tbody>${staffRows || `<tr><td colspan="5"><div class="empty-state"><strong>No staff yet</strong><p>Add your cleaners so tasks can be assigned automatically.</p></div></td></tr>`}</tbody></table></div></section>
    <p class="note">Tasks cover every checkout, including stays imported from Airbnb, Vrbo and Booking.com. Staff are notified through a WhatsApp or SMS message that opens on your phone; photos are uploaded by you (or by staff on a shared device) as proof of completion. Staff accounts and push notifications aren't included.</p>`;
  void hydratePhotos();
}

async function runOps({ quiet = false } = {}) {
  if (opsRunning || !supabase || !currentUser) return;
  opsRunning = true;
  let created = 0;
  try {
    const pending = turnoversToCreate({ reservations: data.reservations, tasks: data.tasks, today: localDate(new Date()) });
    for (const reservation of pending) {
      const property = propertyFor(reservation);
      if (!property) continue;
      const cleaner = pickCleaner(data.staff, data.tasks);
      const { data: row, error } = await supabase.from("tasks").insert({
        user_id: currentUser.id, property_id: property.id, reservation_id: reservation.id, staff_id: cleaner?.id || null,
        kind: "cleaning", title: `Turnover clean after ${reservation.guest}`, due_date: reservation.checkOut, auto: true,
        notes: `Checkout ${formatDate(reservation.checkOut)}. Check linens, restock supplies and report any damage.`
      }).select("*").single();
      if (error) {
        if (error.code === "23505") continue;
        throw error;
      }
      data.tasks = [...data.tasks, mapTask(row)];
      created += 1;
    }
  } catch (error) {
    console.error("Could not generate tasks.", error);
    if (!quiet) showToast(error.message || "Could not generate tasks.");
  } finally {
    opsRunning = false;
    if (created || !quiet) {
      render();
      if (!quiet) showToast(created ? `${created} cleaning ${created === 1 ? "task" : "tasks"} created.` : "No new checkouts need tasks.");
    }
  }
}

async function updateTask(id, changes, row) {
  const { data: saved, error } = await supabase.from("tasks").update(row).eq("id", id).select("*").single();
  if (error) { showToast(error.message || "Could not update task."); render(); return; }
  data.tasks = data.tasks.map((task) => task.id === id ? mapTask(saved) : task);
  render();
}

async function uploadTaskPhoto(id, file) {
  if (!file || !file.type.startsWith("image/")) { showToast("Choose an image file."); return; }
  if (file.size > 8 * 1024 * 1024) { showToast("Photo must be under 8 MB."); return; }
  const task = data.tasks.find((entry) => entry.id === id);
  if (!task) return;
  const extension = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase() || "jpg";
  const path = `${currentUser.id}/${id}/${Date.now()}.${extension}`;
  showToast("Uploading photo…");
  const { error } = await supabase.storage.from("task-photos").upload(path, file, { contentType: file.type });
  if (error) { showToast(error.message || "Could not upload photo."); return; }
  await updateTask(id, {}, { photo_paths: [...task.photos, path] });
  showToast("Photo added.");
}

async function saveOpsItem(values) {
  const type = editor.type;
  const saveButton = document.querySelector("#save-button");
  saveButton.disabled = true;
  try {
    if (type === "staff") {
      const payload = { name: values.name.trim(), phone: values.phone.trim(), role: values.role, active: values.active === "yes" };
      const request = editor.id ? supabase.from("staff").update(payload).eq("id", editor.id) : supabase.from("staff").insert({ ...payload, user_id: currentUser.id });
      const { data: row, error } = await request.select("*").single();
      if (error) throw error;
      const member = mapStaff(row);
      data.staff = editor.id ? data.staff.map((entry) => entry.id === member.id ? member : entry) : [...data.staff, member];
    } else {
      const payload = { property_id: values.propertyId, kind: values.kind, title: values.title.trim(), notes: values.notes.trim(), due_date: values.dueDate, staff_id: values.staffId || null };
      const request = editor.id ? supabase.from("tasks").update(payload).eq("id", editor.id) : supabase.from("tasks").insert({ ...payload, user_id: currentUser.id });
      const { data: row, error } = await request.select("*").single();
      if (error) throw error;
      const task = mapTask(row);
      data.tasks = editor.id ? data.tasks.map((entry) => entry.id === task.id ? task : entry) : [...data.tasks, task];
    }
    dialog.close();
    render();
    showToast(type === "staff" ? "Staff saved." : "Task saved.");
    if (type === "staff") void runOps({ quiet: true });
  } catch (error) {
    console.error(`Could not save ${type}.`, error);
    showToast(error.message || `Could not save ${type}.`);
  } finally {
    saveButton.disabled = false;
  }
}

function reportContext() {
  if (!reportMonth) reportMonth = localDate(new Date()).slice(0, 7);
  const { start, end } = monthRange(reportMonth);
  const properties = data.properties.filter((property) => reportOwner === "all" || (reportOwner === "none" ? !property.ownerId : property.ownerId === reportOwner));
  const rows = properties.map((property) => ({ property, name: property.name, stats: propertyStats({ property, reservations: data.reservations, expenses: data.expenses, start, end }) }));
  return { start, end, rows, totals: sumStats(rows.map((row) => row.stats)) };
}

function periodLabel() {
  const [year, month] = reportMonth.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function renderReports() {
  const { rows, totals, start, end } = reportContext();
  const owner = data.owners.find((entry) => entry.id === reportOwner);
  const feePct = owner ? owner.feePct : 0;
  const payout = ownerPayout(totals.revenue, totals.expenses, feePct);
  const monthExpenses = data.expenses.filter((entry) => entry.date >= start && entry.date < end && rows.some((row) => row.property.id === entry.propertyId));
  const ownerRows = data.owners.map((entry) => {
    const mine = data.properties.filter((property) => property.ownerId === entry.id);
    return `<tr><td><strong>${escapeHtml(entry.name)}</strong><span class="guest-property">${escapeHtml(entry.email || "No email")}</span></td><td>${mine.length} ${mine.length === 1 ? "property" : "properties"}</td><td>${entry.feePct}%</td>
      <td><div class="property-actions"><button class="small-button" data-action="statement" data-id="${escapeHtml(entry.id)}">Statement</button><button class="small-button" data-action="email-statement" data-id="${escapeHtml(entry.id)}">Email owner</button><button class="small-button" data-action="edit-owner" data-id="${escapeHtml(entry.id)}">Edit</button><button class="small-button danger" data-action="delete-owner" data-id="${escapeHtml(entry.id)}">Remove</button></div></td></tr>`;
  }).join("");
  viewRoot.innerHTML = `
    <div class="toolbar"><span class="toolbar-title">${escapeHtml(periodLabel())}</span>
      <div class="toolbar-filters"><input id="report-month" class="search-input" type="month" value="${escapeHtml(reportMonth)}" aria-label="Month">
        <select id="report-owner" class="filter-select" aria-label="Owner"><option value="all">All properties</option><option value="none" ${reportOwner === "none" ? "selected" : ""}>My own (no owner)</option>${data.owners.map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === reportOwner ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}</select>
        <button class="button button-secondary" data-action="add-expense">+ Add expense</button><button class="button button-primary" data-action="add-owner">+ Add owner</button></div></div>
    <div class="stats-grid">
      ${statCard("Revenue", money(totals.revenue), "Gross, nights in this month", "$")}
      ${statCard("Occupancy", `${totals.occupancy}%`, `${totals.nights} of ${totals.available} nights`, "◫")}
      ${statCard("ADR", money(totals.adr), "Average daily rate", "↗")}
      ${statCard("RevPAR", money(totals.revpar), "Revenue per available night", "⌂")}
    </div>
    <div class="stats-grid">
      ${statCard("Expenses", money(totals.expenses), "Logged this month", "−")}
      ${statCard("Management fee", money(payout.fee), owner ? `${feePct}% of revenue` : "Pick an owner to apply a fee", "%")}
      ${statCard(owner ? "Owner net payout" : "Net income", money(payout.net), "Revenue − fee − expenses", "✓")}
      ${statCard("Bookings", totals.bookings, "Stays overlapping this month", "▤")}
    </div>
    <section class="panel"><div class="panel-heading"><div><h2>By property</h2><p>Performance for ${escapeHtml(periodLabel())}</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>PROPERTY</th><th>OCCUPANCY</th><th>ADR</th><th>REVENUE</th><th>EXPENSES</th><th>NET</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong><span class="guest-property">${escapeHtml(data.owners.find((entry) => entry.id === row.property.ownerId)?.name || "Own property")}</span></td><td>${row.stats.occupancy}%</td><td>${money(row.stats.adr)}</td><td>${money(row.stats.revenue)}</td><td>${money(row.stats.expenses)}</td><td>${money(row.stats.revenue - row.stats.expenses)}</td></tr>`).join("") || `<tr><td colspan="6"><div class="empty-state"><strong>No properties</strong><p>Add properties to see reports.</p></div></td></tr>`}</tbody></table></div></section>
    <section class="panel"><div class="panel-heading"><div><h2>Expenses</h2><p>${monthExpenses.length} logged in ${escapeHtml(periodLabel())}</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>DATE</th><th>PROPERTY</th><th>CATEGORY</th><th>DESCRIPTION</th><th>AMOUNT</th><th></th></tr></thead><tbody>
      ${monthExpenses.map((entry) => `<tr><td>${formatDate(entry.date)}</td><td>${escapeHtml(data.properties.find((property) => property.id === entry.propertyId)?.name || "")}</td><td>${escapeHtml(CATEGORIES[entry.category])}</td><td>${escapeHtml(entry.description)}</td><td>${money(entry.amount)}</td><td><div class="property-actions"><button class="small-button" data-action="edit-expense" data-id="${escapeHtml(entry.id)}">Edit</button><button class="small-button danger" data-action="delete-expense" data-id="${escapeHtml(entry.id)}">Remove</button></div></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty-state"><strong>No expenses this month</strong><p>Log cleaning, repairs and bills to see net income.</p></div></td></tr>`}</tbody></table></div></section>
    <section class="panel"><div class="panel-heading"><div><h2>Property owners</h2><p>Managing units for others? Assign owners to properties (Properties → Edit) and generate statements.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>OWNER</th><th>UNITS</th><th>MGMT FEE</th><th></th></tr></thead><tbody>${ownerRows || `<tr><td colspan="4"><div class="empty-state"><strong>No owners yet</strong><p>Add an owner to charge a management fee and generate statements.</p></div></td></tr>`}</tbody></table></div></section>
    <p class="note">Revenue is each reservation's total spread evenly across its nights. Stays imported from channels have no amount unless you edit them. Owners can't log in yet: send them the statement (print/save as PDF, or email). Amounts show in your selected display currency without conversion.</p>`;
}

function buildStatement(ownerId) {
  const owner = data.owners.find((entry) => entry.id === ownerId);
  const { start, end } = monthRange(reportMonth || localDate(new Date()).slice(0, 7));
  const rows = data.properties.filter((property) => property.ownerId === ownerId).map((property) => ({ name: property.name, stats: propertyStats({ property, reservations: data.reservations, expenses: data.expenses, start, end }) }));
  const totals = sumStats(rows.map((row) => row.stats));
  const payout = ownerPayout(totals.revenue, totals.expenses, owner.feePct);
  return { owner, rows, totals, payout, html: statementHtml({ owner, period: periodLabel(), rows, totals, payout, fmt: money, esc: escapeHtml, generated: new Date().toLocaleDateString() }) };
}

async function saveFinanceItem(values) {
  const type = editor.type;
  const saveButton = document.querySelector("#save-button");
  saveButton.disabled = true;
  try {
    if (type === "owner") {
      const payload = { name: values.name.trim(), email: values.email.trim(), phone: values.phone.trim(), fee_pct: Number(values.feePct) || 0 };
      const request = editor.id ? supabase.from("owners").update(payload).eq("id", editor.id) : supabase.from("owners").insert({ ...payload, user_id: currentUser.id });
      const { data: row, error } = await request.select("*").single();
      if (error) throw error;
      const owner = mapOwner(row);
      data.owners = editor.id ? data.owners.map((entry) => entry.id === owner.id ? owner : entry) : [...data.owners, owner];
    } else {
      const payload = { property_id: values.propertyId, category: values.category, description: values.description.trim(), amount: Number(values.amount), expense_date: values.date };
      const request = editor.id ? supabase.from("expenses").update(payload).eq("id", editor.id) : supabase.from("expenses").insert({ ...payload, user_id: currentUser.id });
      const { data: row, error } = await request.select("*").single();
      if (error) throw error;
      const expense = mapExpense(row);
      data.expenses = editor.id ? data.expenses.map((entry) => entry.id === expense.id ? expense : entry) : [expense, ...data.expenses];
    }
    dialog.close();
    render();
    showToast(type === "owner" ? "Owner saved." : "Expense saved.");
  } catch (error) {
    console.error(`Could not save ${type}.`, error);
    showToast(error.message || `Could not save ${type}.`);
  } finally {
    saveButton.disabled = false;
  }
}

const OTA_FEE_RATE = 0.15;

function siteUrl() {
  return data.site ? `${window.location.origin}/book.html?s=${encodeURIComponent(data.site.slug)}` : "";
}

function renderWebsite() {
  const site = data.site;
  const requests = data.reservations.filter((entry) => entry.source === "direct" && entry.status === "pending" && /^Direct booking request/.test(entry.notes));
  const directRevenue = data.reservations.filter((entry) => entry.source === "direct" && entry.status === "confirmed").reduce((total, entry) => total + (entry.amount || 0), 0);
  const listedCount = data.properties.filter((property) => property.listed).length;
  const slugGuess = (displayName() || "my-stays").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "my-stays";
  const propertyRows = data.properties.map((property) => `<tr><td><strong>${escapeHtml(property.name)}</strong><span class="guest-property">${escapeHtml(property.location)} · ${money(property.rate)} / night</span></td>
    <td><span class="status status-${property.listed ? "confirmed" : "cancelled"}">${property.listed ? "On website" : "Hidden"}</span></td>
    <td><button class="small-button" data-action="toggle-listed" data-id="${escapeHtml(property.id)}" ${site ? "" : "disabled"}>${property.listed ? "Hide" : "Show on website"}</button></td></tr>`).join("");
  viewRoot.innerHTML = `
    <div class="stats-grid">
      ${statCard("Website", site?.enabled ? "Live" : site ? "Paused" : "Not set up", site ? escapeHtml(site.slug) : "Create your site below", "◎")}
      ${statCard("Properties listed", listedCount, "Visible to guests", "⌂")}
      ${statCard("Requests to review", requests.length, "Pending direct bookings", "✉")}
      ${statCard("Direct revenue", money(directRevenue), `≈ ${money(directRevenue * OTA_FEE_RATE)} saved vs ${Math.round(OTA_FEE_RATE * 100)}% OTA fees`, "$")}
    </div>
    <section class="panel"><div class="panel-heading"><div><h2>Your booking website</h2><p>A branded page guests can use to book you directly, with no commission.</p></div></div>
      <form id="site-form" class="site-form">
        <div class="form-fields">
          ${field("brandName", "Brand name", "text", site?.brandName || "", { placeholder: "e.g. Marcia's Island Stays" })}
          ${field("slug", "Web address name (letters, numbers, dashes)", "text", site?.slug || slugGuess, { placeholder: "marcias-stays" })}
          ${field("tagline", "Tagline (optional)", "text", site?.tagline || "", { full: true, required: false, placeholder: "Your home away from home in Jamaica" })}
          ${field("email", "Contact email (optional)", "email", site?.email || "", { required: false })}
          ${field("phone", "Contact phone (optional)", "tel", site?.phone || "", { required: false })}
          ${field("enabled", "Website status", "select", site?.enabled ? "yes" : "no", { choices: [["yes", "Live: guests can book"], ["no", "Paused"]] })}
        </div>
        <div class="property-actions site-actions"><button class="button button-primary" type="submit">${site ? "Save website" : "Create website"}</button>
          ${site ? `<a class="button button-secondary" href="${escapeHtml(siteUrl())}" target="_blank" rel="noopener">Open site ↗</a><button class="button button-secondary" type="button" data-action="copy-site">Copy link</button>` : ""}</div>
        ${site ? `<p class="note">Your link: <strong>${escapeHtml(siteUrl())}</strong></p>` : ""}
      </form></section>
    <section class="panel"><div class="panel-heading"><div><h2>Booking requests</h2><p>Guests who asked to book through your website. Confirming blocks the dates on all channels.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>GUEST</th><th>DATES</th><th>TOTAL</th><th></th></tr></thead><tbody>
      ${requests.map((entry) => `<tr><td><strong>${escapeHtml(entry.guest)}</strong><span class="guest-property">${escapeHtml(entry.email)}${entry.phone ? ` · ${escapeHtml(entry.phone)}` : ""} · ${escapeHtml(propertyFor(entry)?.name || "")}</span></td>
        <td>${formatDate(entry.checkIn)} – ${formatDate(entry.checkOut)}</td><td>${money(entry.amount)}</td>
        <td><div class="property-actions"><button class="small-button" data-action="approve-request" data-id="${escapeHtml(entry.id)}">Confirm</button><button class="small-button danger" data-action="decline-request" data-id="${escapeHtml(entry.id)}">Decline</button></div></td></tr>`).join("") || `<tr><td colspan="4"><div class="empty-state"><span class="empty-icon">✉</span><strong>No requests waiting</strong><p>New website bookings will appear here.</p></div></td></tr>`}</tbody></table></div></section>
    <section class="panel"><div class="panel-heading"><div><h2>Properties on your website</h2><p>Choose which properties guests can see and book.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>PROPERTY</th><th>STATUS</th><th></th></tr></thead><tbody>${propertyRows || `<tr><td colspan="3"><div class="empty-state"><strong>No properties yet</strong><p>Add a property first.</p></div></td></tr>`}</tbody></table></div></section>
    <p class="note">Guests send a booking request for the dates they want (availability is checked against all your reservations and channel calendars). You confirm and arrange payment directly, so there are no OTA commissions. Online card payments aren't built in yet. The savings figure assumes a typical ${Math.round(OTA_FEE_RATE * 100)}% OTA fee.</p>`;
}

async function saveSite(event) {
  event.preventDefault();
  const form = event.target;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const slug = values.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) { showToast("Web address must be 3-40 letters, numbers or dashes."); return; }
  const payload = { slug, brand_name: values.brandName.trim(), tagline: values.tagline.trim(), contact_email: values.email.trim(), contact_phone: values.phone.trim(), enabled: values.enabled === "yes" };
  const request = data.site ? supabase.from("booking_sites").update(payload).eq("id", data.site.id) : supabase.from("booking_sites").insert({ ...payload, user_id: currentUser.id });
  const { data: row, error } = await request.select("*").single();
  if (error) { showToast(error.code === "23505" ? "That web address is taken. Try another." : error.message || "Could not save website."); return; }
  data.site = mapSite(row);
  render();
  showToast("Website saved.");
}

function renderProperties() {
  const query = (document.querySelector("#property-search")?.value || "").trim().toLowerCase();
  const filtered = data.properties.filter((property) => `${property.name} ${property.location}`.toLowerCase().includes(query));
  viewRoot.innerHTML = `
    <div class="toolbar">
      <span class="toolbar-title">${filtered.length} ${filtered.length === 1 ? "property" : "properties"} in your portfolio</span>
      <div class="toolbar-filters"><input id="property-search" class="search-input" type="search" placeholder="Search properties" value="${escapeHtml(query)}" aria-label="Search properties"></div>
    </div>
    ${filtered.length ? `<div class="property-grid">${filtered.map((property, index) => {
      const today = localDate(new Date());
      const bookings = data.reservations.filter((reservation) => reservation.propertyId === property.id && reservation.status !== "cancelled" && reservation.checkOut >= today).length;
      return `<article class="property-card">
        <div class="property-art art-${index % 3}"><span class="property-art-label">${Number(property.bedrooms) || 1} ${Number(property.bedrooms) === 1 ? "bedroom" : "bedrooms"}</span></div>
        <div class="property-content">
          <div class="property-title-row"><h3>${escapeHtml(property.name)}</h3><span class="status status-confirmed">Active</span></div>
          <p class="property-location">${escapeHtml(property.location)}</p>
          <div class="property-meta"><span>Nightly rate</span><strong>${money(property.rate)}</strong></div>
          <div class="property-meta"><span>Upcoming stays</span><strong>${bookings}</strong></div>
          <div class="property-actions">
            <button class="small-button" data-action="edit-property" data-id="${escapeHtml(property.id)}">Edit details</button>
            <button class="small-button danger" data-action="delete-property" data-id="${escapeHtml(property.id)}">Remove</button>
          </div>
        </div>
      </article>`;
    }).join("")}</div>` : `<section class="panel"><div class="empty-state"><span class="empty-icon">⌂</span><strong>${data.properties.length ? "No properties found" : "Add your first property"}</strong><p>${data.properties.length ? "Try another search." : "Create a property to start organizing your stays."}</p></div></section>`}`;
}

function field(name, label, type, value = "", options = {}) {
  const full = options.full ? " full" : "";
  const required = options.required === false ? "" : " required";
  const placeholder = options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : "";
  const min = options.min !== undefined ? ` min="${options.min}"` : "";
  const step = options.step ? ` step="${options.step}"` : "";
  const common = `id="field-${name}" name="${name}"${required}${min}${step}${placeholder}`;
  if (type === "select") {
    return `<div class="field${full}"><label for="field-${name}">${label}</label><select ${common}>${options.choices.map(([choiceValue, choiceLabel]) => `<option value="${escapeHtml(choiceValue)}" ${String(value) === String(choiceValue) ? "selected" : ""}>${escapeHtml(choiceLabel)}</option>`).join("")}</select></div>`;
  }
  if (type === "textarea") return `<div class="field${full}"><label for="field-${name}">${label}</label><textarea ${common}>${escapeHtml(value)}</textarea></div>`;
  return `<div class="field${full}"><label for="field-${name}">${label}</label><input ${common} type="${type}" value="${escapeHtml(value)}"></div>`;
}

function openEditor(type, item = null) {
  if ((type === "reservation" || type === "channel" || type === "task" || type === "expense") && !data.properties.length) {
    showToast(`Add a property before creating a ${type}.`);
    navTo("properties");
    return;
  }
  editor = { type, id: item?.id || null };
  const editing = Boolean(item);
  document.querySelector("#dialog-eyebrow").textContent = editing ? "UPDATE DETAILS" : "GET STARTED";
  document.querySelector("#dialog-title").textContent = `${editing ? "Edit" : "Add"} ${type}`;
  document.querySelector("#save-button").textContent = `${editing ? "Save" : "Add"} ${type}`;

  if (type === "property") {
    formFields.innerHTML = [
      field("name", "Property name", "text", item?.name, { full: true, placeholder: "e.g. Seaside cottage" }),
      field("location", "Location", "text", item?.location, { full: true, placeholder: "City, country" }),
      field("bedrooms", "Bedrooms", "number", item?.bedrooms ?? 1, { min: 1, step: 1 }),
      field("rate", "Nightly rate", "number", item?.rate ?? "", { min: 0, step: "0.01" }),
      field("ownerId", "Property owner (if you manage it for someone else)", "select", item?.ownerId || "", { full: true, required: false, choices: [["", "Me (my own property)"], ...data.owners.map((entry) => [entry.id, entry.name])] }),
      field("description", "Description", "textarea", item?.description, { full: true, required: false, placeholder: "A few details about your place" })
    ].join("");
  } else if (type === "owner") {
    formFields.innerHTML = [
      field("name", "Owner name", "text", item?.name, { full: true }),
      field("email", "Email", "email", item?.email, { required: false }),
      field("phone", "Phone", "tel", item?.phone, { required: false }),
      field("feePct", "Management fee (% of revenue)", "number", item?.feePct ?? 15, { min: 0, step: "0.1" })
    ].join("");
  } else if (type === "expense") {
    formFields.innerHTML = [
      field("propertyId", "Property", "select", item?.propertyId || data.properties[0].id, { choices: data.properties.map((property) => [property.id, property.name]) }),
      field("category", "Category", "select", item?.category || "cleaning", { choices: Object.entries(CATEGORIES) }),
      field("amount", "Amount", "number", item?.amount ?? "", { min: 0, step: "0.01" }),
      field("date", "Date", "date", item?.date || dateOffset(0)),
      field("description", "Description", "text", item?.description, { full: true, required: false, placeholder: "e.g. Plumber – kitchen tap" })
    ].join("");
  } else if (type === "staff") {
    formFields.innerHTML = [
      field("name", "Name", "text", item?.name, { full: true, placeholder: "e.g. Marcia (cleaning crew)" }),
      field("phone", "Mobile number (with country code)", "tel", item?.phone, { required: false, placeholder: "+1 876 555 0100" }),
      field("role", "Role", "select", item?.role || "cleaner", { choices: Object.entries(ROLES) }),
      field("active", "Active", "select", item && !item.active ? "no" : "yes", { choices: [["yes", "Yes"], ["no", "No"]] })
    ].join("");
  } else if (type === "task") {
    formFields.innerHTML = [
      field("title", "Task", "text", item?.title, { full: true, placeholder: "e.g. Fix leaking tap" }),
      field("propertyId", "Property", "select", item?.propertyId || data.properties[0].id, { choices: data.properties.map((property) => [property.id, property.name]) }),
      field("kind", "Type", "select", item?.kind || "maintenance", { choices: Object.entries(KINDS) }),
      field("dueDate", "Due date", "date", item?.dueDate || dateOffset(1)),
      field("staffId", "Assign to", "select", item?.staffId || "", { required: false, choices: [["", "Unassigned"], ...data.staff.filter((member) => member.active).map((member) => [member.id, member.name])] }),
      field("notes", "Notes (optional)", "textarea", item?.notes, { full: true, required: false })
    ].join("");
  } else if (type === "conversation") {
    formFields.innerHTML = [
      field("guestName", "Guest name", "text", "", { full: true }),
      field("channel", "Channel", "select", "whatsapp", { choices: Object.entries(CHANNELS) }),
      field("guestContact", "Phone or email", "text", "", { required: false, placeholder: "+1 876… or guest@example.com" }),
      field("reservationId", "Linked reservation (optional)", "select", "", { full: true, required: false, choices: [["", "None"], ...data.reservations.map((entry) => [entry.id, `${entry.guest} · ${entry.checkIn}`])] })
    ].join("");
  } else if (type === "template") {
    formFields.innerHTML = [
      field("name", "Template name", "text", item?.name, { full: true }),
      field("trigger", "Trigger", "select", item?.trigger || "booking_confirmation", { choices: Object.entries(TRIGGERS) }),
      field("offsetDays", "Days offset (− before / + after check-in or check-out)", "number", item?.offsetDays ?? 0, { min: -30, step: 1 }),
      field("keywords", "Keywords for auto-reply (comma separated)", "text", item?.keywords, { full: true, required: false, placeholder: "wifi, parking, check-in time" }),
      field("body", "Message", "textarea", item?.body, { full: true, placeholder: "Hi {guest}, …" })
    ].join("");
  } else if (type === "channel") {
    const choices = data.properties.map((property) => [property.id, property.name]);
    formFields.innerHTML = [
      field("propertyId", "Property", "select", item?.propertyId || choices[0][0], { choices }),
      field("platform", "Channel", "select", item?.platform || "airbnb", { choices: Object.entries(PLATFORMS) }),
      field("icalUrl", "Channel calendar (iCal) link", "url", item?.icalUrl, { full: true, required: false, placeholder: "https://www.airbnb.com/calendar/ical/…ics" }),
      field("priceAdjust", "Price adjustment on this channel (%)", "number", item?.priceAdjust ?? 0, { min: -90, step: "0.1" })
    ].join("");
  } else {
    const choices = data.properties.map((property) => [property.id, property.name]);
    formFields.innerHTML = [
      field("guest", "Guest name", "text", item?.guest, { placeholder: "Full name" }),
      field("email", "Email address", "email", item?.email, { placeholder: "guest@example.com" }),
      field("propertyId", "Property", "select", item?.propertyId || choices[0][0], { choices }),
      field("guests", "Number of guests", "number", item?.guests ?? 1, { min: 1, step: 1 }),
      field("checkIn", "Check-in", "date", item?.checkIn || dateOffset(1)),
      field("checkOut", "Check-out", "date", item?.checkOut || dateOffset(2)),
      field("amount", "Reservation total", "number", item?.amount ?? "", { min: 0, step: "0.01" }),
      field("status", "Status", "select", item?.status || "confirmed", { choices: [["confirmed", "Confirmed"], ["pending", "Pending"], ["cancelled", "Cancelled"]] }),
      field("phone", "Phone (optional)", "tel", item?.phone, { required: false }),
      field("notes", "Notes (optional)", "textarea", item?.notes, { full: true, required: false })
    ].join("");
  }
  dialog.showModal();
  formFields.querySelector("input, select, textarea")?.focus();
}

async function saveEditor(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  if (editor.type === "reservation" && values.checkOut <= values.checkIn) {
    document.querySelector("#field-checkOut").setCustomValidity("Check-out must be after check-in.");
    document.querySelector("#field-checkOut").reportValidity();
    document.querySelector("#field-checkOut").setCustomValidity("");
    return;
  }
  if (editor.type === "owner" || editor.type === "expense") {
    await saveFinanceItem(values);
    return;
  }
  if (editor.type === "staff" || editor.type === "task") {
    await saveOpsItem(values);
    return;
  }
  if (editor.type === "conversation" || editor.type === "template") {
    await saveInboxItem(values);
    return;
  }
  const isProperty = editor.type === "property";
  const isChannel = editor.type === "channel";
  const table = isProperty ? "properties" : isChannel ? "channels" : "reservations";
  const payload = isChannel ? {
    property_id: values.propertyId,
    platform: values.platform,
    ical_url: values.icalUrl.trim(),
    price_adjust_pct: Number(values.priceAdjust) || 0
  } : isProperty ? {
    name: values.name.trim(),
    location: values.location.trim(),
    bedrooms: Number(values.bedrooms),
    rate: Number(values.rate),
    description: values.description.trim(),
    owner_id: values.ownerId || null
  } : {
    property_id: values.propertyId,
    guest: values.guest.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    check_in: values.checkIn,
    check_out: values.checkOut,
    guests: Number(values.guests),
    amount: Number(values.amount),
    status: values.status,
    notes: values.notes.trim()
  };
  const saveButton = document.querySelector("#save-button");
  saveButton.disabled = true;
  try {
    const request = editor.id
      ? supabase.from(table).update(payload).eq("id", editor.id)
      : supabase.from(table).insert({ ...payload, user_id: currentUser.id });
    const { data: savedRow, error } = await request.select("*").single();
    if (error) throw error;
    if (isChannel) {
      const channel = mapChannel(savedRow);
      data.channels = editor.id
        ? data.channels.map((current) => current.id === channel.id ? channel : current)
        : [...data.channels, channel];
    } else if (isProperty) {
      const property = mapProperty(savedRow);
      data.properties = editor.id
        ? data.properties.map((current) => current.id === property.id ? property : current)
        : [...data.properties, property];
    } else {
      const reservation = mapReservation(savedRow);
      data.reservations = editor.id
        ? data.reservations.map((current) => current.id === reservation.id ? reservation : current)
        : [...data.reservations, reservation];
    }
    dialog.close();
    render();
    showToast(`${isProperty ? "Property" : isChannel ? "Channel" : "Reservation"} ${editor.id ? "updated" : "added"}.`);
    if (isChannel && savedRow.ical_url) void syncAll({ quiet: true });
  } catch (error) {
    console.error(`Could not save ${editor.type}.`, error);
    showToast(error.message || `Could not save ${editor.type}.`);
  } finally {
    saveButton.disabled = false;
  }
}

async function handleAction(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const { action, id } = actionButton.dataset;
  if (action === "edit-reservation") {
    const item = data.reservations.find((reservation) => reservation.id === id);
    if (item) openEditor("reservation", item);
  }
  if (action === "add-channel") openEditor("channel");
  if (action === "toggle-listed") {
    const property = data.properties.find((entry) => entry.id === id);
    if (property) {
      const { error } = await supabase.from("properties").update({ listed: !property.listed }).eq("id", id);
      if (error) { showToast(error.message || "Could not update property."); return; }
      property.listed = !property.listed;
      render();
    }
  }
  if (action === "copy-site") {
    try {
      await navigator.clipboard.writeText(siteUrl());
      showToast("Website link copied.");
    } catch {
      window.prompt("Copy your website link", siteUrl());
    }
  }
  if (action === "approve-request" || action === "decline-request") {
    const status = action === "approve-request" ? "confirmed" : "cancelled";
    const { error } = await supabase.from("reservations").update({ status }).eq("id", id);
    if (error) { showToast(error.message || "Could not update request."); return; }
    data.reservations = data.reservations.map((entry) => entry.id === id ? { ...entry, status } : entry);
    render();
    showToast(status === "confirmed" ? "Booking confirmed." : "Request declined.");
  }
  if (action === "add-owner") openEditor("owner");
  if (action === "add-expense") openEditor("expense");
  if (action === "edit-owner") {
    const item = data.owners.find((entry) => entry.id === id);
    if (item) openEditor("owner", item);
  }
  if (action === "edit-expense") {
    const item = data.expenses.find((entry) => entry.id === id);
    if (item) openEditor("expense", item);
  }
  if (action === "delete-owner") {
    if (!window.confirm("Remove this owner? Their properties become your own.")) return;
    const { error } = await supabase.from("owners").delete().eq("id", id);
    if (error) { showToast(error.message || "Could not remove owner."); return; }
    data.owners = data.owners.filter((entry) => entry.id !== id);
    data.properties = data.properties.map((property) => property.ownerId === id ? { ...property, ownerId: null } : property);
    if (reportOwner === id) reportOwner = "all";
    render();
  }
  if (action === "delete-expense") {
    if (!window.confirm("Remove this expense?")) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) { showToast(error.message || "Could not remove expense."); return; }
    data.expenses = data.expenses.filter((entry) => entry.id !== id);
    render();
  }
  if (action === "statement" || action === "email-statement") {
    const statement = buildStatement(id);
    if (!statement.rows.length) { showToast("Assign at least one property to this owner first."); return; }
    if (action === "statement") {
      const url = URL.createObjectURL(new Blob([statement.html], { type: "text/html" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      const text = `Hi ${statement.owner.name},\n\nYour ${periodLabel()} statement:\nRevenue: ${money(statement.totals.revenue)}\nManagement fee (${statement.owner.feePct}%): ${money(statement.payout.fee)}\nExpenses: ${money(statement.totals.expenses)}\nNet payout: ${money(statement.payout.net)}\nOccupancy: ${statement.totals.occupancy}%  ADR: ${money(statement.totals.adr)}`;
      window.location.href = `mailto:${statement.owner.email}?subject=${encodeURIComponent(`Owner statement – ${periodLabel()}`)}&body=${encodeURIComponent(text)}`;
    }
  }
  if (action === "add-staff") openEditor("staff");
  if (action === "add-task") openEditor("task");
  if (action === "run-ops") { render(); void runOps(); }
  if (action === "edit-staff") {
    const item = data.staff.find((entry) => entry.id === id);
    if (item) openEditor("staff", item);
  }
  if (action === "edit-task") {
    const item = data.tasks.find((entry) => entry.id === id);
    if (item) openEditor("task", item);
  }
  if (action === "delete-staff") {
    if (!window.confirm("Remove this staff member? Their tasks become unassigned.")) return;
    const { error } = await supabase.from("staff").delete().eq("id", id);
    if (error) { showToast(error.message || "Could not remove staff."); return; }
    data.staff = data.staff.filter((entry) => entry.id !== id);
    data.tasks = data.tasks.map((task) => task.staffId === id ? { ...task, staffId: null } : task);
    render();
  }
  if (action === "delete-task") {
    if (!window.confirm("Remove this task?")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) { showToast(error.message || "Could not remove task."); return; }
    data.tasks = data.tasks.filter((entry) => entry.id !== id);
    render();
  }
  if (action === "mark-notified") {
    const stamp = new Date().toISOString();
    const { error } = await supabase.from("tasks").update({ notified_at: stamp }).eq("id", id);
    if (!error) data.tasks = data.tasks.map((task) => task.id === id ? { ...task, notifiedAt: stamp } : task);
  }
  if (action === "open-photo") {
    event.preventDefault();
    const url = await photoUrl(actionButton.dataset.path);
    if (url) window.open(url, "_blank", "noopener");
  }
  if (action === "add-conversation") openEditor("conversation");
  if (action === "add-template") openEditor("template");
  if (action === "run-automations") { render(); void runAutomations(); }
  if (action === "open-conversation") {
    selectedConversationId = id;
    const conversation = data.conversations.find((entry) => entry.id === id);
    if (conversation?.unread) {
      conversation.unread = 0;
      void supabase.from("conversations").update({ unread: 0 }).eq("id", id);
    }
    render();
  }
  if (action === "mark-sent") {
    const { error } = await supabase.from("messages").update({ status: "sent" }).eq("id", id);
    if (error) { showToast(error.message || "Could not update message."); return; }
    data.messages = data.messages.map((entry) => entry.id === id ? { ...entry, status: "sent" } : entry);
    render();
  }
  if (action === "delete-conversation") {
    if (!window.confirm("Delete this conversation and its messages?")) return;
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) { showToast(error.message || "Could not delete conversation."); return; }
    data.conversations = data.conversations.filter((entry) => entry.id !== id);
    data.messages = data.messages.filter((entry) => entry.conversationId !== id);
    render();
  }
  if (action === "edit-template") {
    const item = data.templates.find((entry) => entry.id === id);
    if (item) openEditor("template", item);
  }
  if (action === "toggle-template") {
    const item = data.templates.find((entry) => entry.id === id);
    if (item) {
      const { error } = await supabase.from("message_templates").update({ enabled: !item.enabled }).eq("id", id);
      if (error) { showToast(error.message || "Could not update template."); return; }
      item.enabled = !item.enabled;
      render();
      if (item.enabled) void runAutomations({ quiet: true });
    }
  }
  if (action === "delete-template") {
    if (!window.confirm("Remove this template?")) return;
    const { error } = await supabase.from("message_templates").delete().eq("id", id);
    if (error) { showToast(error.message || "Could not remove template."); return; }
    data.templates = data.templates.filter((entry) => entry.id !== id);
    render();
  }
  if (action === "starter-templates") {
    const { data: rows, error } = await supabase.from("message_templates").insert(STARTER_TEMPLATES.map((entry) => ({ ...entry, user_id: currentUser.id }))).select("*");
    if (error) { showToast(error.message || "Could not add templates."); return; }
    data.templates = rows.map(mapTemplate);
    render();
    void runAutomations();
  }
  if (action === "sync-all") void syncAll();
  if (action === "edit-channel") {
    const item = data.channels.find((channel) => channel.id === id);
    if (item) openEditor("channel", item);
  }
  if (action === "sync-channel") {
    const channel = data.channels.find((entry) => entry.id === id);
    if (channel) {
      actionButton.disabled = true;
      await syncChannel(channel);
      const { data: rows } = await supabase.from("reservations").select("*").order("check_in", { ascending: true });
      if (rows) data.reservations = rows.map(mapReservation);
      render();
    }
  }
  if (action === "copy-feed") {
    const channel = data.channels.find((entry) => entry.id === id);
    if (channel) {
      try {
        await navigator.clipboard.writeText(exportUrl(channel));
        showToast("Export link copied. Paste it into the channel's calendar import.");
      } catch {
        window.prompt("Copy this export link", exportUrl(channel));
      }
    }
  }
  if (action === "delete-channel") {
    const channel = data.channels.find((entry) => entry.id === id);
    if (!channel || !window.confirm(`Disconnect ${PLATFORMS[channel.platform]}? Its imported bookings stay on your calendar.`)) return;
    const { error } = await supabase.from("channels").delete().eq("id", id);
    if (error) { showToast(error.message || "Could not remove channel."); return; }
    data.channels = data.channels.filter((entry) => entry.id !== id);
    data.reservations = data.reservations.map((entry) => entry.channelId === id ? { ...entry, channelId: null } : entry);
    render();
    showToast("Channel disconnected.");
  }
  if (action === "edit-property") {
    const item = data.properties.find((property) => property.id === id);
    if (item) openEditor("property", item);
  }
  if (action === "delete-property") {
    const hasBookings = data.reservations.some((reservation) => reservation.propertyId === id);
    if (hasBookings) {
      showToast("This property has reservations. Remove or reassign them first.");
      return;
    }
    const property = data.properties.find((entry) => entry.id === id);
    if (!property || !window.confirm(`Remove "${property.name}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from("properties").delete().eq("id", id);
      if (error) throw error;
      data.properties = data.properties.filter((entry) => entry.id !== id);
      render();
      showToast("Property removed.");
    } catch (error) {
      console.error("Could not remove property.", error);
      showToast(error.message || "Could not remove property.");
    }
  }
  if (action === "delete-reservation") {
    const reservation = data.reservations.find((entry) => entry.id === id);
    if (!reservation || !window.confirm(`Remove the reservation for ${reservation.guest}? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from("reservations").delete().eq("id", id);
      if (error) throw error;
      data.reservations = data.reservations.filter((entry) => entry.id !== id);
      render();
      showToast("Reservation removed.");
    } catch (error) {
      console.error("Could not remove reservation.", error);
      showToast(error.message || "Could not remove reservation.");
    }
  }
}

document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => navTo(link.dataset.view)));
setInterval(() => { if (currentUser) { void syncAll({ quiet: true }); void runAutomations({ quiet: true }); void runOps({ quiet: true }); } }, 15 * 60 * 1000);
document.querySelector("#add-property-button").addEventListener("click", () => openEditor("property"));
document.querySelector("#add-reservation-button").addEventListener("click", () => openEditor("reservation"));
document.querySelector("#currency-select").addEventListener("change", (event) => {
  try {
    localStorage.setItem(CURRENCY_KEY, event.target.value);
  } catch (error) {
    console.error("Could not save currency preference.", error);
    showToast("Could not save your currency preference.");
  }
  render();
});
document.querySelector("#currency-select").value = storedCurrency();
document.querySelector("#editor-form").addEventListener("submit", saveEditor);
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
viewRoot.addEventListener("click", (event) => {
  void handleAction(event);
  const navigateButton = event.target.closest("[data-navigate]");
  if (navigateButton) navTo(navigateButton.dataset.navigate);
});
viewRoot.addEventListener("input", (event) => {
  if (event.target.id === "reservation-search" || event.target.id === "property-search") {
    const id = event.target.id;
    const value = event.target.value;
    const selectionStart = event.target.selectionStart;
    const selectionEnd = event.target.selectionEnd;
    render();
    const replacement = document.getElementById(id);
    replacement?.focus();
    replacement?.setSelectionRange(selectionStart, selectionEnd);
  }
});
viewRoot.addEventListener("submit", (event) => {
  if (event.target.id === "site-form") void saveSite(event);
  if (event.target.id === "composer-form") void submitComposer(event);
});
viewRoot.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "report-month" && target.value) { reportMonth = target.value; render(); }
  if (target.id === "report-owner") { reportOwner = target.value; render(); }
  if (target.id === "task-filter") { viewRoot.dataset.taskFilter = target.value; render(); }
  if (target.dataset.taskAssign !== undefined) void updateTask(target.dataset.taskAssign, {}, { staff_id: target.value || null });
  if (target.dataset.taskStatus !== undefined) {
    const status = target.value;
    void updateTask(target.dataset.taskStatus, {}, { status, completed_at: status === "done" ? new Date().toISOString() : null });
  }
  if (target.dataset.taskPhoto !== undefined) void uploadTaskPhoto(target.dataset.taskPhoto, target.files[0]);
  if (event.target.id === "reservation-status") render();
});

const passwordInput = document.querySelector("#auth-password");
const confirmInput = document.querySelector("#auth-confirm");

document.querySelector("#password-toggle").addEventListener("click", (event) => {
  const reveal = passwordInput.type === "password";
  passwordInput.type = reveal ? "text" : "password";
  confirmInput.type = passwordInput.type;
  event.currentTarget.textContent = reveal ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
  event.currentTarget.setAttribute("aria-pressed", String(reveal));
});

document.querySelector("#auth-forgot").addEventListener("click", async () => {
  if (!supabase) return;
  const email = document.querySelector("#auth-email").value.trim();
  if (!email) {
    setAuthMessage("Enter your email address above, then choose “Forgot password?” again.");
    document.querySelector("#auth-email").focus();
    return;
  }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/app.html` });
    if (error) throw error;
    setAuthMessage("If an account exists for that email, a password reset link is on its way.", false);
  } catch (error) {
    console.error("Could not send reset email.", error);
    setAuthMessage(error.message || "Could not send the reset email. Please try again.");
  }
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const email = document.querySelector("#auth-email").value.trim();
  const password = passwordInput.value;
  const name = document.querySelector("#auth-name").value.trim();
  const signingUp = authMode() === "signup";
  if (!authForm.checkValidity()) {
    setAuthMessage(!email || !document.querySelector("#auth-email").validity.valid
      ? "Enter a valid email address."
      : "Your password must be at least 8 characters.");
    return;
  }
  if (signingUp && !name) {
    setAuthMessage("Enter your name so we can personalize your workspace.");
    document.querySelector("#auth-name").focus();
    return;
  }
  if (signingUp && password !== confirmInput.value) {
    setAuthMessage("Passwords don’t match. Please re-enter them.");
    confirmInput.focus();
    return;
  }
  authSubmit.disabled = true;
  authSubmit.textContent = authMode() === "signup" ? "Creating account…" : "Signing in…";
  setAuthMessage("");
  try {
    if (authMode() === "signup") {
      const { data: result, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
      if (error) throw error;
      if (!result.session) {
        setAuthMessage("Account created. Check your email to confirm your address, then sign in.", false);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    console.error("Authentication failed.", error);
    setAuthMessage(error.message || "Could not authenticate. Please try again.");
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode() === "signup" ? "Create account" : "Sign in";
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  if (!supabase) return;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    console.error("Could not sign out.", error);
    showToast(error.message || "Could not sign out.");
  }
});

setTodayLabel();
initializeSupabase();
