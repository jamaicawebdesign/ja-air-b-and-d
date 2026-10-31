// Email confirmation and password-reset links land on the site root; hand them to the app.
const { hash, search } = window.location;
if (/access_token=|refresh_token=|type=(signup|recovery|magiclink|invite)|error_description=/.test(hash) || /[?&](code|token_hash)=/.test(search)) {
  window.location.replace(`/app.html${search}${hash}`);
}
