import type { Viewport } from "next";

/**
 * How the client app sits on a phone screen.
 *
 * Installed from the Home Screen, this is the whole app rather than a page in
 * a browser, and a page you can pinch and double-tap to zoom does not feel
 * like one: text drifts off-centre, the tab bar scrolls away, and a stray
 * double-tap blows up the layout mid-booking. So scaling is fixed.
 *
 * `viewportFit: "cover"` is what lets the layout reach under the notch and the
 * home bar; the safe-area insets in client-app.css (--sat/--sab) depend on it,
 * so it must stay.
 *
 * Fixing the scale takes a zoom away from the client, which only works if
 * nothing needs zooming into: see the type floor and the contrast tokens in
 * client-app.css, and the test that keeps both honest.
 *
 * Deliberately not applied to the clinic dashboard or the agency panel. Those
 * are desktop tools where zooming is a normal thing to want.
 */
export const clientAppViewport: Viewport = {
  themeColor: "#f4f5f7",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};
