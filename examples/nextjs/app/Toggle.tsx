"use client";

import { useState } from "react";
// Imported from the generated snapshot rather than from "rainbowindex". The
// bare import works too once `publishSnapshot` has run, but Next.js bundles the
// client boundary separately, so the module state a server-side `publishSnapshot`
// wrote is not always the state this component reads. The bound `ri` carries the
// theme with it and cannot be split from it.
import { ri } from "./rainbowindex-snapshot";

export function Toggle() {
	const [emphasised, setEmphasised] = useState(false);
	return (
		<button
			type="button"
			onClick={() => setEmphasised((v) => !v)}
			// Without the snapshot `ri()` does not know `brand` is a color, so it
			// would keep both classes and let source order decide. With it, the
			// later one wins.
			className={ri(
				"rounded-lg px-4 py-2 font-medium bg-brand-500 text-white",
				emphasised && "bg-brand-700",
			)}
		>
			{emphasised ? "Emphasised" : "Default"}
		</button>
	);
}
