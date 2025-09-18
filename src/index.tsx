import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  SliderField,
  ToggleField,
  Navigation,
  staticClasses
} from "@decky/ui";
import {
  //addEventListener,
  //removeEventListener,
  callable,
  definePlugin,
  toaster,
  routerHook
} from "@decky/api"
import { useEffect, useState, lazy, Suspense } from "react";
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

// --- advanced pages
type AdvancedSection = "drive" | "timing" | "sequencer" | "presets";

// --- Sequencer types
type Step = { isWait: boolean; val: number }; // effect id (1..127) or wait ms (0..1270)

// ----- Library metadata & effect limits -----
type LibInfo = { id: number; name: string; note: string; effectMax: number };

const LIBRARIES: LibInfo[] = [
  { id: 0, name: "Empty",               note: "No ROM effects",                       effectMax: 0   },
  { id: 1, name: "ERM Library 1",       note: "Clicks / strong pulses",              effectMax: 127 },
  { id: 2, name: "ERM Library 2",       note: "Sharp / crisp",                       effectMax: 127 },
  { id: 3, name: "ERM Library 3",       note: "Soft / smooth",                       effectMax: 127 },
  { id: 4, name: "ERM Library 4",       note: "Double / ramp patterns",              effectMax: 127 },
  { id: 5, name: "ERM Library 5",       note: "Transitions / textures",              effectMax: 127 },
  { id: 6, name: "LRA",                 note: "LRA-tuned patterns",                   effectMax: 64  }, // adjust if needed
];

