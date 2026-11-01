"use strict";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase-config.js";
import { DEMO_SITE, demoBusy } from "./demo-data.js";

const $ = (selector) => document.querySelector(selector);
const statusBox = $("#status");
const grid = $("#properties");
const dialog = $("#listing");
const params = new URLSearchParams(window.location.search);
const demo = params.get("demo") === "1";
const slug = (params.get("s") || "").toLowerCase();

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

function amenityChips(list, limit) {
  if (!list?.length) return "";
  const shown = list.slice(0, limit);
  const extra = list.length - shown.length;
  return `<ul class="chips">${shown.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}${extra > 0 ? `<li class="more">+${extra} more</li>` : ""}</ul>`;
}

const bedsLabel = (count) => `${Number(count)} ${Number(count) === 1 ? "bedroom" : "bedrooms"}`;

function cardHtml(property, index) {
  const cover = property.photos?.[0];
  const art = cover
    ? `<div class="art" style="background-image:url('${escapeHtml(cover)}')" role="img" aria-label="${escapeHtml(property.name)}">`
    : `<div class="art art-${index % 3}"><span>${escapeHtml(property.name.slice(0, 1))}</span>`;
  return `<article class="card" tabindex="0" data-book="${escapeHtml(property.id)}">
    ${art}<span class="price-tag">${money(property.rate)} <small>/ night</small></span>${property.photos?.length > 1 ? `<span class="photo-count">${property.photos.length} photos</span>` : ""}</div>
    <div class="card-body">
      <h3>${escapeHtml(property.name)}</h3>
      <p class="loc">📍 ${escapeHtml(property.location)}</p>
      <ul class="facts"><li>🛏 ${bedsLabel(property.bedrooms)}</li></ul>
      <p class="desc">${escapeHtml((property.description || "").slice(0, 140))}${(property.description || "").length > 140 ? "…" : ""}</p>
      ${amenityChips(property.amenities, 4)}
      <button class="btn" type="button" data-book="${escapeHtml(property.id)}">View &amp; book</button>
    </div>
  </article>`;
}

function renderList() {
  const query = $("#q").value.trim().toLowerCase();
  const minBeds = Number($("#beds").value) || 0;
  const sort = $("#sort").value;
  let list = site.properties.filter((property) => `${property.name} ${property.location}`.toLowerCase().includes(query) && Number(property.bedrooms) >= minBeds);
  if (sort === "low") list = [...list].sort((a, b) => a.rate - b.rate);
  if (sort === "high") list = [...list].sort((a, b) => b.rate - a.rate);
  $("#count").textContent = `${list.length} ${list.length === 1 ? "stay" : "stays"} available`;
  grid.innerHTML = list.length ? list.map(cardHtml).join("") : "";
  statusBox.hidden = Boolean(list.length);
  statusBox.classList.remove("error");
  if (!list.length) statusBox.textContent = "No stays match your search. Try clearing the filters.";
}

async function init() {
  if (demo) {
    document.body.classList.add("demo");
    $("#demo-badge").hidden = false;
    site = DEMO_SITE;
  } else {
    if (!slug) return fail("This booking link is incomplete.");
    if (!SUPABASE_URL || !SUPABASE_KEY) return fail("This site is not configured yet.");
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await supabase.rpc("site_info", { p_slug: slug });
    if (error || !data) return fail("This booking site isn't available right now.");
    site = data;
  }
  document.title = `${site.brand_name} · Book direct`;
  $("#brand").textContent = site.brand_name;
  $("#brand-name").textContent = site.brand_name;
  $("#brand-mark").textContent = site.brand_name.trim().slice(0, 1).toUpperCase();
  $("#foot-brand").textContent = `© ${new Date().getFullYear()} ${site.brand_name}`;
  $("#tagline").textContent = site.tagline || "Comfortable stays, booked directly with your host.";
  $("#contact-title").textContent = `Questions about ${site.brand_name}?`;
  const links = [
    site.contact_email && `<a class="btn" href="mailto:${escapeHtml(site.contact_email)}">✉ ${escapeHtml(site.contact_email)}</a>`,
    site.contact_phone && `<a class="btn ghost" href="tel:${escapeHtml(site.contact_phone.replace(/[^\d+]/g, ""))}">☎ ${escapeHtml(site.contact_phone)}</a>`
  ].filter(Boolean);
  $("#contact-actions").innerHTML = links.join("") || `<a class="btn" href="#stays">Browse stays</a>`;
  if (!site.properties.length) return fail("No properties are open for booking yet. Please check back soon.");

  const hero = site.properties.find((property) => property.photos?.length)?.photos[0];
  if (hero) $(".hero").style.backgroundImage = `url('${hero.replace(/'/g, "%27")}')`;
  const rates = site.properties.map((property) => Number(property.rate));
  const stats = $("#stats");
  stats.hidden = false;
  stats.innerHTML = `<div class="stats-inner">
    <div class="stat"><strong>${site.properties.length}</strong><span>${site.properties.length === 1 ? "Stay" : "Stays"}</span></div>
    <div class="stat"><strong>${money(Math.min(...rates))}</strong><span>From / night</span></div>
    <div class="stat"><strong>0%</strong><span>Service fees</span></div>
    <div class="stat"><strong>Direct</strong><span>Host confirmation</span></div></div>`;
  grid.hidden = false;
  renderList();
}

