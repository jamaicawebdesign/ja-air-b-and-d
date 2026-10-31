"use strict";

import { createClient } from "@supabase/supabase-js";
import { PLATFORMS, findConflicts, parseIcal } from "./ical.js";

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

let data = { properties: [], reservations: [], channels: [] };
let syncing = false;

function mapProperty(row) {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    bedrooms: row.bedrooms,
    rate: Number(row.rate),
    description: row.description || ""
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
    externalUid: row.external_uid || null
  };
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
  const [propertiesResult, reservationsResult, channelsResult] = await Promise.all([
    supabase.from("properties").select("*").order("created_at", { ascending: true }),
    supabase.from("reservations").select("*").order("check_in", { ascending: true }),
    supabase.from("channels").select("*").order("created_at", { ascending: true })
  ]);
  if (propertiesResult.error) throw propertiesResult.error;
  if (reservationsResult.error) throw reservationsResult.error;
  const channelsMissing = Boolean(channelsResult.error);
  if (channelsMissing) console.warn("Channels unavailable. Run the channel section of supabase/schema.sql.", channelsResult.error);
  if (!requestedUserId || currentUser?.id !== requestedUserId) return;
  data = {
    properties: propertiesResult.data.map(mapProperty),
    reservations: reservationsResult.data.map(mapReservation),
    channels: channelsMissing ? [] : channelsResult.data.map(mapChannel)
  };
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
  const labels = { overview: "Overview", reservations: "Reservations", properties: "Properties", channels: "Channels" };
  document.querySelector("#breadcrumb-current").textContent = labels[view];
  const title = document.querySelector("#page-title");
  const subtitle = document.querySelector("#page-subtitle");
  title.innerHTML = view === "overview" ? `${greeting()}, ${escapeHtml(displayName())} <span class="wave">✦</span>` : labels[view];
  subtitle.textContent = {
    overview: "Here’s what’s happening with your stays.",
    reservations: "Keep guest details and upcoming stays organized.",
    properties: "Manage the places you welcome guests to.",
    channels: "Keep Airbnb, Vrbo and Booking.com calendars in sync to prevent double bookings."
  }[view];
  render();
  if (view === "channels") void syncAll({ quiet: true });
}

function render() {
  if (currentView === "overview") renderOverview();
  if (currentView === "reservations") renderReservations();
  if (currentView === "properties") renderProperties();
  if (currentView === "channels") renderChannels();
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
  if ((type === "reservation" || type === "channel") && !data.properties.length) {
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
      field("description", "Description", "textarea", item?.description, { full: true, required: false, placeholder: "A few details about your place" })
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
    description: values.description.trim()
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
setInterval(() => { if (currentUser) void syncAll({ quiet: true }); }, 15 * 60 * 1000);
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
viewRoot.addEventListener("change", (event) => {
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
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
