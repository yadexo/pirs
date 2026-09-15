import QRCode from "qrcode";

/**
 * A real, scannable QR code as one SVG path. The client app's previous
 * "QR code" drew a random pattern that looked like one but encoded nothing, so
 * no camera could read a check-in or redemption code.
 *
 * Error correction "M" survives a scuffed phone screen or a printed poster.
 */
export function qrSvgPath(value: string): { path: string; size: number } {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
  const n = modules.size;
  let path = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules.get(y, x)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { path, size: n };
}

/** Standalone SVG markup, e.g. for a printable clinic poster or a download. */
export function qrSvg(value: string, { margin = 4, dark = "#000000", light = "#ffffff" } = {}): string {
  const { path, size } = qrSvgPath(value);
  const total = size + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${light}"/><path transform="translate(${margin} ${margin})" fill="${dark}" d="${path}"/></svg>`;
}