function galleryHtml(property, index) {
  const photos = property.photos || [];
  if (!photos.length) return `<div class="gallery"><div class="placeholder">${escapeHtml(property.name.slice(0, 1))}</div></div>`;
  return `<div class="gallery"><img id="gallery-main" src="${escapeHtml(photos[0])}" alt="${escapeHtml(property.name)}">${photos.length > 1 ? `<div class="thumbs">${photos.map((url, i) => `<button type="button" class="thumb${i === 0 ? " on" : ""}" data-photo="${escapeHtml(url)}" aria-label="Show photo ${i + 1}"><img src="${escapeHtml(url)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}</div>`;
}

async function openBooking(id) {
  const property = site.properties.find((entry) => entry.id === id);
  if (!property) return;
  if (demo) busy = demoBusy();
  else {
    const { data } = await supabase.rpc("site_busy", { p_slug: slug, p_property: id });
    busy = data || [];
  }
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const body = $("#listing-body");
  body.innerHTML = `
    <div class="detail">
      <div>
        ${galleryHtml(property)}
        <h2>${escapeHtml(property.name)}</h2>
        <p class="loc">📍 ${escapeHtml(property.location)} · 🛏 ${bedsLabel(property.bedrooms)}</p>
        ${property.description ? `<h3>About this place</h3><p class="desc">${escapeHtml(property.description)}</p>` : ""}
        ${property.amenities?.length ? `<h3>Amenities</h3>${amenityChips(property.amenities, 40)}` : ""}
      </div>
      <form id="book-form" class="booking-card" novalidate>
        <div class="rate">${money(property.rate)} <small>/ night</small></div>
        <div class="row">
          <label>Check-in<input type="date" name="checkIn" min="${iso(today)}" value="${iso(tomorrow)}" required></label>
          <label>Check-out<input type="date" name="checkOut" min="${iso(tomorrow)}" required></label>
        </div>
        <p id="quote" class="quote" role="status">Choose your dates to see the total.</p>
        <label>Full name<input name="guest" maxlength="120" required autocomplete="name"></label>
        <label>Email<input name="email" type="email" maxlength="200" required autocomplete="email"></label>
        <div class="row">
          <label>Phone / WhatsApp<input name="phone" type="tel" maxlength="40" autocomplete="tel"></label>
          <label>Guests<input name="guests" type="number" min="1" max="50" value="1" required></label>
        </div>
        <label>Anything we should know?<textarea name="notes" maxlength="500"></textarea></label>
        <p id="form-error" class="error-text" role="alert" hidden></p>
        <button class="btn" type="submit" id="submit">Request to book</button>
        <p class="fine">${demo ? "This is a sample site, so nothing is sent. " : ""}Your request goes to the host, who confirms it and arranges payment with you directly. You are not charged now.</p>
      </form>
    </div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  const form = $("#book-form");
  const quote = $("#quote");
  const error = $("#form-error");
  form.parentElement.addEventListener("click", (event) => {
    const thumb = event.target.closest("[data-photo]");
    if (!thumb) return;
    $("#gallery-main").src = thumb.dataset.photo;
    body.querySelectorAll(".thumb").forEach((entry) => entry.classList.toggle("on", entry === thumb));
  });

  const clash = (start, end) => busy.some((range) => range.check_in < end && range.check_out > start);
  const update = () => {
    const { checkIn, checkOut } = form.elements;
    if (checkIn.value) checkOut.min = iso(new Date(Date.parse(`${checkIn.value}T00:00:00`) + 86400000));
    if (!checkIn.value || !checkOut.value || checkOut.value <= checkIn.value) { quote.classList.remove("bad"); quote.textContent = "Choose your dates to see the total."; return null; }
    const nights = nightsBetween(checkIn.value, checkOut.value);
    if (clash(checkIn.value, checkOut.value)) { quote.textContent = "Sorry, those dates are not available."; quote.classList.add("bad"); return null; }
    quote.classList.remove("bad");
    quote.textContent = `${nights} ${nights === 1 ? "night" : "nights"} × ${money(property.rate)} = ${money(nights * property.rate)}`;
    return nights;
  };
  form.addEventListener("input", update);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (!form.reportValidity()) return;
    if (!update()) { error.textContent = "Please choose available dates."; error.hidden = false; return; }
    const values = Object.fromEntries(new FormData(form).entries());
    const button = $("#submit");
    button.disabled = true;
    const nights = nightsBetween(values.checkIn, values.checkOut);
    const { data: result, error: rpcError } = demo
      ? { data: { nights, total: nights * property.rate }, error: null }
      : await supabase.rpc("site_book", {
        p_slug: slug, p_property: id, p_guest: values.guest, p_email: values.email, p_phone: values.phone,
        p_check_in: values.checkIn, p_check_out: values.checkOut, p_guests: Number(values.guests), p_notes: values.notes
      });
    if (rpcError) {
      error.textContent = rpcError.message || "Could not send your request.";
      error.hidden = false;
      button.disabled = false;
      return;
    }
    body.innerHTML = `<div class="done"><h2>Request sent ✓</h2><p>Thanks, ${escapeHtml(values.guest)}! ${escapeHtml(site.brand_name)} will confirm your ${result.nights}-night stay at ${escapeHtml(property.name)} (${money(result.total)}) by email.</p><button class="btn dark" type="button" id="done-close">Back to stays</button></div>`;
    $("#done-close").addEventListener("click", () => dialog.close());
  });
  update();
}

grid.addEventListener("click", (event) => {
  const target = event.target.closest("[data-book]");
  if (target) void openBooking(target.dataset.book);
});
grid.addEventListener("keydown", (event) => {
  const target = event.target.closest("[data-book]");
  if (target && (event.key === "Enter" || event.key === " ") && event.target === target) { event.preventDefault(); void openBooking(target.dataset.book); }
});
$("#search").addEventListener("submit", (event) => { event.preventDefault(); renderList(); $("#stays").scrollIntoView(); });
["#q", "#beds", "#sort"].forEach((selector) => $(selector).addEventListener("input", () => site && renderList()));
$("#listing-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

void init();
