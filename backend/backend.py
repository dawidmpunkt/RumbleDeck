import os
import subprocess
from decky_plugin import Plugin

class SnifferPlugin(Plugin):
    sniffer_process = None

    async def on_activate(self):
        self.logger.info("USB Sniffer Plugin Activated")

    async def on_deactivate(self):
        self.stop_sniffer()
        self.logger.info("USB Sniffer Plugin Deactivated")

    def start_sniffer(self):
        if not self.sniffer_process:
            self.logger.info("Starting USB Sniffer...")
            self.sniffer_process = subprocess.Popen(
                [os.path.join(os.path.dirname(__file__), "usb_sniffer")],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            self.logger.info("USB Sniffer started")

    def stop_sniffer(self):
        if self.sniffer_process:
            self.logger.info("Stopping USB Sniffer...")
            self.sniffer_process.terminate()
            self.sniffer_process.wait()
            self.sniffer_process = None
            self.logger.info("USB Sniffer stopped")

    def get_logs(self):
        if self.sniffer_process:
            try:
                return self.sniffer_process.stdout.readline()
            except Exception as e:
                self.logger.error(f"Error reading sniffer output: {e}")
                return None
        return "Sniffer not running"
