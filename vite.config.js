import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app.html"),
        book: resolve(import.meta.dirname, "book.html"),
        thanks: resolve(import.meta.dirname, "thank-you.html"),
        about: resolve(import.meta.dirname, "about.html"),
        contact: resolve(import.meta.dirname, "contact.html"),
        help: resolve(import.meta.dirname, "help.html"),
        privacy: resolve(import.meta.dirname, "privacy.html"),
        terms: resolve(import.meta.dirname, "terms.html")
      }
    }
  }
});
