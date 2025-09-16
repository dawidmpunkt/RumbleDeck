# main.py — RumbleDeck backend (no smbus required)

import os
import fcntl
import asyncio
import subprocess
from pathlib import Path

from decky import logger  # Decky-provided logger

# ---------- Config ----------
# Select I²C bus via env var (default 0 is typical on Steam Deck)
I2C_BUS = int(os.getenv("RUMBLEDECK_I2C_BUS", "0"))

# Device addresses
DRV_ADDR = int(os.getenv("RUMBLEDECK_DRV_ADDR", "0x5A"), 0)  # DRV2605
MUX_ADDR = int(os.getenv("RUMBLEDECK_MUX_ADDR", "0x70"), 0)  # e.g., TCA9548A / similar

# Paths
ROOT = Path(__file__).resolve().parent
SNIFFER = ROOT / "backend" / "out" / "rumble-sniffer"

# ioctl constants
I2C_SLAVE = 0x0703


# ---------- Low-level I²C helpers (no smbus) ----------
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

def i2c_read_reg(addr: int, reg: int, n: int = 1) -> bytes: # register read helper function
    """
    Write the register pointer, then read n bytes.
    """
    try:
        with RawI2C(I2C_BUS) as i2c:
            i2c._set_addr(addr)
            os.write(i2c.fd, bytes([reg]))   # set register
            i2c._set_addr(addr)
            return os.read(i2c.fd, n)
    except Exception as e:
        logger.error(f"I2C read failed (bus={I2C_BUS}, addr=0x{addr:02X}, reg=0x{reg:02X}, n={n}): {e}")
        raise

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


def mux_select(mask: int):
    """Write channel mask to I²C mux control register (0x00)."""
    i2c_write(MUX_ADDR, 0x00, mask & 0xFF)


# ---------- Decky plugin ----------
class Plugin:
    def __init__(self, *args, **kwargs):
        self.sniffer_process = None
        self._sniffer_reader = None
        self._i2c_lock = asyncio.Lock()

    # ----- callable backend methods (async) -----

    async def my_backend_function(self) -> None:
        logger.info("my_backend_function called")
        async with self._i2c_lock:
            await drv_test()

    async def drv_startup(self, both_active: bool = False) -> None:
        logger.info(f"drv_startup(both_active={both_active})")
        async with self._i2c_lock:
            # Select driver 1
            mux_select(0x01)
            drv_init()
            logger.info("Driver 1 initialized")

            if both_active:
                # Select driver 2
                mux_select(0x02)
                drv_init()
                logger.info("Driver 2 initialized")

                # Enable both
                mux_select(0x03)
                await drv_test()
                logger.info("Both drivers active")
            else:
                # Keep only driver 1
                mux_select(0x01)
                await drv_test()
                logger.info("Driver 1 active")

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

    # ----- lifecycle -----

    async def _main(self):
        # Ensure required kernel modules for your features (may fail without root)
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

        logger.info(f"RumbleDeck backend started (I2C bus={I2C_BUS})")
        # Optionally start sniffer here:
        # await self.start_sniffer()

    async def _unload(self):
        await self.stop_sniffer()
        logger.info("RumbleDeck backend unloading")

    async def _uninstall(self):
        logger.info("RumbleDeck backend uninstall")

    async def _migration(self):
        # No migrations; keep for compatibility
        logger.info("RumbleDeck backend migration (noop)")
