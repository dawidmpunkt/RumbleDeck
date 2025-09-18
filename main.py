# main.py — RumbleDeck backend (no smbus required)

import os
import fcntl
import ctypes
import asyncio
import subprocess
import json
from pathlib import Path

from decky import logger  # Decky-provided logger

# ---------- Config ----------
# Path to file to store user defined settings
SETTINGS_FILE = Path(os.path.expanduser("~")) / "homebrew" / "settings" / "RumbleDeck.json"

# Select I²C bus via env var (default 0 is typical on Steam Deck)
I2C_BUS = int(os.getenv("RUMBLEDECK_I2C_BUS", "0"))

# Select in plugin, if I2C-multiplexer is present (different RumbleBoard versions). Default = off
USE_MUX  = os.getenv("RUMBLEDECK_USE_MUX", "0") == "1"

# Device addresses
DRV_ADDR = int(os.getenv("RUMBLEDECK_DRV_ADDR", "0x5A"), 0)  # DRV2605
MUX_ADDR = int(os.getenv("RUMBLEDECK_MUX_ADDR", "0x70"), 0)  # e.g., TCA9548A / similar

# Paths
ROOT = Path(__file__).resolve().parent
SNIFFER = ROOT / "backend" / "out" / "rumble-sniffer"

# ioctl constants
I2C_SLAVE = 0x0703
I2C_RDWR  = 0x0707
I2C_M_RD  = 0x0001

# Device names
_DEVICE_NAMES = {3: "DRV2605", 4: "DRV2604", 6: "DRV2604L", 7: "DRV2605L"}

# --- DRV2605 regs we use ---
REG_STATUS = 0x00  # OC_DETECT(0), OVER_TEMP(1), FB_STS(2), DIAG_RESULT(3), DEVICE_ID[7:5]
REG_MODE   = 0x01  # STANDBY(6), MODE[2:0]
REG_RTP    = 0x02
REG_LIBSEL = 0x03  # HI_Z(4)
REG_GO     = 0x0C  # GO(0)

# ---------- Low-level I²C helpers (no smbus) ----------
class I2CMsg(ctypes.Structure):
    _fields_ = [
        ("addr",  ctypes.c_uint16),
        ("flags", ctypes.c_uint16),
        ("len",   ctypes.c_uint16),
        ("buf",   ctypes.c_uint64),
    ]

class I2CRdwrIoctlData(ctypes.Structure):
    _fields_ = [
        ("msgs",  ctypes.c_uint64),   # pointer to I2CMsg array
        ("nmsgs", ctypes.c_uint32),
    ]

def i2c_rdwr_xfer(fd, msgs):
    array_type = I2CMsg * len(msgs)
    arr = array_type(*msgs)
    data = I2CRdwrIoctlData(ctypes.addressof(arr), len(msgs))
    fcntl.ioctl(fd, I2C_RDWR, data)

# Function to select if I2C-multiplexer is present (different RumbleBoard versions). Default = off

def mux_select(mask: int):
    if USE_MUX:
        i2c_write(MUX_ADDR, 0x00, mask & 0xFF)

class RawI2C:
    """
    Minimal /dev/i2c-* writer. Opens on enter, closes on exit.
    Supports "register + bytes" write (what this plugin needs).
    """
    def __init__(self, bus: int):
        self.bus = bus
        self.fd = None

    def __enter__(self):
        self.fd = os.open(f"/dev/i2c-{self.bus}", os.O_RDWR)
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if self.fd is not None:
                os.close(self.fd)
        finally:
            self.fd = None

    def _set_addr(self, addr: int):
        if self.fd is None:
            raise RuntimeError("I2C device not opened")
        fcntl.ioctl(self.fd, I2C_SLAVE, addr)

    def write_reg(self, addr: int, reg: int, data):
        """
        Write: [reg][data...]
        data can be int or bytes/bytearray/list-of-ints.
        """
        if isinstance(data, int):
            payload = bytes([reg, data & 0xFF])
        elif isinstance(data, (bytes, bytearray)):
            payload = bytes([reg]) + bytes(data)
        elif isinstance(data, list):
            payload = bytes([reg]) + bytes([x & 0xFF for x in data])
        else:
            raise TypeError(f"Unsupported data type for I2C write: {type(data)}")

        self._set_addr(addr)
        os.write(self.fd, payload)

