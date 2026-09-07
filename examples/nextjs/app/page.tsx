import { Toggle } from "./Toggle";

export default function Page() {
	return (
		<main className="grid min-h-screen place-items-center gap-6 p-8">
			<h1 className="text-3xl font-bold text-brand-700">Rainbow Index + Next.js</h1>
			<p className="max-w-prose text-center text-gray-600">
				No Vite here — the PostCSS plugin does the work, and one generated snapshot makes the client{" "}
				<code className="rounded bg-gray-200 px-1">ri()</code> theme-aware.
			</p>
			<Toggle />
		</main>
	);
}
