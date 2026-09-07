export function Home() {
	return (
		<main className="mx-auto grid max-w-prose gap-4">
			<h1 className="text-3xl font-bold text-brand-700">Rainbow Index + React Router</h1>
			<p className="text-gray-600">
				The active link's classes are composed with <code>ri()</code>, so
				<code className="mx-1 rounded bg-gray-200 px-1">text-gray-600</code> loses to
				<code className="mx-1 rounded bg-gray-200 px-1">text-white</code> rather than both shipping
				and the stylesheet deciding.
			</p>
		</main>
	);
}
