import { NavLink, Outlet } from "react-router";
import { ri } from "rainbowindex";

// One place decides what a nav link looks like; `ri()` lets the active state
// override a base class instead of fighting it.
const link = (active: boolean) =>
	ri("rounded-lg px-3 py-1.5 font-medium text-gray-600", active && "bg-brand-500 text-white");

export function Layout() {
	return (
		<div className="min-h-screen bg-gray-50 p-8">
			<nav className="mx-auto mb-8 flex max-w-prose gap-2">
				<NavLink to="/" className={({ isActive }) => link(isActive)} end>
					Home
				</NavLink>
				<NavLink to="/about" className={({ isActive }) => link(isActive)}>
					About
				</NavLink>
			</nav>
			<Outlet />
		</div>
	);
}
