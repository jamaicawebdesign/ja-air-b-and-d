const $ = (selector) => document.querySelector(selector);

function applyMode() {
  const signingUp = window.location.hash === "#signup";
  $("#auth-form").dataset.mode = signingUp ? "signup" : "signin";
  $("#auth-name-field").hidden = !signingUp;
  $("#auth-confirm-field").hidden = !signingUp;
  $("#auth-forgot").hidden = signingUp;
  $("#auth-eyebrow").textContent = signingUp ? "START YOUR HOST WORKSPACE" : "YOUR HOST WORKSPACE";
  $("#auth-title").textContent = signingUp ? "Create your account" : "Welcome back";
  $("#auth-subtitle").textContent = signingUp
    ? "Create an account to keep your properties and stays in sync."
    : "Sign in to manage your properties and stays.";
  $("#auth-password").autocomplete = signingUp ? "new-password" : "current-password";
  $("#auth-switch-copy").textContent = signingUp ? "Already have an account?" : "New to Havenstay?";
  $("#auth-switch").textContent = signingUp ? "Sign in" : "Create an account";
  $("#auth-switch").setAttribute("href", signingUp ? "#signin" : "#signup");
  $("#auth-submit").textContent = signingUp ? "Create account" : "Sign in";
  $("#auth-message").textContent = "";
}

window.addEventListener("hashchange", applyMode);
applyMode();