def i2c_write(addr: int, reg: int, data):
    """Open → write → close with robust logging."""
    try:
        with RawI2C(I2C_BUS) as i2c:
            i2c.write_reg(addr, reg, data)
    except FileNotFoundError as e:
        logger.error(f"I2C bus /dev/i2c-{I2C_BUS} not found: {e}")
        raise
    except PermissionError as e:
        logger.error(f"I2C permission error on /dev/i2c-{I2C_BUS}: {e} (add user to 'i2c' group)")
        raise
    except Exception as e:
        logger.error(
            f"I2C write failed (bus={I2C_BUS}, addr=0x{addr:02X}, reg=0x{reg:02X}, data={data}): {e}"
        )
        raise

def i2c_read_reg(addr: int, reg: int, n: int = 1) -> bytes:
    """Correct I2C read: [START][addr W][reg][REPEATED START][addr R][n bytes]"""
    with RawI2C(I2C_BUS) as i2c:
        # prepare buffers
        wbuf = (ctypes.c_ubyte * 1)(reg & 0xFF)
        rbuf = (ctypes.c_ubyte * n)()
        msgs = [
            I2CMsg(addr=addr, flags=0,        len=1, buf=ctypes.addressof(wbuf)),
            I2CMsg(addr=addr, flags=I2C_M_RD, len=n, buf=ctypes.addressof(rbuf)),
        ]
        i2c_rdwr_xfer(i2c.fd, msgs)
        return bytes(rbuf)