const EFFECT_NAMES: Record<number, string> = {
  1: "Strong Click - 100%",           2: "Strong Click - 60%",            3: "Strong Click - 30%",            4: "Sharp Click - 100%",
  5: "Sharp Click - 60%",             6: "Sharp Click - 30%",             7: "Soft Bump - 100%",              8: "Soft Bump - 60%",
  9: "Soft Bump - 30%",               10: "Double Click - 100%",          11: "Double Click - 60%",           12: "Triple Click - 100%",
  13: "Soft Fuzz - 60%",              14: "Strong Buzz - 100%",           15: "750 ms Alert 100%",            16: "1000 ms Alert 100%",
  17: "Strong Click 1 - 100%",        18: "Strong Click 2 - 80%",         19: "Strong Click 3 - 60%",         20: "Strong Click 4 - 30%",
  21: "Medium Click 1 - 100%",        22: "Medium Click 2 - 80%",         23: "Medium Click 3 - 60%",         24: "Sharp Tick 1 - 100%",
  25: "Sharp Tick 2 - 80%",           26: "Sharp Tick 3 - 60%",           27: "Short Double Click Strong 1 – 100%", 28: "Short Double Click Strong 2 – 80%",
  29: "Short Double Click Strong 3 – 60%", 30: "Short Double Click Strong 4 – 30%", 31: "Short Double Click Medium 1 – 100%", 32: "Short Double Click Medium 2 – 80%",
  33: "Short Double Click Medium 3 – 60%", 34: "Short Double Sharp Tick 1 – 100%", 35: "Short Double Sharp Tick 2 – 80%", 36: "Short Double Sharp Tick 3 – 60%",
  37: "Long Double Sharp Click Strong 1 – 100%", 38: "Long Double Sharp Click Strong 2 – 80%", 39: "Long Double Sharp Click Strong 3 – 60%", 40: "Long Double Sharp Click Strong 4 – 30%",
  41: "Long Double Sharp Click Medium 1 – 100%", 42: "Long Double Sharp Click Medium 2 – 80%", 43: "Long Double Sharp Click Medium 3 – 60%", 44: "Long Double Sharp Tick 1 – 100%",
  45: "Long Double Sharp Tick 2 – 80%", 46: "Long Double Sharp Tick 3 – 60%", 47: "Buzz 1 – 100%",               48: "Buzz 2 – 80%",
  49: "Buzz 3 – 60%",                 50: "Buzz 4 – 40%",                 51: "Buzz 5 – 20%",                 52: "Pulsing Strong 1 – 100%",
  53: "Pulsing Strong 2 – 60%",       54: "Pulsing Medium 1 – 100%",      55: "Pulsing Medium 2 – 60%",       56: "Pulsing Sharp 1 – 100%",
  57: "Pulsing Sharp 2 – 60%",        58: "Transition Click 1 – 100%",    59: "Transition Click 2 – 80%",     60: "Transition Click 3 – 60%",
  61: "Transition Click 4 – 40%",     62: "Transition Click 5 – 20%",     63: "Transition Click 6 – 10%",     64: "Transition Hum 1 – 100%",
  65: "Transition Hum 2 – 80%",       66: "Transition Hum 3 – 60%",       67: "Transition Hum 4 – 40%",       68: "Transition Hum 5 – 20%",
  69: "Transition Hum 6 – 10%",       70: "Transition Ramp Down Long Smooth 1 – 100 to 0%", 71: "Transition Ramp Down Long Smooth 2 – 100 to 0%", 72: "Transition Ramp Down Medium Smooth 1 – 100 to 0%",
  73: "Transition Ramp Down Medium Smooth 2 – 100 to 0%", 74: "Transition Ramp Down Short Smooth 1 – 100 to 0%", 75: "Transition Ramp Down Short Smooth 2 – 100 to 0%", 76: "Transition Ramp Down Long Sharp 1 – 100 to 0%",
  77: "Transition Ramp Down Long Sharp 2 – 100 to 0%", 78: "Transition Ramp Down Medium Sharp 1 – 100 to 0%", 79: "Transition Ramp Down Medium Sharp 2 – 100 to 0%", 80: "Transition Ramp Down Short Sharp 1 – 100 to 0%",
  81: "Transition Ramp Down Short Sharp 2 – 100 to 0%", 82: "Transition Ramp Up Long Smooth 1 – 0 to 100%", 83: "Transition Ramp Up Long Smooth 2 – 0 to 100%", 84: "Transition Ramp Up Medium Smooth 1 – 0 to 100%",
  85: "Transition Ramp Up Medium Smooth 2 – 0 to 100%", 86: "Transition Ramp Up Short Smooth 1 – 0 to 100%", 87: "Transition Ramp Up Short Smooth 2 – 0 to 100%", 88: "Transition Ramp Up Long Sharp 1 – 0 to 100%",
  89: "Transition Ramp Up Long Sharp 2 – 0 to 100%", 90: "Transition Ramp Up Medium Sharp 1 – 0 to 100%", 91: "Transition Ramp Up Medium Sharp 2 – 0 to 100%", 92: "Transition Ramp Up Short Sharp 1 – 0 to 100%",
  93: "Transition Ramp Up Short Sharp 2 – 0 to 100%", 94: "Transition Ramp Down Long Smooth 1 – 50 to 0%", 95: "Transition Ramp Down Long Smooth 2 – 50 to 0%", 96: "Transition Ramp Down Medium Smooth 1 – 50 to 0%",
  97: "Transition Ramp Down Medium Smooth 2 – 50 to 0%", 98: "Transition Ramp Down Short Smooth 1 – 50 to 0%", 99: "Transition Ramp Down Short Smooth 2 – 50 to 0%", 100: "Transition Ramp Down Long Sharp 1 – 50 to 0%",
  101: "Transition Ramp Down Long Sharp 2 – 50 to 0%", 102: "Transition Ramp Down Medium Sharp 1 – 50 to 0%", 103: "Transition Ramp Down Medium Sharp 2 – 50 to 0%", 104: "Transition Ramp Down Short Sharp 1 – 50 to 0%",
  105: "Transition Ramp Down Short Sharp 2 – 50 to 0%", 106: "Transition Ramp Up Long Smooth 1 – 0 to 50%", 107: "Transition Ramp Up Long Smooth 2 – 0 to 50%", 108: "Transition Ramp Up Medium Smooth 1 – 0 to 50%",
  109: "Transition Ramp Up Medium Smooth 2 – 0 to 50%", 110: "Transition Ramp Up Short Smooth 1 – 0 to 50%", 111: "Transition Ramp Up Short Smooth 2 – 0 to 50%", 112: "Transition Ramp Up Long Sharp 1 – 0 to 50%",
  113: "Transition Ramp Up Long Sharp 2 – 0 to 50%", 114: "Transition Ramp Up Medium Sharp 1 – 0 to 50%", 115: "Transition Ramp Up Medium Sharp 2 – 0 to 50%", 116: "Transition Ramp Up Short Sharp 1 – 0 to 50%",
  117: "Transition Ramp Up Short Sharp 2 – 0 to 50%", 118: "Long buzz for programmatic stopping – 100%", 119: "Smooth Hum 1 (No kick or brake pulse) – 50%", 120: "Smooth Hum 2 (No kick or brake pulse) – 40%",
  121: "Smooth Hum 3 (No kick or brake pulse) – 30%", 122: "Smooth Hum 4 (No kick or brake pulse) – 20%", 123: "Smooth Hum 5 (No kick or brake pulse) – 10%",
};

