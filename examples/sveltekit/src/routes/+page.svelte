<script lang="ts">
import { ri } from "rainbowindex";

let emphasised = $state(false);
// `ri()` picks the winner, so toggling never leaves two conflicting classes.
const button = $derived(
	ri("rounded-lg px-4 py-2 font-medium bg-brand-500 text-white", emphasised && "bg-brand-700"),
);
</script>

<main class="grid min-h-screen place-items-center gap-6 p-8">
	<h1 class="text-3xl font-bold text-brand-700">Rainbow Index + SvelteKit</h1>
	<p class="max-w-prose text-center text-gray-600">
		Svelte's <code class="rounded bg-gray-200 px-1">class:</code> directives are scanned too, as
		are plain class attributes and any string a helper builds.
	</p>
	<button type="button" class={button} onclick={() => (emphasised = !emphasised)}>
		{emphasised ? "Emphasised" : "Default"}
	</button>
</main>
