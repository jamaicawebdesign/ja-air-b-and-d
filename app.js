"use strict";

import { createClient } from "@supabase/supabase-js";

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
let currentView = "overview";
let editor = { type: null, id: null };
let toastTimer;
let supabase = null;
let currentUser = null;
let authMode = "signin";
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

let data = { properties: [], reservations: [] };

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
    notes: row.notes || ""
  };
}

async function loadData() {
  const requestedUserId = currentUser?.id;
  const [propertiesResult, reservationsResult] = await Promise.all([
    supabase.from("properties").select("*").order("created_at", { ascending: true }),
    supabase.from("reservations").select("*").order("check_in", { ascending: true })
  ]);
  if (propertiesResult.error) throw propertiesResult.error;
  if (reservationsResult.error) throw reservationsResult.error;
  if (!requestedUserId || currentUser?.id !== requestedUserId) return;
  data = {
    properties: propertiesResult.data.map(mapProperty),
    reservations: reservationsResult.data.map(mapReservation)
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
  document.querySelector("#page-title").innerHTML = `Welcome, ${escapeHtml(name)} <span class="wave">✦</span>`;
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
  const labels = { overview: "Overview", reservations: "Reservations", properties: "Properties" };
  document.querySelector("#breadcrumb-current").textContent = labels[view];
  const title = document.querySelector("#page-title");
  const subtitle = document.querySelector("#page-subtitle");
  title.innerHTML = view === "overview" ? `Welcome, ${escapeHtml(displayName())} <span class="wave">✦</span>` : labels[view];
  subtitle.textContent = {
    overview: "Here’s what’s happening with your stays.",
    reservations: "Keep guest details and upcoming stays organized.",
    properties: "Manage the places you welcome guests to."
  }[view];
  render();
}

function render() {
  if (currentView === "overview") renderOverview();
  if (currentView === "reservations") renderReservations();
  if (currentView === "properties") renderProperties();
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
      <td><div class="guest-cell"><span class="mini-avatar">${escapeHtml(initials(reservation.guest))}</span><span><span class="guest-name">${escapeHtml(reservation.guest)}</span><span class="guest-property">${escapeHtml(property?.name || "Property removed")}</span></span></div></td>
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
    </div>`;
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
          <td><div class="guest-cell"><span class="mini-avatar">${escapeHtml(initials(reservation.guest))}</span><span><span class="guest-name">${escapeHtml(reservation.guest)}</span><span class="guest-property">${escapeHtml(property?.name || "Property removed")}</span></span></div></td>
          <td>${formatDate(reservation.checkIn)} – ${formatDate(reservation.checkOut)}</td>
          <td>${Number(reservation.guests) || 1} ${Number(reservation.guests) === 1 ? "guest" : "guests"}</td>
          <td><span class="status status-${escapeHtml(reservation.status)}">${escapeHtml(reservation.status)}</span></td>
          <td>${money(reservation.amount)}</td>
          <td><div class="property-actions"><button class="small-button" data-action="edit-reservation" data-id="${escapeHtml(reservation.id)}">Edit</button><button class="small-button danger" data-action="delete-reservation" data-id="${escapeHtml(reservation.id)}">Remove</button></div></td>
        </tr>`;
      }).join("") : `<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">▤</span><strong>No matching reservations</strong><p>Try changing your search or add a new reservation.</p></div></td></tr>`}</tbody>
    </table></div></section>`;
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
  if (type === "reservation" && !data.properties.length) {
    showToast("Add a property before creating a reservation.");
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
  const table = isProperty ? "properties" : "reservations";
  const payload = isProperty ? {
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
    if (isProperty) {
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
    showToast(`${isProperty ? "Property" : "Reservation"} ${editor.id ? "updated" : "added"}.`);
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

document.querySelector("#auth-switch").addEventListener("click", () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  const signingUp = authMode === "signup";
  document.querySelector("#auth-name-field").hidden = !signingUp;
  document.querySelector("#auth-confirm-field").hidden = !signingUp;
  document.querySelector("#auth-forgot").hidden = signingUp;
  document.querySelector("#auth-eyebrow").textContent = signingUp ? "START YOUR HOST WORKSPACE" : "YOUR HOST WORKSPACE";
  document.querySelector("#auth-title").textContent = signingUp ? "Create your account" : "Welcome back";
  document.querySelector("#auth-subtitle").textContent = signingUp
    ? "Create an account to keep your properties and stays in sync."
    : "Sign in to manage your properties and stays.";
  document.querySelector("#auth-password").autocomplete = signingUp ? "new-password" : "current-password";
  document.querySelector("#auth-switch-copy").textContent = signingUp ? "Already have an account?" : "New to Havenstay?";
  document.querySelector("#auth-switch").textContent = signingUp ? "Sign in" : "Create an account";
  authSubmit.textContent = signingUp ? "Create account" : "Sign in";
  authSubmit.disabled = !supabase;
  setAuthMessage("");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const email = document.querySelector("#auth-email").value.trim();
  const password = passwordInput.value;
  const name = document.querySelector("#auth-name").value.trim();
  const signingUp = authMode === "signup";
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
  authSubmit.textContent = authMode === "signup" ? "Creating account…" : "Signing in…";
  setAuthMessage("");
  try {
    if (authMode === "signup") {
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
    authSubmit.textContent = authMode === "signup" ? "Create account" : "Sign in";
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
