import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app.html"),
        book: resolve(import.meta.dirname, "book.html"),
        thanks: resolve(import.meta.dirname, "thank-you.html")
      }
    }
  }
});
