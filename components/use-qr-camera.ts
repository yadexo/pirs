"use client";

import * as React from "react";

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export type CameraProblem = "unsupported" | "denied" | "missing";

/**
 * Reads QR codes from the camera into `videoRef`. Uses the browser's own
 * BarcodeDetector when it has one, and falls back to jsQR (loaded only then) —
 * iPhone Safari has no BarcodeDetector. Stops after the first code.
 */
export function useQrCamera(videoRef: React.RefObject<HTMLVideoElement | null>, onCode: (value: string) => void) {
  const [problem, setProblem] = React.useState<CameraProblem | null>(null);
  const [starting, setStarting] = React.useState(true);

  React.useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem("unsupported");
        setStarting(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (err) {
        const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
        setProblem(denied ? "denied" : "missing");
        setStarting(false);
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setStarting(false);

      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      let detector: Detector | null = null;
      if (Native) {
        try {
          detector = new Native({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      async function tick() {
        if (stopped) return;
        try {
          if (video.readyState >= 2) {
            let value: string | undefined;
            if (detector) {
              value = (await detector.detect(video))[0]?.rawValue;
            } else if (jsQR && ctx) {
              // Downscale: plenty of pixels for a QR code, far less work.
              const scale = Math.min(1, 640 / (video.videoWidth || 640));
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              value = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
            }
            if (value) {
              stopped = true;
              onCode(value);
              return;
            }
          }
        } catch {
          /* a bad frame; try the next one */
        }
        timer = setTimeout(tick, 150);
      }
      void tick();
    }

    void start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode, videoRef]);

  return { problem, starting };
}
