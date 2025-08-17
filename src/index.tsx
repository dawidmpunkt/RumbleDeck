import { ButtonItem, PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { MdOutlineVibration } from "react-icons/md";

// Backend calls
const backend_function = callable<[], void>("my_backend_function");
const init_DRV        = callable<[], void>("drv_startup");
const start_sniffer   = callable<[], void>("start_sniffer");
const stop_sniffer    = callable<[], void>("stop_sniffer");

function Content() {
  const call = async (fn: () => Promise<any>, okMsg: string) => {
    try {
      await fn();
      toaster.toast({ title: "RumbleDeck", body: okMsg });
    } catch (e: any) {
      toaster.toast({ title: "RumbleDeck", body: `Error: ${e?.message ?? e}`, duration: 5000 });
      console.error(e);
    }
  };

  return (
    <PanelSection title="Main Menu">
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => call(backend_function, "Test motors triggered")}>
          Test Motors
        </ButtonItem>
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => call(init_DRV, "Drivers initialized")}>
          Initialize Drivers
        </ButtonItem>
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => call(start_sniffer, "Sniffer started")}>
          Start Sniffer
        </ButtonItem>
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => call(stop_sniffer, "Sniffer stopped")}>
          Stop Sniffer
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => {
  console.log("RumbleDeck plugin initializing…");

  return {
    name: "RumbleDeck",
    titleView: <div className={staticClasses.Title}>RumbleDeck</div>,
    content: <Content />,
    icon: <MdOutlineVibration />,
    onDismount() {
      console.log("RumbleDeck unloading");
    },
  };
});
