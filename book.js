"use strict";

import { createClient } from "@supabase/supabase-js";

const $ = (selector) => document.querySelector(selector);
const statusBox = $("#status");
const grid = $("#properties");
const booking = $("#booking");
const slug = (new URLSearchParams(window.location.search).get("s") || "").toLowerCase();

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const money = (value) => `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

let supabase;
let site;
let busy = [];

function fail(message) {
  statusBox.textContent = message;
  statusBox.hidden = false;
  statusBox.classList.add("error");
}

async function init() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!slug) return fail("This booking link is incomplete.");
  if (!url || !key) return fail("This site is not configured yet.");
  supabase = createClient(url, key);
  const { data, error } = await supabase.rpc("site_info", { p_slug: slug });
  if (error || !data) return fail("This booking site isn't available right now.");
  site = data;
  document.title = `${site.brand_name} · Book direct`;
  $("#brand").textContent = site.brand_name;
  $("#tagline").textContent = site.tagline || "";
  const contact = [site.contact_email, site.contact_phone].filter(Boolean).map(escapeHtml).join(" · ");
  $("#contact").innerHTML = contact ? `Questions? ${contact}` : "";
  if (!site.properties.length) return fail("No properties are open for booking yet. Please check back soon.");
  statusBox.hidden = true;
  grid.hidden = false;
  grid.innerHTML = site.properties.map((property, index) => `
    <article class="card">
      <div class="art art-${index % 3}"><span>${escapeHtml(property.name.slice(0, 1))}</span></div>
      <div class="card-body">
        <h2>${escapeHtml(property.name)}</h2>
        <p class="meta">${escapeHtml(property.location)} · ${Number(property.bedrooms)} ${Number(property.bedrooms) === 1 ? "bedroom" : "bedrooms"}</p>
        <p class="desc">${escapeHtml(property.description)}</p>
        <div class="card-foot"><strong>${money(property.rate)}</strong><span> / night</span>
          <button class="btn" data-book="${escapeHtml(property.id)}">Check availability</button></div>
      </div>
    </article>`).join("");
}

async function openBooking(id) {
  const property = site.properties.find((entry) => entry.id === id);
  if (!property) return;
  const { data } = await supabase.rpc("site_busy", { p_slug: slug, p_property: id });
  busy = data || [];
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  booking.hidden = false;
  booking.innerHTML = `
    <form id="book-form" class="form" novalidate>
      <h2>Book ${escapeHtml(property.name)}</h2>
      <div class="row">
        <label>Check-in<input type="date" name="checkIn" min="${iso(today)}" value="${iso(tomorrow)}" required></label>
        <label>Check-out<input type="date" name="checkOut" min="${iso(tomorrow)}" required></label>
      </div>
      <p id="quote" class="quote" role="status">Choose your dates to see the total.</p>
      <div class="row">
        <label>Full name<input name="guest" maxlength="120" required autocomplete="name"></label>
        <label>Email<input name="email" type="email" maxlength="200" required autocomplete="email"></label>
      </div>
      <div class="row">
        <label>Phone / WhatsApp (optional)<input name="phone" type="tel" maxlength="40" autocomplete="tel"></label>
        <label>Guests<input name="guests" type="number" min="1" max="50" value="1" required></label>
      </div>
      <label>Anything we should know? (optional)<textarea name="notes" maxlength="500"></textarea></label>
      <p id="form-error" class="error-text" role="alert" hidden></p>
      <div class="row actions"><button type="button" class="btn ghost" id="cancel">Back</button><button class="btn" type="submit" id="submit">Request to book</button></div>
      <p class="fine">Your request is sent to the host, who will confirm it and arrange payment with you directly. You are not charged now.</p>
    </form>`;
  booking.scrollIntoView({ behavior: "smooth", block: "start" });
  const form = $("#book-form");
  const quote = $("#quote");
  const error = $("#form-error");

  const clash = (start, end) => busy.some((range) => range.check_in < end && range.check_out > start);
  const update = () => {
    const { checkIn, checkOut } = form.elements;
    if (checkIn.value) checkOut.min = iso(new Date(Date.parse(`${checkIn.value}T00:00:00`) + 86400000));
    if (!checkIn.value || !checkOut.value || checkOut.value <= checkIn.value) { quote.textContent = "Choose your dates to see the total."; return null; }
    const nights = nightsBetween(checkIn.value, checkOut.value);
    if (clash(checkIn.value, checkOut.value)) { quote.textContent = "Sorry, those dates are not available."; quote.classList.add("bad"); return null; }
    quote.classList.remove("bad");
    quote.textContent = `${nights} ${nights === 1 ? "night" : "nights"} × ${money(property.rate)} = ${money(nights * property.rate)}`;
    return nights;
  };
  form.addEventListener("input", update);
  $("#cancel").addEventListener("click", () => { booking.hidden = true; booking.innerHTML = ""; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (!form.reportValidity()) return;
    if (!update()) { error.textContent = "Please choose available dates."; error.hidden = false; return; }
    const values = Object.fromEntries(new FormData(form).entries());
    const button = $("#submit");
    button.disabled = true;
    const { data, error: rpcError } = await supabase.rpc("site_book", {
      p_slug: slug, p_property: id, p_guest: values.guest, p_email: values.email, p_phone: values.phone,
      p_check_in: values.checkIn, p_check_out: values.checkOut, p_guests: Number(values.guests), p_notes: values.notes
    });
    if (rpcError) {
      error.textContent = rpcError.message || "Could not send your request.";
      error.hidden = false;
      button.disabled = false;
      return;
    }
    booking.innerHTML = `<div class="form done"><h2>Request sent ✓</h2><p>Thanks, ${escapeHtml(values.guest)}! ${escapeHtml(site.brand_name)} will confirm your ${data.nights}-night stay at ${escapeHtml(property.name)} (${money(data.total)}) by email.</p></div>`;
  });
  update();
}

grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-book]");
  if (button) void openBooking(button.dataset.book);
});

void init();
