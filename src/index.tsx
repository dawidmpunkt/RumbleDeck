import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  //Navigation,
  staticClasses
} from "@decky/ui";
import {
  //addEventListener,
  //removeEventListener,
  callable,
  definePlugin,
  toaster,
  // routerHook
} from "@decky/api"
import { useState } from "react";
import { MdOutlineVibration } from "react-icons/md";

type Status = {
  raw: number;
  device_id: number;
  device_name: string; // e.g. "DRV2605", or "Unknown(5)"
  diag_pass?: boolean;  // present on run_diagnostics
  fb_timeout: boolean;
  over_temp: boolean;
  over_current: boolean;
  standby: boolean;
  hi_z: boolean;
  mode: number;     // 0..7
  library: number;  // 0..7
};

const backend_function = callable<[], void>("my_backend_function");

const init_DRV = callable<[], void>("drv_startup");
const start_sniffer = callable<[], void>("start_sniffer");
const stop_sniffer = callable<[], void>("stop_sniffer");
const query_voltage = callable<[], number>("query_voltage");

const run_diagnostics = callable<[mux_mask?: number], Status>("run_diagnostics");

const read_status     = callable<[], Status>("read_status");
const MODE_NAMES = [
  "Internal Trigger",
  "External Trigger (Edge)",
  "External Trigger (Level)",
  "PWM / Analog",
  "Audio-to-Vibe",
  "Real-Time Playback",
  "Diagnostics",
  "Auto-Calibration",
];
const set_standby   = callable<[enabled: boolean], void>("set_standby");
const set_high_z    = callable<[enabled: boolean], void>("set_high_z");

//import logo from "../assets/logo.png";

// This function calls the python function "add", which takes in two numbers and returns their sum (as a number)
// Note the type annotations:
//  the first one: [first: number, second: number] is for the arguments
//  the second one: number is for the return value
//const add = callable<[first: number, second: number], number>("add");

// This function calls the python function "start_timer", which takes in no arguments and returns nothing.
// It starts a (python) timer which eventually emits the event 'timer_event'
//const startTimer = callable<[], void>("start_timer");

function StatusCard({ s }: { s: Status | null }) {
  if (!s) return null;
  const flags = [s.over_current && "OC", s.over_temp && "OT", s.fb_timeout && "FB_TO"]
	.filter(Boolean)
	.join(" ") || "none";
  const modeName = MODE_NAMES[s.mode] ?? `Mode ${s.mode}`;

  return (
    <div className="p-3 rounded-2xl shadow bg-[color:var(--DeckyBackground)]">
      <div className="font-semibold mb-1">{s.device_name} (ID={s.device_id})</div>
      {"diag_pass" in s && (
        <div>Diagnostics: {s.diag_pass ? "PASS ✅" : "FAIL ❌"}</div>
      )}
      <div>Mode: {modeName} {s.standby ? "[Standby]" : ""} {s.hi_z ? "[Hi-Z]" : ""}</div>
      <div>Library: {s.library}</div>
      <div>Flags: {flags}</div>
      <div>Raw STATUS: 0x{s.raw.toString(16).padStart(2, "0")}</div>
    </div>
  );
}

function toastStatus(title: string, s: Status) {
  const flags = [
    s.over_current ? "OC" : null,
    s.over_temp ? "OT" : null,
    s.fb_timeout ? "FB_TO" : null,
  ].filter(Boolean).join(", ") || "none";
  //const modeName = MODE_NAMES[s.mode] ?? `Mode ${s.mode}`;
  //const diagLine = s.diag_pass !== undefined ? `Diag: ${s.diag_pass ? "PASS" : "FAIL"}\n` : "";

  const body = `${s.device_name} ${s.diag_pass ? "PASS" : "FAIL"} • Mode ${MODE_NAMES[s.mode] ?? s.mode}` +
               ` • Flags:${flags || "none"} • raw 0x${s.raw.toString(16).padStart(2,"0")}`;
  toaster.toast({ title, body, duration: 6000 });
}

function Content() {
  const [status, setStatus] = useState<Status | null>(null);

  const call = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      toaster.toast({ title: "RumbleDeck", body: ok });
    } catch (e: any) {
      toaster.toast({ title: "RumbleDeck", body: `Error: ${e?.message ?? e}`, duration: 5000 });
      console.error(e);
    }
  };

  return (
    <>
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

        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={async () => {
              try {
                const v = await query_voltage();
                toaster.toast({ title: "RumbleDeck", body: `Supply Voltage: ${v.toFixed(2)} V` });
              } catch (e: any) {
                toaster.toast({ title: "RumbleDeck", body: `VSupply read failed: ${e?.message ?? e}`, duration: 5000 });
              }
            }}
          >
            Query Voltage
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Diagnostics & Safety">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={async () => {
              try {
                const s = await run_diagnostics(); // or run_diagnostics(0x01)
                setStatus(s);                      // <-- keep panel in sync
                toastStatus("DRV2605 Diagnostics", s);
              } catch (e: any) {
                toaster.toast({ title: "DRV2605 Diagnostics", body: `Failed: ${e?.message ?? e}`, duration: 6000 });
              }
            }}
          >
            Run Diagnostics
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => call(() => set_standby(true), "Standby enabled")}>
            Standby ON
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => call(() => set_standby(false), "Standby disabled")}>
            Standby OFF
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => call(() => set_high_z(true), "High-Z enabled")}>
            High-Z ENABLE
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => call(() => set_high_z(false), "High-Z disabled")}>
            High-Z DISABLE
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <StatusCard s={status} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={async () => {
              try {
                const s = await read_status();
                setStatus(s); // <-- keep panel in sync
                toaster.toast({ title: "DRV2605 Status", body: `${s.device_name} (ID=${s.device_id})`, duration: 3000 });
              } catch (e: any) {
                toaster.toast({ title: "DRV2605 Status", body: `Read failed: ${e?.message ?? e}`, duration: 6000 });
              }
            }}
          >
            Read Status
          </ButtonItem>
        </PanelSectionRow>


      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  console.log("Template plugin initializing, this is called once on frontend startup")

  // serverApi.routerHook.addRoute("/decky-plugin-test", DeckyPluginRouterTest, {
  //   exact: true,
  // });

  // Add an event listener to the "timer_event" event from the backend
  /*const listener = addEventListener<[
    test1: string,
    test2: number,
    test3: number
  ]>("my_backend_function", (test1, test2, test3) => {
    console.log("event:", test1, test2, test3)
    toaster.toast({
      title: "Driver initialized",
      body: `${test1}, ${test2}, ${test3}`
    });
  });*/

  return {
    // The name shown in various decky menus
    name: "RumbleDeck",
    // The element displayed at the top of your plugin's menu
    titleView: <div className={staticClasses.Title}>RumbleDeck</div>,
    // The content of your plugin's menu
    content: <Content />,
    // The icon displayed in the plugin list
    icon: <MdOutlineVibration />,
    // The function triggered when your plugin unloads
    onDismount() {
      console.log("Unloading")
    //  removeEventListener("my_backend_function", listener);
      //removeEventListener("drv_startup", listener);
      // serverApi.routerHook.removeRoute("/decky-plugin-test");
    },
  };
});