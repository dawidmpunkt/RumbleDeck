import os
import subprocess
#from decky_plugin import Plugin

# The decky plugin module is located at decky-loader/plugin
# For easy intellisense checkout the decky-loader code repo
# and add the `decky-loader/plugin/imports` path to `python.analysis.extraPaths` in `.vscode/settings.json`
import decky
import asyncio
import smbus
import time
import logging
from helpers import get_user

USER = get_user()
HOME_PATH = "/home/" + USER
PLUGIN_PATH = HOME_PATH + "/homebrew/plugins/RumbleDeck"

logging.basicConfig(filename="/tmp/rumbledeck.log",
                    format='[RumbleDeck] %(asctime)s %(levelname)s %(message)s',
                    filemode='w+',
                    force=True)
logger=logging.getLogger()
logger.setLevel(logging.INFO)


bus_no = int(0)
bus = smbus.SMBus(bus_no)

# test motors
def drv_test():
    for x in range(3):
        bus.write_i2c_block_data(0x5a, 12, [1])
        time.sleep(0.2)

# initialize driver
def drv_init():
    bus.write_i2c_block_data(0x5a, 22, [126])
    bus.write_i2c_block_data(0x5a, 23, [150])
    bus.write_i2c_block_data(0x5a, 26, [54])
    bus.write_i2c_block_data(0x5a, 27, [147])
    bus.write_i2c_block_data(0x5a, 28, [245])
    bus.write_i2c_block_data(0x5a, 29, [168])
    bus.write_i2c_block_data(0x5a, 3, [1])
    bus.write_i2c_block_data(0x5a, 1, [0])

#class SnifferPlugin(Plugin):
class Plugin:
    sniffer_process = None
    DEVICE_ADDRESS = int(0x5a)
    cmd_test_rumble = [0x0C, 0x01]
    
    async def my_backend_function(self):
        drv_test()

    async def drv_startup(self, both_active=False):
        # switch to first Driver
        logger.info("Switching to first driver")
        bus.write_i2c_block_data(0x70, 0, [1])
        drv_init()
        logger.info("First driver initialized")
        if both_active == True:
        # switch to second Driver
            logger.info("Switching to second driver")
            bus.write_i2c_block_data(0x70, 0, [2])
            drv_init()
            logger.info("Second driver initialized")
            # Activate both Drivers
            bus.write_i2c_block_data(0x70, 0, [3])
            drv_test()
            logger.info("Both drivers active")
        else:
            # Activate only Driver 1
            bus.write_i2c_block_data(0x70, 0, [1])
            drv_test()
            logger.info("Driver 1 active")
    
    async def drv_toggle(self, drv_no):
        pass
        #TODO
     
    async def on_activate(self):
        self.start_sniffer()
        logger.info("USB Sniffer Plugin Activated")

    async def on_deactivate(self):
        self.stop_sniffer()
        logger.info("USB Sniffer Plugin Deactivated")
 
    def start_sniffer(self):
        if not self.sniffer_process:
            logger.info("Starting USB Sniffer...")
            self.sniffer_process = subprocess.Popen([PLUGIN_PATH + "/backend/out/rumble-sniffer"],
            #self.sniffer_process = subprocess.Popen(
                #[os.path.join(os.path.dirname(__file__), "usb_sniffer")],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            logger.info("USB Sniffer started")

    def stop_sniffer(self):
        if self.sniffer_process:
            logger.info("Stopping USB Sniffer...")
            self.sniffer_process.terminate()
            self.sniffer_process.wait()
            self.sniffer_process = None
            logger.info("USB Sniffer stopped")

    def get_logs(self):
        if self.sniffer_process:
            try:
                return self.sniffer_process.stdout.readline()
            except Exception as e:
                logger.error(f"Error reading sniffer output: {e}")
                return None
        return "Sniffer not running"

    # Asyncio-compatible long-running code, executed in a task when the plugin is loaded
    async def _main(self):
        subprocess.run(["modprobe", "usbmon"])
        self.loop = asyncio.get_event_loop()
        logger.info("Hello World!")
        #self.start_sniffer()

    # Function called first during the unload process, utilize this to handle your plugin being stopped, but not
    # completely removed
    async def _unload(self):
        logger.info("Goodnight World!")
        self.stop_sniffer()
        #self.sniffer_process.terminate()
        #self.sniffer_process = None
        pass

    # Function called after `_unload` during uninstall, utilize this to clean up processes and other remnants of your
    # plugin that may remain on the system
    async def _uninstall(self):
        logger.info("Goodbye World!")
        pass

    # Migrations that should be performed before entering `_main()`.
    async def _migration(self):
        logger.info("Migrating")
        # Here's a migration example for logs:
        # - `~/.config/decky-template/template.log` will be migrated to `decky.decky_LOG_DIR/template.log`
        decky.migrate_logs(os.path.join(decky.DECKY_USER_HOME,
                                               ".config", "decky-template", "template.log"))
        # Here's a migration example for settings:
        # - `~/homebrew/settings/template.json` is migrated to `decky.decky_SETTINGS_DIR/template.json`
        # - `~/.config/decky-template/` all files and directories under this root are migrated to `decky.decky_SETTINGS_DIR/`
        decky.migrate_settings(
            os.path.join(decky.DECKY_HOME, "settings", "template.json"),
            os.path.join(decky.DECKY_USER_HOME, ".config", "decky-template"))
        # Here's a migration example for runtime data:
        # - `~/homebrew/template/` all files and directories under this root are migrated to `decky.decky_RUNTIME_DIR/`
        # - `~/.local/share/decky-template/` all files and directories under this root are migrated to `decky.decky_RUNTIME_DIR/`
        decky.migrate_runtime(
            os.path.join(decky.DECKY_HOME, "template"),
            os.path.join(decky.DECKY_USER_HOME, ".local", "share", "decky-template"))