const EFFECT_ID_MAX = 123;

const MAX_LIBRARY_ID = Math.max(...LIBRARIES.map(l => l.id));
const libById = (id: number) => LIBRARIES.find(l => l.id === id) ?? LIBRARIES[0];

// --- callable for device reset
const reset_device = callable<[], void>("reset_device");

// --- callables for setting actuator parameters: rated voltage and overdrive clamp
const get_drive_params = callable<[], { rated: number; overdrive: number }>("get_drive_params");
const set_drive_params = callable<[rated: number, overdrive: number], void>("set_drive_params");

// --- Flags getter for toggle buttons
const get_runtime_flags = callable<[], { standby: boolean; hi_z: boolean; sniffer: boolean; use_mux: boolean; autostart_sniffer?: boolean; }>("get_runtime_flags");

// --- callables for timing offsets
const get_timing_offsets = callable<[], { overdrive: number; sustain_pos: number; sustain_neg: number; brake: number }>("get_timing_offsets");
const set_timing_offsets = callable<[overdrive: number, sustain_pos: number, sustain_neg: number, brake: number], void>("set_timing_offsets");

// --- callables for library function
const set_library      = callable<[lib_id: number], void>("set_library");
const program_sequence = callable<[steps: number[]], void>("program_sequence");
const play_sequence    = callable<[], void>("play_sequence");
const stop_sequence    = callable<[], void>("stop_sequence");

// --- callables for preset manager
const list_presets      = callable<[], string[]>("list_presets");
const save_preset       = callable<[name: string, lib_id: number, steps: number[]], void>("save_preset");
const load_preset_call  = callable<[name: string], { lib: number; steps: number[] }>("load_preset");
const delete_preset     = callable<[name: string], void>("delete_preset");
const apply_preset      = callable<[name: string], void>("apply_preset");

// --- callables for I2C-multiplexer configuration

const get_config   = callable<[], { use_mux: boolean; mux_mask: number }>("get_config");
const set_use_mux  = callable<[enabled: boolean], void>("set_use_mux");
const set_mux_mask = callable<[mask: number], void>("set_mux_mask");

// --- other callables
const backend_function = callable<[], void>("my_backend_function");

const init_DRV = callable<[], void>("drv_startup");
const start_sniffer = callable<[], void>("start_sniffer");
const stop_sniffer = callable<[], void>("stop_sniffer");
const set_sniffer_autostart = callable<[enabled: boolean], void>("set_sniffer_autostart");
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

// --- callables for advanced and lazy subpages
const BASE = "/rumbledeck";
let routesAdded = false;


const TimingPage = lazy(async () => ({
  default: () => (
    <PanelSection title="Timing Offsets">
      <PanelSectionRow><TimingOffsets /></PanelSectionRow>
    </PanelSection>
  ),
}));

const DrivePage = lazy(async () => ({
  default: () => (
    <PanelSection title="Drive Parameters">
      <PanelSectionRow><DriveParams /></PanelSectionRow>
    </PanelSection>
  ),
}));

const SequencerPage = lazy(async () => ({
  default: () => (
    <PanelSection title="Sequencer">
      <PanelSectionRow><SequencerEditor /></PanelSectionRow>
    </PanelSection>
  ),
}));

// simple suspense wrapper
function S({ children }: { children: JSX.Element }) {
  return <Suspense fallback={<div className={staticClasses.Text}>Loading…</div>}>{children}</Suspense>;
}

//import logo from "../assets/logo.png";

// This function calls the python function "add", which takes in two numbers and returns their sum (as a number)
// Note the type annotations:
//  the first one: [first: number, second: number] is for the arguments
//  the second one: number is for the return value
//const add = callable<[first: number, second: number], number>("add");

// This function calls the python function "start_timer", which takes in no arguments and returns nothing.
// It starts a (python) timer which eventually emits the event 'timer_event'
//const startTimer = callable<[], void>("start_timer");


// --- I2C-multiplexer function helpers

