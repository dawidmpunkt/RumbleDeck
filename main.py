# main.py — RumbleDeck backend (no smbus required)
import os
import os.path
import fcntl
import asyncio
import subprocess
import time
from pathlib import Path

from decky import logger  # Decky-provided logger

# ---------- Config ----------
# Select I²C bus via env var (default 1 is typical on Steam Deck)
I2C_BUS = int(os.getenv("RUMBLEDECK_I2C_BUS", "1"))

# Device addresses
DRV_ADDR = 0x5A  # DRV2605
MUX_ADDR = 0x70  # e.g., TCA9548A / similar

# Paths
ROOT = Path(__file__).resolve().parent
SNIFFER = ROOT / "backend" / "out" / "rumble-sniffer"

# ioctl constants
I2C_SLAVE = 0x0703


# ---------- Low-level I²C helpers (no smbus) ----------
class RawI2C:
    """
    Minimal /dev/i2c-* writer. Re-opens per use (simple & robust).
    Supports "register + bytes" write (what your code needs).
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
    """Convenience wrapper: open, write, close."""
    with RawI2C(I2C_BUS) as i2c:
        i2c.write_reg(addr, reg, data)


# ---------- Device-specific actions ----------
def drv_test():
    """Simple test: trigger rumble 3×."""
    for _ in range(3):
        i2c_write(DRV_ADDR, 0x0C, 0x01)  # GO = 1
        time.sleep(0.2)


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
    sniffer_process = None

    # ----- callable backend methods (async) -----

    async def my_backend_function(self) -> None:
        logger.info("my_backend_function called")
        drv_test()

    async def drv_startup(self, both_active: bool = False) -> None:
        logger.info(f"drv_startup(both_active={both_active})")

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
            drv_test()
            logger.info("Both drivers active")
        else:
            # Keep only driver 1
            mux_select(0x01)
            drv_test()
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
            stderr=subprocess.PIPE,
            text=True,
        )

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
            logger.info("Sniffer stopped")

    # ----- lifecycle -----

    async def _main(self):
        # Ensure required kernel modules for your features
        for mod in ("i2c-dev", "usbmon"):
            try:
                subprocess.run(["modprobe", mod], check=False)
            except Exception as e:
                logger.warning(f"modprobe {mod} failed: {e}")

        # Sanity log
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
