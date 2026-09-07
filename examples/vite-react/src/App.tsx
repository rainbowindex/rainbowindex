import { recipe } from "rainbowindex/recipe";

// A recipe is a typed variant layer whose output is ordinary class names. The
// classes live in this config, which the scanner reads the way it reads a
// `cva`/`tv` one — nothing here is assembled at runtime.
const button = recipe({
	base: "rounded-lg font-medium",
	variants: {
		tone: {
			solid: "bg-brand-500 text-white",
			quiet: "bg-brand-100 text-brand-700",
		},
		size: {
			sm: "px-3 py-1 text-sm",
			md: "px-4 py-2",
		},
	},
	compoundVariants: [{ tone: "solid", size: "md", class: "shadow-sm" }],
	defaultVariants: { tone: "solid", size: "md" },
});

export function App() {
	return (
		<main className="min-h-screen grid place-items-center gap-6 bg-gray-50 p-8">
			<h1 className="text-3xl font-bold text-brand-700">Rainbow Index + Vite</h1>
			<p className="max-w-prose text-center text-gray-600">
				<code className="rounded bg-gray-200 px-1">brand</code> is declared as one hue and chroma
				pair in <code className="rounded bg-gray-200 px-1">src/styles.css</code>; every stop below
				is generated from it.
			</p>
			<div className="flex items-center gap-3">
				<button type="button" className={button()}>
					Default
				</button>
				<button type="button" className={button({ tone: "quiet", size: "sm" })}>
					Quiet, small
				</button>
				{/* `class` merges last and goes through `ri()`, so it beats the
				    recipe's own `bg-brand-500` rather than sitting beside it. */}
				<button type="button" className={button({ class: "bg-brand-700" })}>
					Overridden
				</button>
			</div>
			{/* Written out rather than built with `bg-brand-${stop}`: the scanner
			    reads source text, so a class assembled at runtime is a class it
			    never sees. Interpolate whole class names, or list them with
			    `@source inline(...)`. */}
			<div className="flex">
				{["bg-brand-100", "bg-brand-300", "bg-brand-500", "bg-brand-700", "bg-brand-900"].map(
					(shade) => (
						<div key={shade} className={`size-12 ${shade}`} />
					),
				)}
			</div>
		</main>
	);
}
