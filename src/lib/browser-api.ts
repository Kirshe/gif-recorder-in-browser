export const api: typeof chrome =
  typeof browser !== "undefined" ? (browser as unknown as typeof chrome) : chrome;
