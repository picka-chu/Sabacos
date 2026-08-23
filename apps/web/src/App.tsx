import { PlaybackBar } from "./components/PlaybackBar";
import { Viewport } from "./components/Viewport";
import { Timeline } from "./components/Timeline";
import { LayerList } from "./components/LayerList";
import { Inspector } from "./components/Inspector";
import { ReferencesPanel } from "./components/ReferencesPanel";
import { ChatPanel } from "./components/ChatPanel";
import { useEditorStore } from "./store/useEditorStore";

export function App() {
  const showReferences = useEditorStore((s) => s.showReferences);
  const showAi = useEditorStore((s) => s.showAi);
  return (
    <main className="app">
      <PlaybackBar />
      <div className="main">
        <LayerList />
        <Viewport />
        {showReferences && <ReferencesPanel />}
        {showAi && <ChatPanel />}
        <Inspector />
      </div>
      <Timeline />
    </main>
  );
}
