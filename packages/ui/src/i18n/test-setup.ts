import { beforeEach } from "vitest";
import { YAGOO_LOCALE_STORAGE_KEY } from "./index";
import { resetTranslator } from "./active";

beforeEach(() => {
  resetTranslator();
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(YAGOO_LOCALE_STORAGE_KEY);
  }
});

if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: "en-US",
  });
}
