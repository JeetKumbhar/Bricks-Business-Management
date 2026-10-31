import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";

/**
 * "AAYUSH CARTING" intro: a loaded tipper truck arrives at a brick yard (real-time 3D scene, see introScene.js), the brand
 * name reveals, then everything dissolves into the already-mounted app.
 *
 * - Mounted once from App.jsx. App never remounts on route changes, so this plays on every full page load / reload and
 *   never while navigating inside the app. Nothing is stored.
 * - Visual layer only: router, providers and pages render normally underneath it.
 * - ONE GSAP timeline drives the scene objects (truck, wheels, brick stack, world) and the DOM text. `onComplete` removes the
 *   overlay. The three.js code is loaded on demand so it never delays the dashboard's own code.
 * - Safe fallbacks: if the 3D scene cannot load or WebGL is unavailable, the brand name still plays; any error removes the overlay.
 */
const INK = "#252B30";
const GOLD = "#C48A22";
const BG = "#FAFAF8";
const LOAD_GUARD_MS = 5000; // never wait longer than this for the 3D scene code

// one span per letter so GSAP can stagger them; the overlay itself carries the accessible name "AAYUSH CARTING"
const chars = (word) =>
  word.split("").map((c, i) => (
    <span key={i} className="ch inline-block">
      {c}
    </span>
  ));

