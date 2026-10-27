/**
 * motion's animation features (layout, shared layout, drag), loaded after
 * first paint: the app renders `m.*` components inside <LazyMotion> (App.tsx),
 * so the first bundle carries only the tiny renderer.
 */
export { domMax as default } from "motion/react";