function MuxControls() {
  const [useMux, setUseMuxState] = useState<boolean>(false);
  const [mask, setMask] = useState<number>(1); // 1=A, 2=B, 3=Both

  const channelLabel = mask === 1 ? "A" : mask === 2 ? "B" : "Both";

  const refresh = async () => {
    try {
      const cfg = await get_config();              // persisted + runtime
      setUseMuxState(!!cfg.use_mux);
      setMask(cfg.mux_mask || 1);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const toggleMux = async (val: boolean) => {
    try {
      await set_use_mux(val);                      // persists in backend
      await refresh();                             // reflect runtime flag + persisted value
      toaster.toast({ title: "RumbleDeck", body: `Use MUX: ${val ? "On" : "Off"}` });
    } catch (e) {
      console.error(e);
      toaster.toast({ title: "RumbleDeck", body: "Failed to toggle MUX", duration: 5000 });
    }
  };

  const setChannel = async (m: number) => {
    try {
      await set_mux_mask(m);                       // persists in backend
      await refresh();                             // sync runtime & UI
      toaster.toast({ title: "RumbleDeck", body: `Channel set to ${m === 1 ? "A" : m === 2 ? "B" : "Both"}` });
    } catch (e) {
      console.error(e);
      toaster.toast({ title: "RumbleDeck", body: "Failed to set channel", duration: 5000 });
    }
  };

  return (
    <div className="space-y-2">
      <ToggleField
        label={`Use MUX: ${useMux ? "On" : "Off"}`}
        checked={useMux}
        onChange={toggleMux}
      />
      {useMux && (
        <>
          <div className={staticClasses.Text}>{`Channel: ${channelLabel}`}</div>
          <div className="flex gap-2">
            <ButtonItem onClick={() => setChannel(1)} description={mask === 1 ? "Selected" : undefined}>
              Channel A
            </ButtonItem>
            <ButtonItem onClick={() => setChannel(2)} description={mask === 2 ? "Selected" : undefined}>
              Channel B
            </ButtonItem>
            <ButtonItem onClick={() => setChannel(3)} description={mask === 3 ? "Selected" : undefined}>
              Both
            </ButtonItem>
          </div>
        </>
      )}
    </div>
  );
}

// --- Helper for library function
function encodeSteps(steps: Step[]): number[] {
  // map UI steps -> DRV2605 bytes (effect 0x01..0x7F, wait 0x80..0xFF)
  const out: number[] = [];
  for (const s of steps.slice(0, 8)) {
    if (s.isWait) {
      const ms = Math.max(0, Math.min(1270, Math.trunc(s.val)));
      const ticks = Math.min(127, Math.floor(ms / 10));
      out.push(0x80 | ticks);
    } else {
      const id = Math.max(1, Math.min(127, Math.trunc(s.val)));
      out.push(id);
    }
  }
  // backend will append terminator 0x00 if needed
  return out;
}

// ----- Sequencer (sliders + presets) -----
function SequencerEditor() {
  const [libId, setLibId] = useState<number>(2); // default to Library 2: ERM
  const [steps, setSteps] = useState<Step[]>([
    { isWait: false, val: 1 },
    { isWait: true,  val: 100 },
    { isWait: false, val: 2 },
  ]);

  const [presets, setPresets] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const currentLib = libById(libId);
  const effectMax  = currentLib.effectMax > 0 ? currentLib.effectMax : 1;

  const refreshPresets = async () => {
    try {
      const names = await list_presets();
      setPresets(names);
      if (names.length && !selectedPreset) setSelectedPreset(names[0]);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { refreshPresets(); }, []);

  const updateStep = (i: number, patch: Partial<Step>) =>
    setSteps(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const addStep = () =>
    setSteps(prev => (prev.length < 8 ? [...prev, { isWait: false, val: 1 }] : prev));

  const removeStep = (i: number) =>
    setSteps(prev => prev.filter((_, idx) => idx !== i));

  const applyAndPlay = async () => {
    try {
      await set_library(libId);
      await program_sequence(encodeSteps(steps));
      await play_sequence();
      toaster.toast({ title: "RumbleDeck", body: "Playing sequence" });
    } catch (e: any) {
      toaster.toast({ title: "RumbleDeck", body: `Error: ${e?.message ?? e}`, duration: 5000 });
    }
  };

  const stop = async () => {
    try { await stop_sequence(); toaster.toast({ title: "RumbleDeck", body: "Stopped" }); }
    catch (e: any) { toaster.toast({ title: "RumbleDeck", body: `Stop failed: ${e?.message ?? e}`, duration: 5000 }); }
  };

  const doQuickSave = async () => {
    try {
      const name = `preset-${Date.now().toString().slice(-6)}`;
      await save_preset(name, libId, encodeSteps(steps));
      await refreshPresets();
      setSelectedPreset(name);
      toaster.toast({ title: "RumbleDeck", body: `Saved ${name}` });
    } catch (e: any) {
      toaster.toast({ title: "RumbleDeck", body: `Save failed: ${e?.message ?? e}`, duration: 5000 });
    }
  };

  const doLoad = async () => {
    if (!selectedPreset) return;
    try {
      const p = await load_preset_call(selectedPreset);
      const newLib = Math.min(MAX_LIBRARY_ID, Math.max(0, p.lib ?? 0));
      setLibId(newLib);
      const uiSteps: Step[] = (p.steps || []).slice(0, 8).map((b) => {
        if (b & 0x80) { const ticks = b & 0x7F; return { isWait: true,  val: ticks * 10 }; }
        return { isWait: false, val: Math.max(1, Math.min(127, b)) };
      });
      setSteps(uiSteps.length ? uiSteps : [{ isWait: false, val: 1 }]);
      toaster.toast({ title: "RumbleDeck", body: `Loaded ${selectedPreset}` });
    } catch (e: any) {
      toaster.toast({ title: "RumbleDeck", body: `Load failed: ${e?.message ?? e}`, duration: 5000 });
    }
  };

  const doApplyPreset = async () => {
    if (!selectedPreset) return;
    try { await apply_preset(selectedPreset); toaster.toast({ title: "RumbleDeck", body: `Playing ${selectedPreset}` }); }
    catch (e: any) { toaster.toast({ title: "RumbleDeck", body: `Apply failed: ${e?.message ?? e}`, duration: 5000 }); }
  };

  const doDelete = async () => {
    if (!selectedPreset) return;
    try { await delete_preset(selectedPreset); await refreshPresets(); setSelectedPreset(null); toaster.toast({ title: "RumbleDeck", body: "Preset deleted" }); }
    catch (e: any) { toaster.toast({ title: "RumbleDeck", body: `Delete failed: ${e?.message ?? e}`, duration: 5000 }); }
  };

  return (
    <div className="p-2 space-y-2">
      {/* Library slider with value in label & explanation text */}
      <SliderField
        label={`Library ${currentLib.id}: ${currentLib.name}`}
        value={libId}
        min={0}
        max={MAX_LIBRARY_ID}
        step={1}
        onChange={(v: number) => setLibId(v)}
      />
      <div className={staticClasses.Text} style={{ opacity: 0.7, marginTop: -4 }}>
        {`Library ${currentLib.id}: ${currentLib.note}`}
      </div>

      {/* Steps editor (each row: toggle + one slider) */}
      <div className={staticClasses.Text} style={{ marginTop: 8 }}>Sequence (max 8 steps)</div>
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-4">
          <ToggleField
            label={s.isWait ? "Wait" : "Effect"}
            checked={s.isWait}
            onChange={(val: boolean) => updateStep(i, { isWait: val })}
          />
          {s.isWait ? (
            <SliderField
              label={`Wait ${s.val} ms`}
              value={s.val}
              min={0}
              max={1270}
              step={10}
              onChange={(v: number) => updateStep(i, { val: v })}
            />
          ) : (
            <SliderField
			  label={`Effect ${s.val}${EFFECT_NAMES[s.val] ? " – " + EFFECT_NAMES[s.val] : ""}`}
			  value={s.val}
			  min={1}
			  max={Math.min(Math.max(1, effectMax), EFFECT_ID_MAX)} // respect library & 123 cap
			  step={1}
			  onChange={(v: number) => updateStep(i, { val: v })}
			/>
          )}
          <ButtonItem onClick={() => removeStep(i)}>Remove</ButtonItem>
        </div>
      ))}

      <div className="flex gap-4 mt-2">
        <ButtonItem onClick={addStep} disabled={steps.length >= 8}>Add Step</ButtonItem>
        <ButtonItem onClick={applyAndPlay}>Apply & Play</ButtonItem>
        <ButtonItem onClick={stop}>Stop</ButtonItem>
      </div>

      {/* Presets */}
      <div className={staticClasses.Text} style={{ marginTop: 12 }}>Presets</div>
      <PanelSectionRow>
        <div className="flex flex-col gap-2 w-full">
          <div className="flex gap-2 flex-wrap">
            {presets.length === 0 ? (
              <div className={staticClasses.Text}>No presets yet</div>
            ) : (
              presets.map((name) => (
                <ButtonItem
                  key={name}
                  onClick={() => setSelectedPreset(name)}
                  description={selectedPreset === name ? "Selected" : undefined}
                >
                  {name}
                </ButtonItem>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <ButtonItem onClick={doQuickSave}>Save Current as Preset</ButtonItem>
            <ButtonItem onClick={doLoad} disabled={!selectedPreset}>Load to Editor</ButtonItem>
            <ButtonItem onClick={doApplyPreset} disabled={!selectedPreset}>Apply & Play</ButtonItem>
            <ButtonItem onClick={doDelete} disabled={!selectedPreset}>Delete</ButtonItem>
          </div>
        </div>
      </PanelSectionRow>
    </div>
  );
}

// --- function for timing offsets

function TimingOffsets() {
  const [ovr, setOvr] = useState(0);
  const [susP, setSusP] = useState(0);
  const [susN, setSusN] = useState(0);
  const [brk, setBrk] = useState(0);

  const clamp = (v: number) => Math.max(0, Math.min(255, Math.trunc(v)));

  const readFromDevice = async () => {
    try {
      const r = await get_timing_offsets();
      setOvr(clamp(r.overdrive));
      setSusP(clamp(r.sustain_pos));
      setSusN(clamp(r.sustain_neg));
      setBrk(clamp(r.brake));
      toaster.toast({ title: "RumbleDeck", body: "Offsets read" });
    } catch (e: any) {
      toaster.toast({ title: "RumbleDeck", body: `Read failed: ${e?.message ?? e}`, duration: 5000 });
    }
  };

  const applyToDevice = async () => {
    try {
      await set_timing_offsets(clamp(ovr), clamp(susP), clamp(susN), clamp(brk));
      toaster.toast({ title: "RumbleDeck", body: "Offsets applied" });
    } catch (e: any) {
      toaster.toast({ title: "RumbleDeck", body: `Apply failed: ${e?.message ?? e}`, duration: 5000 });
    }
  };

  useEffect(() => { readFromDevice(); }, []);

  return (
    <div className="p-2 space-y-2">
      <div className={staticClasses.Text}>Timing Offsets (0x0D–0x10)</div>

      <SliderField
        label={`Overdrive Offset ${ovr}`}
        value={ovr}
        min={0}
        max={255}
        step={1}
        onChange={(v: number) => setOvr(v)}
      />
      <div className={staticClasses.Text} style={{ opacity: 0.7, marginTop: -6 }}>
        Shortens/extends overdrive duration for snappier starts.
      </div>

      <SliderField
        label={`Sustain + Offset ${susP}`}
        value={susP}
        min={0}
        max={255}
        step={1}
        onChange={(v: number) => setSusP(v)}
      />
      <div className={staticClasses.Text} style={{ opacity: 0.7, marginTop: -6 }}>
        Extends positive sustain (longer hold on positive cycles).
      </div>

      <SliderField
        label={`Sustain − Offset ${susN}`}
        value={susN}
        min={0}
        max={255}
        step={1}
        onChange={(v: number) => setSusN(v)}
      />
      <div className={staticClasses.Text} style={{ opacity: 0.7, marginTop: -6 }}>
        Extends negative sustain (longer hold on negative cycles).
      </div>

      <SliderField
        label={`Brake Offset ${brk}`}
        value={brk}
        min={0}
        max={255}
        step={1}
        onChange={(v: number) => setBrk(v)}
      />
      <div className={staticClasses.Text} style={{ opacity: 0.7, marginTop: -6 }}>
        Increases/decreases braking phase for a tighter stop.
      </div>

      <div className="flex gap-2 mt-2">
        <ButtonItem onClick={readFromDevice}>Read From Device</ButtonItem>
        <ButtonItem onClick={applyToDevice}>Apply Offsets</ButtonItem>
      </div>
    </div>
  );
}

// --- function to set actuator parameters: rated voltage and overdrive clamp
function DriveParams() {
  const [rated, setRated] = useState(0);
  const [over, setOver] = useState(0);

  const clamp = (v: number) => Math.max(0, Math.min(255, Math.trunc(v)));

  const readFromDevice = async () => {
    try {
      const r = await get_drive_params();
      setRated(clamp(r.rated));
      setOver(clamp(r.overdrive));
      toaster.toast({ title: "RumbleDeck", body: "Drive params read" });
    } catch (e: any) {
      toaster.toast({ title: "RumbleDeck", body: `Read failed: ${e?.message ?? e}`, duration: 5000 });
    }
  };

  const applyToDevice = async () => {
    try {
      await set_drive_params(clamp(rated), clamp(over));
      toaster.toast({ title: "RumbleDeck", body: "Drive params applied" });
    } catch (e: any) {
      toaster.toast({ title: "RumbleDeck", body: `Apply failed: ${e?.message ?? e}`, duration: 5000 });
    }
  };

  useEffect(() => { readFromDevice(); }, []);

  return (
    <div className="p-2 space-y-2">
      <div className={staticClasses.Text}>Drive Parameters (0x16–0x17)</div>

      <SliderField
        label={`Rated Voltage (0x16): ${rated}`}
        value={rated}
        min={0}
        max={255}
        step={1}
        onChange={(v: number) => setRated(v)}
      />
      <div className={staticClasses.Text} style={{ opacity: 0.7, marginTop: -6 }}>
        Sets the nominal drive level used by the device.
      </div>

      <SliderField
        label={`Overdrive Clamp (0x17): ${over}`}
        value={over}
        min={0}
        max={255}
        step={1}
        onChange={(v: number) => setOver(v)}
      />
      <div className={staticClasses.Text} style={{ opacity: 0.7, marginTop: -6 }}>
        Limits peak overdrive strength for snappier starts without overshoot.
      </div>

      <div className="flex gap-2 mt-2">
        <ButtonItem onClick={readFromDevice}>Read From Device</ButtonItem>
        <ButtonItem onClick={applyToDevice}>Apply</ButtonItem>
      </div>
    </div>
  );
}

function AdvancedShell() {
  const [section, setSection] = useState<AdvancedSection>("drive");

  const Item: React.FC<{ id: AdvancedSection; title: string; desc?: string }> = ({ id, title, desc }) => (
    <ButtonItem
      onClick={() => setSection(id)}
      description={section === id ? "Selected" : desc}
    >
      {title}
    </ButtonItem>
  );

  return (
    <div
      style={{
        // Force a two-column canvas that ignores parent PanelSection stacking
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        padding: 12,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Sidebar (fixed width) */}
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div className={staticClasses.Title}>Advanced</div>
        <Item id="drive"     title="Drive Params"   desc="Rated Voltage / Overdrive Clamp" />
        <Item id="timing"    title="Timing Offsets" desc="Overdrive / Sustain / Brake" />
        <Item id="sequencer" title="Sequencer"      desc="Waveform + Wait editor" />
        <Item id="presets"   title="Presets"        desc="Save / Load / Apply" />
      </div>

      {/* Content (fills remaining space) */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {section === "drive" && (
          <PanelSection title="Drive Parameters">
            <PanelSectionRow><DriveParams /></PanelSectionRow>
          </PanelSection>
        )}
        {section === "timing" && (
          <PanelSection title="Timing Offsets">
            <PanelSectionRow><TimingOffsets /></PanelSectionRow>
          </PanelSection>
        )}
        {section === "sequencer" && (
          <PanelSection title="Sequencer">
            <PanelSectionRow><SequencerEditor /></PanelSectionRow>
          </PanelSection>
        )}
        {section === "presets" && (
          <PanelSection title="Presets">
            <PanelSectionRow>
              <div className={staticClasses.Text}>
                Use the Sequencer page to edit; manage here if you split it later.
              </div>
            </PanelSectionRow>
          </PanelSection>
        )}
      </div>
    </div>
  );
}

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

  // -- defaults for toggle buttons
  const [standby, setStandby] = useState(false);
  const [hiZ, setHiZ] = useState(false);
  const [sniffer, setSniffer] = useState(false);

  // --- Button states on Autostart
  const [autoStart, setAutoStart] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const f = await get_runtime_flags();
        setStandby(!!f.standby);
        setHiZ(!!f.hi_z);
        setSniffer(!!f.sniffer);
		setAutoStart(!!f.autostart_sniffer);
        // Use MUX is handled in MuxControls via get_config()
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

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
		</PanelSection> {/* <-- close Main Menu (was missing) */}

		<PanelSection title="Haptics">
		  <PanelSectionRow>
			<MuxControls />
		  </PanelSectionRow>
		  <PanelSectionRow>
			<TimingOffsets />
		  </PanelSectionRow>
		  <PanelSectionRow>
			<SequencerEditor />
		  </PanelSectionRow>
		  <PanelSectionRow>
			<DriveParams />
		  </PanelSectionRow>
		</PanelSection>

		  <PanelSection title="Diagnostics & Safety">
			<PanelSectionRow>
			  <StatusCard s={status} />
			</PanelSectionRow>
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
			  <ToggleField
				label={`Standby: ${standby ? "On" : "Off"}`}
				checked={standby}
				onChange={async (val: boolean) => {
				  try { await set_standby(val); setStandby(val); }
				  catch (e: any) { toaster.toast({ title: "RumbleDeck", body: `Standby failed: ${e?.message ?? e}`, duration: 5000 }); }
				}}
			  />
			</PanelSectionRow>

			<PanelSectionRow>
			  <ToggleField
				label={`High-Z: ${hiZ ? "On" : "Off"}`}
				checked={hiZ}
				onChange={async (val: boolean) => {
				  try { await set_high_z(val); setHiZ(val); }
				  catch (e: any) { toaster.toast({ title: "RumbleDeck", body: `High-Z failed: ${e?.message ?? e}`, duration: 5000 }); }
				}}
			  />
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
			<PanelSectionRow>
			  <ButtonItem
				layout="below"
				onClick={async () => {
				  try {
					await reset_device();
					toaster.toast({ title: "RumbleDeck", body: "Device reset completed" });
				  } catch (e: any) {
					// make sure we always show *something* useful
					const msg = e?.message ?? String(e) ?? "Unknown error";
					toaster.toast({ title: "RumbleDeck", body: `Reset failed: ${msg}`, duration: 6000 });
					console.error(e);
				  }
				}}
			  >
				Reset DRV2605
			  </ButtonItem>
			</PanelSectionRow>
			<PanelSectionRow>
			  <ButtonItem layout="below" onClick={() => Navigation.Navigate("/rumbledeck/advanced")}>
				Open Advanced Page
			  </ButtonItem>
			</PanelSectionRow>
		  </PanelSection>

		{/* These rows must live inside a PanelSection – wrap them */}
		<PanelSection title="Sniffer & Utilities">
		  <PanelSectionRow>
			<ToggleField
			  label={`Autostart Sniffer: ${autoStart ? "On" : "Off"}`}
			  checked={autoStart}
			  onChange={async (val: boolean) => {
				try { await set_sniffer_autostart(val); setAutoStart(val); }
				catch (e: any) { toaster.toast({ title: "RumbleDeck", body: `Autostart failed: ${e?.message ?? e}`, duration: 5000 }); }
			  }}
			/>
		    <ToggleField
			  label={`Sniffer: ${sniffer ? "On" : "Off"}`}
			  checked={sniffer}
			  onChange={async (val: boolean) => {
				try { if (val) await start_sniffer(); else await stop_sniffer(); setSniffer(val); }
				catch (e: any) { toaster.toast({ title: "RumbleDeck", body: `Sniffer toggle failed: ${e?.message ?? e}`, duration: 5000 }); }
			  }}
		    />
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

		<PanelSection title="Advanced">
		  <PanelSectionRow>
			<ButtonItem onClick={() => Navigation.Navigate(`${BASE}/advanced`)}>
				Open new Advanced
			</ButtonItem>
		  </PanelSectionRow>
		</PanelSection>
	  </>
	);
}

export default definePlugin(() => {
  console.log("Template plugin initializing, this is called once on frontend startup")
  // register a subpage route
  if (!routesAdded) {
	routerHook.addRoute(
	  `${BASE}/advanced`,
	  () => <AdvancedShell />,   // <- render the shell directly
	  { exact: true }
	);
	
	routerHook.addRoute(
	  `${BASE}/drive`,
	  () => (
		<Suspense fallback={<div className={staticClasses.Text}>Loading…</div>}>
		  <DrivePage />
		</Suspense>
	  ),
	  { exact: true }
	);

	routerHook.addRoute(
	  `${BASE}/timing`,
	  () => (
		<Suspense fallback={<div className={staticClasses.Text}>Loading…</div>}>
		  <TimingPage />
		</Suspense>
	  ),
	  { exact: true }
	);

	routerHook.addRoute(
	  `${BASE}/sequencer`,
	  () => (
		<Suspense fallback={<div className={staticClasses.Text}>Loading…</div>}>
		  <SequencerPage />
		</Suspense>
	  ),
	  { exact: true }
	);
    routesAdded = true;
  }
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
      if (routesAdded) {
        routerHook.removeRoute(`${BASE}/advanced`);
        routerHook.removeRoute(`${BASE}/drive`);
        routerHook.removeRoute(`${BASE}/timing`);
        routerHook.removeRoute(`${BASE}/sequencer`);
        routesAdded = false;
      }
	}
  };
});