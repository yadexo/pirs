// Vitest runs in Node, where the real `server-only` package is a harmless
// no-op anyway (it only throws when `window` is defined). This shim avoids a
// Vite module-resolution error some `server-only` package versions trigger
// under Vitest's transform pipeline.
export {};
