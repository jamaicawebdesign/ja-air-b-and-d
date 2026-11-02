const range = document.querySelector("#calc-range");
const fmt = (value) => `$${Math.round(value).toLocaleString()}`;
function update() {
  const value = Number(range.value);
  document.querySelector("#calc-out").textContent = fmt(value);
  document.querySelector("#calc-save").textContent = fmt(value * 0.15);
  document.querySelector("#calc-year").textContent = fmt(value * 0.15 * 12);
}
range.addEventListener("input", update);
update();
