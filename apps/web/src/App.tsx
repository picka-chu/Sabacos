import { PlaybackBar } from "./components/PlaybackBar";
import { Viewport } from "./components/Viewport";
import { Timeline } from "./components/Timeline";
import { LayerList } from "./components/LayerList";
import { Inspector } from "./components/Inspector";

export function App() {
  return (
    <main className="app">
      <PlaybackBar />
      <div className="main">
        <LayerList />
        <Viewport />
        <Inspector />
      </div>
      <Timeline />
    </main>
  );
}
