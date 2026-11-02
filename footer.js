// Add your real profile URLs here; empty ones are hidden.
const SOCIAL = [
  ["WhatsApp", "https://wa.me/18765497399", "M16 3a13 13 0 0 0-11 19.900L3 29l6.300-2A13 13 0 1 0 16 3zm0 2.400a10.600 10.600 0 1 1-5.500 19.700l-.4-.2-3.700 1.200 1.200-3.600-.3-.4A10.600 10.600 0 0 1 16 5.400z"],
  ["Facebook", "", "M18 29V17h4l1-5h-5V9c0-1.500.5-2.500 2.600-2.500H23V2.200C22.600 2.100 21.200 2 19.700 2 16.400 2 14 4 14 8v4H10v5h4v12z"],
  ["Instagram", "", "M16 4c-3.300 0-3.700 0-5 .1-3.400.2-5.300 2.100-5.500 5.500C5.400 10.900 5.400 11.300 5.400 16s0 5.100.1 6.400c.2 3.400 2.100 5.300 5.500 5.500 1.300.1 1.700.1 5 .1s3.700 0 5-.1c3.400-.2 5.300-2.100 5.500-5.500.1-1.300.1-1.700.1-6.400s0-5.100-.1-6.400c-.2-3.400-2.100-5.300-5.500-5.500C19.700 4 19.300 4 16 4zm0 2.800a9.200 9.200 0 1 1 0 18.400 9.200 9.200 0 0 1 0-18.400zm0 3.200a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"],
  ["TikTok", "", "M22 3h-4v18a3 3 0 1 1-3-3V14a7 7 0 1 0 7 7V12a9 9 0 0 0 5 1.500V9.500A5 5 0 0 1 22 5z"],
  ["YouTube", "", "M29 10c-.3-1.400-1.400-2.400-2.800-2.700C23.800 6.700 16 6.700 16 6.700s-7.800 0-10.200.6C4.400 7.600 3.300 8.600 3 10c-.6 2-.6 6-.6 6s0 4 .6 6c.3 1.400 1.400 2.400 2.800 2.700 2.400.6 10.200.6 10.200.6s7.800 0 10.200-.6c1.400-.3 2.500-1.300 2.800-2.700.6-2 .6-6 .6-6s0-4-.6-6zM13 20.500v-9l7.500 4.500z"]
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const social = SOCIAL.filter(([, url]) => url).map(([name, url, path]) =>
  `<a href="${esc(url)}" target="_blank" rel="noopener me" aria-label="${esc(name)}" title="${esc(name)}"><svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg></a>`).join("");

const footer = document.querySelector("#site-footer");
if (footer) {
  footer.className = "site-foot";
  footer.innerHTML = `
    <div class="sf-inner">
      <div class="sf-brand">
        <a class="logo" href="/"><span class="logo-mark">h</span>havenstay</a>
        <p>Booking and property-management software for Jamaican hosts and landlords. Walk good.</p>
        <div class="sf-social">${social}</div>
      </div>
      <nav class="sf-col" aria-label="Product"><h4>Product</h4>
        <a href="/#demo">Live demo</a><a href="/#features">Features</a><a href="/#pricing">Pricing</a><a href="/app.html#signup">Create account</a></nav>
      <nav class="sf-col" aria-label="Company"><h4>Company</h4>
        <a href="/about.html">About Havenstay</a><a href="/contact.html">Contact</a><a href="/help.html">Help centre</a></nav>
      <nav class="sf-col" aria-label="Legal"><h4>Legal</h4>
        <a href="/privacy.html">Privacy policy</a><a href="/terms.html">Terms of service</a></nav>
      <div class="sf-col"><h4>Talk to us</h4>
        <a href="https://wa.me/18765497399?text=Hi%20Havenstay" target="_blank" rel="noopener">WhatsApp +1 876 549 7399</a>
        <a href="https://wa.me/18765497399?text=Hi%20Havenstay%2C%20I%27d%20like%20to%20request%20a%20demonstration." target="_blank" rel="noopener">Request a demo</a></div>
    </div>
    <div class="sf-bottom"><span>© ${new Date().getFullYear()} Havenstay. All rights reserved.</span><span>Made in Jamaica 🇯🇲</span></div>`;
}