def _encode_wait_ms(ms: int) -> int:
    """
    DRV2605 wait command: set bit7=1, lower 7 bits = (time / 10ms).
    Clamps to 0..1270ms (0..127 * 10ms).
    """
    ticks = max(0, min(127, ms // 10))
    return 0x80 | ticks  # 0x80..0xFF

def _decode_status(s: int) -> dict: # diagnostic status read helper
    return {
        "raw": s,
        "device_id": (s >> 5) & 0x7,        # 3=DRV2605, 7=DRV2605L
        "diag_fail": bool(s & (1 << 3)),    # 0=pass, 1=fail
        "fb_timeout": bool(s & (1 << 2)),
        "over_temp": bool(s & (1 << 1)),
        "over_current": bool(s & (1 << 0)),
    }

def _snapshot_status() -> dict: # make diagnostic status more verbose
    s  = _decode_status(_read_u8(DRV_ADDR, REG_STATUS))  # NOTE: clears latched bits
    md = _read_u8(DRV_ADDR, REG_MODE)
    lb = _read_u8(DRV_ADDR, REG_LIBSEL)
    name = _DEVICE_NAMES.get(s["device_id"], f"Unknown({s['device_id']})")
    s.update({"device_name": name})
    return s

def _read_u8(addr: int, reg: int) -> int:
    return i2c_read_reg(addr, reg, 1)[0]

def _rmw_u8(addr: int, reg: int, clear_mask: int, set_mask: int):
    v = _read_u8(addr, reg)
    v = (v & ~clear_mask) | set_mask
    i2c_write(addr, reg, v)
    return v

# --- functions for the user preset manager ----

def _load_settings() -> dict:
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    # defaults
    data.setdefault("presets", {})
    data.setdefault("use_mux", False)
    data.setdefault("mux_mask", 1)  # 1=A, 2=B, 3=Both
    data.setdefault("persist_standby", False)
    data.setdefault("persist_hi_z", False)
    data.setdefault("autostart_sniffer", False)
    data.setdefault("last_lib", None)           # int or None
    data.setdefault("last_offsets", None)       # {"overdrive":..,"sustain_pos":..,"sustain_neg":..,"brake":..} or None
    return data

def _save_settings(data: dict) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

# ---------- Device-specific actions ----------
async def drv_test():
    """Simple test: trigger rumble 3× (non-blocking)."""
    for _ in range(3):
        i2c_write(DRV_ADDR, 0x0C, 0x01)  # GO = 1
        await asyncio.sleep(0.2)

def _vbat_to_volts(raw: int) -> float: # Helper to convert VBAT into volts
    # Per DRV2605 docs: 5.6 V full-scale
    return (raw & 0xFF) * 5.6 / 255.0

def drv_init():
    """Initialize DRV2605 with your register sequence."""
    i2c_write(DRV_ADDR, 22, 126)
    i2c_write(DRV_ADDR, 23, 150)
    i2c_write(DRV_ADDR, 26, 54)
    i2c_write(DRV_ADDR, 27, 147)
    i2c_write(DRV_ADDR, 28, 245)
    i2c_write(DRV_ADDR, 29, 168)
    i2c_write(DRV_ADDR, 3,  1)
    i2c_write(DRV_ADDR, 1,  0)

# ---------- Decky plugin ----------
class Plugin:
    def __init__(self, *args, **kwargs):
        self.sniffer_process = None
        self._sniffer_reader = None
        self._i2c_lock = asyncio.Lock()
        # mux state (loaded in _main)
        self.use_mux = False
        self.mux_mask = 1

    # helper: select current mux channel if enabled
    def _mux_select_current(self):
        if self.use_mux:
            i2c_write(MUX_ADDR, 0x00, self.mux_mask & 0xFF)

    # ---------- MUX config callables ----------
    async def get_config(self) -> dict:
        s = _load_settings()
        # keep runtime in sync
        self.use_mux = bool(s.get("use_mux", False))
        self.mux_mask = int(s.get("mux_mask", 1)) or 1
        return {"use_mux": self.use_mux, "mux_mask": self.mux_mask}

    async def set_use_mux(self, enabled: bool) -> None:
        s = _load_settings()
        s["use_mux"] = bool(enabled)
        _save_settings(s)
        self.use_mux = s["use_mux"]
        logger.info(f"use_mux set to {self.use_mux}")

    async def set_mux_mask(self, mask: int) -> None:
        m = int(mask)
        if m not in (1, 2, 3):
            raise ValueError("mux_mask must be 1 (A), 2 (B), or 3 (Both)")
        s = _load_settings()
        s["mux_mask"] = m
        _save_settings(s)
        self.mux_mask = m
        logger.info(f"mux_mask set to {self.mux_mask}")

    # ----- callable backend methods (async) -----

    async def my_backend_function(self) -> None:
        logger.info("my_backend_function called")
        async with self._i2c_lock:
            await drv_test()

    async def drv_startup(self, both_active: bool = False) -> None:
        logger.info(f"drv_startup(both_active={both_active})")
        async with self._i2c_lock:
            # needs rework to work with mux_select
            
            # Select driver 1
            #mux_select(0x01)
            drv_init()
            logger.info("Driver 1 initialized")

            #if both_active:
                # Select driver 2
            #    mux_select(0x02)
            #    drv_init()
            #    logger.info("Driver 2 initialized")

                # Enable both
            #    mux_select(0x03)
            #    await drv_test()
            #    logger.info("Both drivers active")
            #else:
                # Keep only driver 1
            #    mux_select(0x01)
            #    await drv_test()
            #    logger.info("Driver 1 active")

    async def start_sniffer(self) -> None:
        if self.sniffer_process:
            logger.info("Sniffer already running")
            return
        if not SNIFFER.exists():
            logger.error(f"Sniffer binary missing: {SNIFFER}")
            return

        logger.info(f"Starting sniffer: {SNIFFER}")
        self.sniffer_process = subprocess.Popen(
            [str(SNIFFER)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        self._sniffer_reader = asyncio.create_task(self._read_sniffer())

    async def _read_sniffer(self):
        try:
            assert self.sniffer_process and self.sniffer_process.stdout
            loop = asyncio.get_running_loop()
            while True:
                line = await loop.run_in_executor(None, self.sniffer_process.stdout.readline)
                if not line:
                    break
                logger.info(f"[sniffer] {line.rstrip()}")
        except Exception as e:
            logger.error(f"sniffer reader error: {e}")
        finally:
            logger.info("sniffer stdout closed")

    async def stop_sniffer(self) -> None:
        if not self.sniffer_process:
            logger.info("Sniffer not running")
            return

        logger.info("Stopping sniffer…")
        self.sniffer_process.terminate()
        try:
            self.sniffer_process.wait(timeout=3)
        except Exception:
            self.sniffer_process.kill()
        finally:
            self.sniffer_process = None
            if self._sniffer_reader:
                self._sniffer_reader.cancel()
                self._sniffer_reader = None
            logger.info("Sniffer stopped")

    async def query_voltage(self) -> float:
        """
        Returns VDD (in volts). If the chip isn't actively playing,
        try a short tick to refresh VBAT, per datasheet.
        """
        async with self._i2c_lock:
            self._mux_select_current()
            try:
                # 1) Try a direct read
                raw = i2c_read_reg(DRV_ADDR, 0x21, 1)[0]
                volts = _vbat_to_volts(raw)
                # If clearly invalid, nudge the device to "active" and sample again
                if volts <= 0.1:
                    # brief GO pulse
                    i2c_write(DRV_ADDR, 0x0C, 0x01)
                    await asyncio.sleep(0.03)
                    raw = i2c_read_reg(DRV_ADDR, 0x21, 1)[0]
                    volts = _vbat_to_volts(raw)
                logger.info(f"VBAT raw=0x{raw:02X} -> {volts:.3f} V")
                return float(volts)
            except Exception as e:
                logger.error(f"query_voltage failed: {e}")
                # Decky callables must return JSON-serializable; re-raise to show error in UI
                raise
                
    async def read_status(self) -> dict:
        async with self._i2c_lock:
            snap = _snapshot_status()
        return snap

    async def set_standby(self, enabled: bool) -> None:
        """Set/clear software standby (MODE.6)."""
        async with self._i2c_lock:
            _rmw_u8(DRV_ADDR, REG_MODE, clear_mask=(1 << 6), set_mask=(1 << 6) if enabled else 0)
        s = _load_settings()
        s["persist_standby"] = bool(enabled)
        _save_settings(s)
    
    async def set_high_z(self, enabled: bool) -> None:
        """Force true Hi-Z on outputs (LIBSEL.4)."""
        async with self._i2c_lock:
            _rmw_u8(DRV_ADDR, REG_LIBSEL, clear_mask=(1 << 4), set_mask=(1 << 4) if enabled else 0)
        s = _load_settings()
        s["persist_hi_z"] = bool(enabled)
        _save_settings(s)

    async def run_diagnostics(self, mux_mask: int | None = None) -> dict:
        async with self._i2c_lock:
            if mux_mask is not None:
                mux_select(mux_mask)
            # MODE = Diagnostics (6), clear standby
            _rmw_u8(DRV_ADDR, REG_MODE, clear_mask=(1 << 6) | 0x07, set_mask=0x06)
            i2c_write(DRV_ADDR, REG_GO, 0x01)
            for _ in range(300):
                if (_read_u8(DRV_ADDR, REG_GO) & 0x01) == 0:
                    break
                await asyncio.sleep(0.01)
            snap = _snapshot_status()
        snap["diag_pass"] = not snap.pop("diag_fail", False)
        logger.info(f"Diagnostics -> {snap}")
        return snap

    # ------------ Preset Manager functions
    async def list_presets(self) -> list[str]:
        s = _load_settings()
        return sorted(s.get("presets", {}).keys())

    async def save_preset(self, name: str, lib_id: int, steps: list[int]) -> None:
        s = _load_settings()
        s.setdefault("presets", {})[name] = {"lib": int(lib_id), "steps": [(int(x) & 0xFF) for x in steps[:8]]}
        _save_settings(s)
        logger.info(f"Saved preset '{name}'")

    async def load_preset(self, name: str) -> dict:
        s = _load_settings()
        p = s.get("presets", {}).get(name)
        if not p:
            raise ValueError(f"Preset '{name}' not found")
        return p  # {"lib": int, "steps": [ints]}

    async def delete_preset(self, name: str) -> None:
        s = _load_settings()
        if s.get("presets", {}).pop(name, None) is None:
            raise ValueError(f"Preset '{name}' not found")
        _save_settings(s)
        logger.info(f"Deleted preset '{name}'")

    async def apply_preset(self, name: str) -> None:
        p = await self.load_preset(name)
        await self.set_library(int(p["lib"]))
        await self.program_sequence([int(x) for x in p["steps"]])
        await self.play_sequence()    

    # ------------ Library select functions
    async def set_library(self, lib_id: int) -> None:
        """
        Select ROM library (0..N). Exact meanings depend on DRV2605 variant.
        """
        async with self._i2c_lock:
            self._mux_select_current()
            i2c_write(DRV_ADDR, 0x03, lib_id & 0xFF)
            logger.info(f"Library set to {lib_id}")
        s = _load_settings()
        s["last_lib"] = int(lib_id)
        _save_settings(s)

    async def program_sequence(self, steps: list[int]) -> None:
        """
        Program up to 8 sequence slots (0x04..0x0B). 
        Each item is either an effect ID (0x01..0x7F) or a WAIT cmd (0x80..0xFF).
        steps: up to 8 bytes:
          - 0x01..0x7F = effect
          - 0x80..0xFF = wait (ticks of 10ms)
        Backend appends 0x00 terminator if missing.
        """
        if not isinstance(steps, list):
            raise ValueError("steps must be a list of integers")
        if len(steps) > 8:
            raise ValueError("max 8 sequence steps")

        # sanitize to bytes
        seq = [(int(x) & 0xFF) for x in steps]
        if len(seq) < 8 and (len(seq) == 0 or seq[-1] != 0x00):
            seq.append(0x00)  # terminator

        async with self._i2c_lock:
            self._mux_select_current()
            # write into 0x04..0x0B
            for i, b in enumerate(seq[:8]):
                i2c_write(DRV_ADDR, 0x04 + i, b)
            logger.info(f"Programmed sequence: {seq[:8]}")

    async def play_sequence(self) -> None:
        """
        Play the programmed sequence. MODE=Internal Trigger, GO=1.
        """
        async with self._i2c_lock:
            self._mux_select_current()
            i2c_write(DRV_ADDR, 0x01, 0x00)  # MODE: internal trigger, standby=0
            i2c_write(DRV_ADDR, 0x0C, 0x01)  # GO
            logger.info("Sequence PLAY")

    async def stop_sequence(self) -> None:
        """
        Stop playback quickly by forcing Standby (bit6). 
        Next play clears it back to 0x00.
        """
        async with self._i2c_lock:
            self._mux_select_current()
            i2c_write(DRV_ADDR, 0x01, 0x40)  # MODE: standby bit set
            logger.info("Sequence STOP (standby)")
    
    async def get_timing_offsets(self) -> dict:
        """
        Read Overdrive/Sustain+/Sustain-/Brake time offsets (0x0D..0x10), 0..255 each.
        """
        async with self._i2c_lock:
            if hasattr(self, "_mux_select_current"):
                self._mux_select_current()
            try:
                data = i2c_read_reg(DRV_ADDR, 0x0D, 4)  # 0x0D..0x10
                ovr, sus_p, sus_n, brk = data[0], data[1], data[2], data[3]
                logger.info(f"Timing offsets read: {ovr},{sus_p},{sus_n},{brk}")
                return {
                    "overdrive": int(ovr),
                    "sustain_pos": int(sus_p),
                    "sustain_neg": int(sus_n),
                    "brake": int(brk),
                }
            except Exception as e:
                logger.error(f"get_timing_offsets failed: {e}")
                raise

    async def set_timing_offsets(self, overdrive: int, sustain_pos: int, sustain_neg: int, brake: int, ) -> None:
        """
        Write Overdrive/Sustain+/Sustain-/Brake time offsets (0x0D..0x10). Values clamped to 0..255.
        """
        def _clamp(v: int) -> int: return max(0, min(255, int(v)))
        ovr, susP, susN, brk = _clamp(overdrive), _clamp(sustain_pos), _clamp(sustain_neg), _clamp(brake)
        async with self._i2c_lock:
            if hasattr(self, "_mux_select_current"):
                self._mux_select_current()
            i2c_write(DRV_ADDR, 0x0D, ovr)
            i2c_write(DRV_ADDR, 0x0E, susP)
            i2c_write(DRV_ADDR, 0x0F, susN)
            i2c_write(DRV_ADDR, 0x10, brk)
            logger.info(f"Timing offsets set: {ovr},{susP},{susN},{brk}")
        s = _load_settings()
        s["last_offsets"] = {"overdrive": ovr, "sustain_pos": susP, "sustain_neg": susN, "brake": brk}
        _save_settings(s)

    async def set_sniffer_autostart(self, enabled: bool) -> None:
        s = _load_settings()
        s["autostart_sniffer"] = bool(enabled)
        _save_settings(s)
        logger.info(f"sniffer autostart set to {s['autostart_sniffer']}")
    
    # --- reset DRV2605 function
    
    async def reset_device(self) -> None:
        """
        Soft-reset sequence for DRV2605:
        - stop playback (GO=0)
        - enter standby (MODE.6=1)
        - briefly enable Hi-Z (LIBSEL.4=1) then clear
        - leave standby (MODE.6=0)
        """
        async with self._i2c_lock:
            try:
                if hasattr(self, "_mux_select_current"):
                    self._mux_select_current()

                # Stop any active playback
                try:
                    i2c_write(DRV_ADDR, 0x0C, 0x00)  # GO=0
                except Exception:
                    pass  # ignore if GO isn't set

                # Standby on
                _rmw_u8(DRV_ADDR, 0x01, clear_mask=0, set_mask=(1 << 6))

                # Hi-Z pulse
                _rmw_u8(DRV_ADDR, 0x03, clear_mask=0, set_mask=(1 << 4))
                await asyncio.sleep(0.01)
                _rmw_u8(DRV_ADDR, 0x03, clear_mask=(1 << 4), set_mask=0)

                # Standby off
                _rmw_u8(DRV_ADDR, 0x01, clear_mask=(1 << 6), set_mask=0)

                logger.info("reset_device: completed")
            except Exception as e:
                logger.error(f"reset_device failed: {e}")
                raise RuntimeError(f"reset failed: {e}")

    # --- Flags getter for toggle buttons in the Frontend
    async def get_runtime_flags(self) -> dict:
        """
        Return current booleans so UI toggles can stay in sync.
        """
        async with self._i2c_lock:
            if hasattr(self, "_mux_select_current"):
                self._mux_select_current()
            mode = _read_u8(DRV_ADDR, REG_MODE)
            lib  = _read_u8(DRV_ADDR, REG_LIBSEL)
        s = _load_settings()
        return {
            "standby": bool(mode & 0x40),
            "hi_z":    bool(lib  & 0x10),
            "sniffer": bool(self.sniffer_process),
            "use_mux": bool(self.use_mux),
            "autostart_sniffer": bool(s.get("autostart_sniffer", False)),
        }

    # --- Setting Actuator Parameters (Rated Voltage and Overdrive Clamp)
    async def get_drive_params(self) -> dict:
        """
        Read Rated Voltage (0x16) and Overdrive Clamp (0x17), 0..255 each.
        """
        async with self._i2c_lock:
            if hasattr(self, "_mux_select_current"):
                self._mux_select_current()
            try:
                rated = i2c_read_reg(DRV_ADDR, 0x16, 1)[0]
                over  = i2c_read_reg(DRV_ADDR, 0x17, 1)[0]
                logger.info(f"Drive params read: rated={rated}, overdrive={over}")
                return {"rated": int(rated), "overdrive": int(over)}
            except Exception as e:
                logger.error(f"get_drive_params failed: {e}")
                raise

    async def set_drive_params(self, rated: int, overdrive: int) -> None:
        """
        Write Rated Voltage (0x16) and Overdrive Clamp (0x17). Values clamped to 0..255.
        Also persists to settings as 'last_drive'.
        """
        def _clamp(v: int) -> int: return max(0, min(255, int(v)))
        rv = _clamp(rated)
        od = _clamp(overdrive)
        async with self._i2c_lock:
            if hasattr(self, "_mux_select_current"):
                self._mux_select_current()
            i2c_write(DRV_ADDR, 0x16, rv)
            i2c_write(DRV_ADDR, 0x17, od)
            logger.info(f"Drive params set: rated={rv}, overdrive={od}")
        s = _load_settings()
        s["last_drive"] = {"rated": rv, "overdrive": od}
        _save_settings(s)

    # ----- lifecycle -----

    async def _main(self):
        # Ensure required kernel modules for features (may fail without root)
        for mod in ("i2c-dev", "usbmon"):
            p = subprocess.run(["modprobe", mod])
            if p.returncode != 0:
                logger.warning(f"modprobe {mod} failed with code {p.returncode}")

        # Sanity checks
        dev_path = Path(f"/dev/i2c-{I2C_BUS}")
        if not dev_path.exists():
            logger.warning(f"I2C device {dev_path} not present (load i2c-dev, check bus number)")
        else:
            try:
                # quick open/close to confirm perms
                with RawI2C(I2C_BUS):
                    pass
            except PermissionError:
                logger.warning(
                    f"No permission for {dev_path}. Add user to 'i2c' group and re-login."
                )
            except Exception as e:
                logger.warning(f"Opening {dev_path} failed: {e}")

        s = _load_settings()
        self.use_mux = bool(s.get("use_mux", False))
        self.mux_mask = int(s.get("mux_mask", 1)) or 1

        if s.get("persist_hi_z", False):
            await self.set_high_z(True)
        if s.get("persist_standby", False):
            await self.set_standby(True)

        if s.get("last_lib") is not None:
            try:
                await self.set_library(int(s["last_lib"]))
            except Exception as e:
                logger.warning(f"Reapply library failed: {e}")

        if isinstance(s.get("last_offsets"), dict):
            lo = s["last_offsets"]
            try:
                await self.set_timing_offsets(
                    int(lo.get("overdrive", 0)),
                    int(lo.get("sustain_pos", 0)),
                    int(lo.get("sustain_neg", 0)),
                    int(lo.get("brake", 0)),
                )
            except Exception as e:
                logger.warning(f"Reapply timing offsets failed: {e}")

        if isinstance(s.get("last_drive"), dict):
            ld = s["last_drive"]
            try:
                await self.set_drive_params(int(ld.get("rated", 0)), int(ld.get("overdrive", 0)))
            except Exception as e:
                logger.warning(f"Reapply drive params failed: {e}")

        if s.get("autostart_sniffer", False):
            try:
                await self.start_sniffer()
            except Exception as e:
                logger.warning(f"Autostart sniffer failed: {e}")

    async def _unload(self):
        await self.stop_sniffer()
        logger.info("RumbleDeck backend unloading")

    async def _uninstall(self):
        logger.info("RumbleDeck backend uninstall")

    async def _migration(self):
        # No migrations; keep for compatibility
        logger.info("RumbleDeck backend migration (noop)")
