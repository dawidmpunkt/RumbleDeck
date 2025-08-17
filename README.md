# Decky Plugin for the DRV2605 based Rumble Mod for Valve's Steam Deck

For the mod see: [Rumble Mod](https://github.com/dawidmpunkt/rumble-for-steamdeck/)

The plugin supports two DRV2605 Drivers via a I2C multiplexer as of now.
Triggering the rumble signal on both drivers simultaneously works.

You will need to install wireshark:
got to console:
sudo steamos-readonly disable
sudo pacman-key --init
sudo pacman-key --populate holo
sudo pacman -S wireshark-cli
sudo gpasswd -a $USER wireshark
sudo steamos-readonly enable

# TODO
- Add option to add custom settings for drivers

# current issues
* backend (/backend/out/rumble-sniffer) does not compile automatically. I do not understand why, yet.
 -> run 'make' in the backend folder manually to compile the sniffer for now.

# License
This project is licensed under the terms of the BSD 3-Clause License. You can read the full
license text in [LICENSE](LICENSE).
