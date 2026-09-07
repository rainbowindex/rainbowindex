export function App() {
	return (
		<main className="card p-fluid-4 z-modal shadow-card inset-md rounded-roof-minus-2 tab-size-4">
			<h1 className="text-display font-display font-black tracking-wide leading-snug">Title</h1>
			<p className="text-body font-sans font-regular text-surface opacity-muted">Body copy.</p>
			<a className="hocus:underline any-hover:text-brand-700 lg:text-punchy-500" href="/">
				Link
			</a>
			<span className="animate-shimmer duration-slow ease-swift blur-sm border-hairline bg-clear text-accent-500" />
			<code className="font-mono sm:text-fluid-display">code</code>
		</main>
	);
}