export default function IntroAnimation() {
  const rootRef = useRef(null);
  const hostRef = useRef(null);
  const [done, setDone] = useState(false);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return undefined;

    let cancelled = false;
    let scene = null;
    let observer = null;
    const draw = () => scene?.render();
    const q = gsap.utils.selector(root);
    const finish = () => {
      if (!cancelled) setDone(true);
    };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const ctx = gsap.context(() => {
      gsap.set(q(".ch"), { opacity: 0, y: 22 });
      gsap.set(q(".name-a"), { letterSpacing: "0.3em" });
      gsap.set(q(".name-b"), { letterSpacing: "0.85em" });
      gsap.set(q(".rule"), { opacity: 0, scaleX: 0 });
      gsap.set(q(".sub"), { opacity: 0, y: 10 });
    }, root);

    const play = () => {
      const S = scene;
      const tl = gsap.timeline({ onComplete: finish, defaults: { ease: "power2.out" } });

      if (reduce) {
        // Reduced motion: show the finished composition, then a short fade.
        gsap.set(q(".ch, .sub"), { opacity: 1, y: 0 });
        gsap.set(q(".name-a"), { letterSpacing: "0.1em" });
        gsap.set(q(".name-b"), { letterSpacing: "0.42em" });
        gsap.set(q(".rule"), { opacity: 1, scaleX: 1 });
        if (S) {
          S.truck.position.x = S.finalX;
          S.jcb.position.x = 0;
          S.setStackOpacity(1);
          S.setJcbOpacity(1);
        }
        tl.to(root, { opacity: 0, duration: 0.3, delay: 0.25, ease: "none" });
        return;
      }

      // Strict story: bricks (0) -> JCB drives in right-to-left (0.7-1.8) -> truck drives in right-to-left (1.8-2.9)
      // -> brand reveal (2.1-3.6) -> hold (3.3-3.8) -> dashboard (3.8-4.3). Both vehicles face -x, so "forward" is right-to-left.
      tl.addLabel("scene", 0).addLabel("jcb", 0.7).addLabel("truck", 1.8).addLabel("brand", 2.1).addLabel("hold", 3.3).addLabel("exit", 3.8);

      if (S) {
        // Phase 1 (0 - 0.7 s): the brick piles fade in and rise; ground shadows establish depth.
        const fade = { o: 0 };
        tl.to(fade, { o: 1, duration: 0.7, ease: "power2.out", onUpdate: () => S.setStackOpacity(fade.o) }, "scene");
        tl.fromTo(S.stack.position, { y: -0.35 }, { y: 0, duration: 0.8, ease: "power2.out" }, "scene");
        tl.fromTo(S.world.rotation, { y: 0.05 }, { y: 0, duration: 2.6, ease: "sine.out" }, "scene");

        // Phase 3 (1.8 - 2.9 s): only after the JCB has stopped, the truck drives in from the right the same way.
        let lastX = S.startX;
        tl.fromTo(
          S.truck.position,
          { x: S.startX },
          {
            x: S.finalX,
            duration: 1.1,
            ease: "power3.out",
            onUpdate: () => {
              const dx = lastX - S.truck.position.x;
              lastX = S.truck.position.x;
              S.wheels.forEach((w) => {
                w.rotation.z += dx / S.wheelRadius;
              });
            },
          },
          "truck"
        );
        tl.to(S.truck.rotation, { z: 0.012, duration: 0.3, ease: "sine.out" }, "truck+=0.65"); // weight shifts forward as it brakes
        tl.to(S.truck.rotation, { z: 0, duration: 0.5, ease: "sine.inOut" }, "truck+=0.95");

        // Phase 2 (0.7 - 1.8 s): the JCB drives in from the right (forward = toward -x, bucket leading), decelerates and stops; arms settle.
        let jLast = S.jcbStartX;
        const P = S.jcbParts;
        tl.fromTo(
          S.jcb.position,
          { x: S.jcbStartX },
          {
            x: 0,
            duration: 1.1,
            ease: "power2.out",
            onUpdate: () => {
              const dx = jLast - S.jcb.position.x;
              jLast = S.jcb.position.x;
              S.jcbWheels.forEach(({ spin, r }) => {
                spin.rotation.z += dx / r;
              });
            },
          },
          "jcb"
        );
        tl.fromTo(P.loaderArm.rotation, { z: -0.16 }, { z: 0, duration: 1.1, ease: "power2.inOut" }, "jcb+=0.2");
        tl.fromTo(P.loaderBucket.rotation, { z: 0.4 }, { z: 0, duration: 1.0, ease: "power2.inOut" }, "jcb+=0.25");
        tl.fromTo(P.boom.rotation, { z: 0.1 }, { z: 0, duration: 1.1, ease: "power2.inOut" }, "jcb+=0.2");
        tl.fromTo(P.stick.rotation, { z: -0.16 }, { z: 0, duration: 1.1, ease: "power2.inOut" }, "jcb+=0.25");
        tl.fromTo(P.hoeBucket.rotation, { z: 0.3 }, { z: 0, duration: 1.0, ease: "power2.inOut" }, "jcb+=0.3");
      }

      // Phase 4 (2.1 - 3.6 s): brand reveal. AAYUSH first (tracking tightens from wide to final), then CARTING, then the rule.
      tl.to(q(".name-a"), { letterSpacing: "0.1em", duration: 1.3, ease: "power3.out" }, "brand");
      tl.to(q(".name-a .ch"), { opacity: 1, y: 0, duration: 0.75, stagger: 0.07, ease: "power3.out" }, "brand");
      tl.to(q(".name-b"), { letterSpacing: "0.42em", duration: 1.2, ease: "power3.out" }, "brand+=0.35");
      tl.to(q(".name-b .ch"), { opacity: 1, y: 0, duration: 0.65, stagger: 0.055, ease: "power3.out" }, "brand+=0.35");
      tl.to(q(".rule"), { opacity: 1, scaleX: 1, duration: 0.8, ease: "power2.inOut" }, "brand+=0.75");
      tl.to(q(".sub"), { opacity: 1, y: 0, duration: 0.7 }, "brand+=0.9");

      // Phase 4 (2.2 - 3.0 s): the finished composition holds.

      // Phase 5 (3.0 - 4.0 s): text fades, the scene drifts down and away, the overlay dissolves into the dashboard.
      tl.set(root, { pointerEvents: "none" }, "exit");
      tl.to(q(".name-a, .name-b, .rule, .sub"), { opacity: 0, y: -10, duration: 0.45, ease: "power2.in" }, "exit");
      if (S) {
        tl.to(S.world.position, { y: -0.5, x: -0.6, duration: 0.6, ease: "power2.inOut" }, "exit");
        tl.to(S.world.scale, { x: 0.97, y: 0.97, z: 0.97, duration: 0.6, ease: "power2.inOut" }, "exit");
      }
      tl.to(host, { opacity: 0, duration: 0.45, ease: "power1.in" }, "exit+=0.05");
      tl.to(root, { opacity: 0, duration: 0.5, ease: "power1.inOut" }, "exit+=0.0");
    };

    const start = async () => {
      let mod = null;
      let guard;
      try {
        mod = await Promise.race([
          import("./introScene"),
          new Promise((_, reject) => {
            guard = setTimeout(() => reject(new Error("3D scene did not load in time")), LOAD_GUARD_MS);
          }),
        ]);
      } catch (error) {
        console.warn("[intro] continuing without the 3D scene:", error);
      } finally {
        clearTimeout(guard);
      }
      if (cancelled) return;

      if (mod) {
        try {
          scene = mod.createIntroScene(host);
          scene.startX = mod.TRUCK_START_X;
          scene.finalX = mod.TRUCK_FINAL_X;
          scene.wheelRadius = mod.WHEEL_RADIUS;
          scene.jcbStartX = mod.JCB_START_X;
          observer = new ResizeObserver(() => scene.resize());
          observer.observe(host);
          scene.render(); // first frame before any motion
          gsap.ticker.add(draw);
        } catch (error) {
          console.warn("[intro] WebGL unavailable, showing the brand name only:", error);
          scene = null;
        }
      }
      ctx.add(play);
    };

    start().catch((error) => {
      console.error("[intro] failed, removing overlay:", error);
      finish();
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      gsap.ticker.remove(draw);
      ctx.revert();
      scene?.dispose();
      scene = null;
    };
  }, []);

  if (done) return null;

  return (
    <div
      ref={rootRef}
      role="status"
      aria-label="AAYUSH CARTING"
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center overflow-hidden"
      style={{ background: BG }}
    >
      <div className="relative z-10 shrink-0 px-4 pt-6 text-center sm:pt-0" style={{ marginBottom: "clamp(0px, 1vh, 12px)" }}>
        <p
          className="name-a font-extrabold leading-none"
          style={{ color: INK, fontSize: "clamp(2.6rem, 9vw, 5.6rem)", letterSpacing: "0.1em", paddingLeft: "0.1em" }}
          aria-hidden="true"
        >
          {chars("AAYUSH")}
        </p>
        <div className="mt-2 flex items-center justify-center gap-3 sm:gap-4">
          <span className="rule h-px w-8 sm:w-20" style={{ background: GOLD, transformOrigin: "right center" }} />
          <p
            className="name-b font-semibold leading-none"
            style={{ color: GOLD, fontSize: "clamp(1.1rem, 3.6vw, 2.1rem)", letterSpacing: "0.42em", marginRight: "-0.42em" }}
            aria-hidden="true"
          >
            {chars("CARTING")}
          </p>
          <span className="rule h-px w-8 sm:w-20" style={{ background: GOLD, transformOrigin: "left center" }} />
        </div>
        <p className="sub mt-3 text-[10px] font-medium uppercase sm:text-xs" style={{ color: "#7B8590", letterSpacing: "0.32em" }}>
          Business Management System
        </p>
      </div>

      <div className="relative w-full min-h-[240px] max-sm:min-h-0 max-sm:flex-1 sm:h-[clamp(240px,46vh,480px)]" aria-hidden="true">
        <div ref={hostRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
