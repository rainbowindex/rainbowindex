// Next.js has no Vite, so the PostCSS plugin is the integration. It finds the
// CSS entry, scans your sources, and expands `@apply`.
import rainbowindex from "rainbowindex";

export default { plugins: [rainbowindex()] };
