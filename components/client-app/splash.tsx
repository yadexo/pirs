import { LAUNCH_IMAGE_SIZES, launchImageFileName, launchImageMedia, pixelSize } from "@/lib/launch-image-sizes";

/**
 * `<link rel="apple-touch-startup-image">` per iPhone size — what lets iOS
 * show this clinic's own splash the instant the installed app opens, before
 * any of its HTML exists. React 19 hoists `<link>` into `<head>` wherever in
 * the tree it's rendered, so this can sit right next to <Splash> in the
 * layout rather than needing its own metadata plumbing.
 */
export function LaunchImageLinks({ base, version }: { base: string; version: string }) {
  return (
    <>
      {LAUNCH_IMAGE_SIZES.map((s) => {
        const name = launchImageFileName(pixelSize(s));
        return <link key={name} rel="apple-touch-startup-image" href={`${base}/launch-image/${name}?v=${version}`} media={launchImageMedia(s)} />;
      })}
    </>
  );
}

/**
 * The launch screen: the clinic's logo on its chosen background, shown the
 * instant the page paints (it's in the server-rendered HTML, so it doesn't
 * wait for React to hydrate) and faded out once the real screen is ready.
 *
 * iOS shows its own static version of this before any of this HTML exists —
 * see app/app/[merchantSlug]/launch-image for those.
 *
 * A plain inline <script>, not a client component: removing the overlay must
 * not depend on hydration having finished, because hydration finishing late
 * on a slow phone is exactly the moment this is covering for.
 */
export function Splash({ name, logoUrl, color, background }: { name: string; logoUrl: string | null; color: string | null; background: string }) {
  const bg = background === "white" ? "#ffffff" : color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#0b0d12";
  const onBg = background === "white" ? "#111318" : "#ffffff";
  const initial = (name.trim().charAt(0) || "•").toUpperCase();

  return (
    <>
      <div id="ca-splash" className="ca-splash" style={{ background: bg }}>
        <div className="ca-splash-mark">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" />
          ) : (
            <span aria-hidden="true" style={{ color: onBg }}>
              {initial}
            </span>
          )}
        </div>
      </div>
      <script
        // Never longer than needed: hides on load, or on a timeout if load is
        // slow to fire, whichever comes first. Reduce Motion is handled by
        // this file's CSS, not here — this only decides *when*, never *how*.
        dangerouslySetInnerHTML={{
          __html: `(function(){
            var el = document.getElementById("ca-splash");
            if (!el) return;
            var done = false;
            function hide(){
              if (done || !el) return;
              done = true;
              el.classList.add("ca-splash-out");
              var ms = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--duration-base"), 10) || 220;
              setTimeout(function(){ el && el.remove(); }, ms);
            }
            function afterPaint(fn){ requestAnimationFrame(function(){ requestAnimationFrame(fn); }); }
            if (document.readyState === "complete") afterPaint(hide);
            else window.addEventListener("load", function(){ afterPaint(hide); });
            setTimeout(hide, 1500);
          })();`,
        }}
      />
    </>
  );
}
