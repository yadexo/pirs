/**
 * HTTPS in front of the local server, for trying the apps on a phone.
 *
 * Browsers only allow the camera (QR scanning), service workers and install on
 * https:// or localhost. A phone on the same Wi-Fi reaches this machine by its
 * network address, so plain http there has no camera. This serves
 * https://<this-computer>:3443 with a self-signed certificate — the phone warns
 * once; accept it ("Show details" → "visit this website" on iPhone).
 */
import { createServer } from "node:https";
import { request } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";

export function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

async function certificate(ips) {
  const dir = path.resolve(".certs");
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  const ipsFile = path.join(dir, "ips.txt");
  const wanted = ["127.0.0.1", ...ips].sort().join(",");
  if (existsSync(certFile) && existsSync(ipsFile) && readFileSync(ipsFile, "utf8") === wanted) {
    return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
  }
  const { generate } = await import("selfsigned");
  const pems = await generate([{ name: "commonName", value: "localhost" }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: new Date(Date.now() + 365 * 864e5),
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, ...wanted.split(",").map((ip) => ({ type: 7, ip }))] },
    ],
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(keyFile, pems.private);
  writeFileSync(certFile, pems.cert);
  writeFileSync(ipsFile, wanted);
  return { key: pems.private, cert: pems.cert };
}

export async function startHttpsProxy({ port = 3443, target = 3000 } = {}) {
  const { key, cert } = await certificate(lanAddresses());
  const server = createServer({ key, cert }, (req, res) => {
    const upstream = request(
      {
        host: "127.0.0.1",
        port: target,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host ?? `localhost:${port}` },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("The app server isn't running yet. Try again in a moment.");
    });
    req.pipe(upstream);
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, "0.0.0.0", resolve));
  return server;
}
