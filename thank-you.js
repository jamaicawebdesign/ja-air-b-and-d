import { createClient } from "@supabase/supabase-js";
import { PAYMENT } from "./payment-config.js";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase-config.js";

const params = new URLSearchParams(window.location.search);
const email = params.get("email") || "";
const name = (params.get("name") || "").split(" ")[0];
const $ = (s) => document.querySelector(s);

if (name) $("#who").textContent = `, ${name}`;
if (params.get("confirm")) $("#confirm-note").hidden = false;
if (email) $("#ref").textContent = email;

const plans = [["Starter", "1–2 properties", 12], ["Host", "3–6 properties", 29], ["Pro", "7–15 properties", 59], ["Manager", "16–40 properties", 119]];
const plansBox = $("#plans");
plans.forEach(([n, d, p], i) => {
  const label = document.createElement("label");
  label.className = "plan";
  const input = document.createElement("input");
  Object.assign(input, { type: "radio", name: "plan", value: n, checked: i === 1 });
  const text = document.createElement("span");
  text.textContent = `${n} · ${d} · US$${p}/mo`;
  label.append(input, text);
  plansBox.append(label);
});

const bank = $("#bank");
[["Bank", PAYMENT.bankName], ["Account name", PAYMENT.accountName], ["Account number", PAYMENT.accountNumber], ["Branch", PAYMENT.branch], ["Account type", PAYMENT.accountType], ["Currency", PAYMENT.currencyNote]].forEach(([k, v]) => {
  const dt = document.createElement("dt"); dt.textContent = k;
  const dd = document.createElement("dd"); dd.textContent = v;
  bank.append(dt, dd);
});

const client = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

async function savePlan(plan) {
  localStorage.setItem("havenstay_plan", plan.toLowerCase());
  if (!client) return;
  const { data } = await client.auth.getSession();
  if (!data.session) return;
  const { error } = await client.rpc("choose_plan", { p_plan: plan.toLowerCase() });
  if (!error) localStorage.removeItem("havenstay_plan");
}

function updateLink() {
  const plan = document.querySelector("input[name=plan]:checked")?.value || "";
  const msg = `Hi Havenstay, I've made a bank transfer for the ${plan} plan. Account email: ${email || "(my email)"}. Proof of payment attached.`;
  $("#wa").href = `https://wa.me/${PAYMENT.whatsapp}?text=${encodeURIComponent(msg)}`;
}
plansBox.addEventListener("change", () => { updateLink(); void savePlan(document.querySelector("input[name=plan]:checked").value); });
updateLink();
void savePlan(document.querySelector("input[name=plan]:checked").value);
