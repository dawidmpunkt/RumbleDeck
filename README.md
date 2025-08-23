# Decky Plugin for the DRV2605 based Rumble Mod for Valve's Steam Deck

For the mod see: [Rumble Mod](https://github.com/dawidmpunkt/rumble-for-steamdeck/)

The plugin supports two DRV2605 Drivers via a I2C multiplexer as of now.
Triggering the rumble signal on both drivers simultaneously works.

You might need to install dependencies. I still need to minimize this and automate the installation.

Wireshark:
```
sudo steamos-readonly disable
sudo pacman-key --init
sudo pacman-key --populate holo
sudo pacman -S wireshark-cli
sudo gpasswd -a $USER wireshark
sudo steamos-readonly enable
```

Headers to compile the backend:
```
sudo steamos-readonly disable
sudo pacman -Sy
sudo pacman -S base-devel --needed
sudo pacman -S make
sudo pacman -S linux-api-headers gcc make base-devel --noconfirm
sudo steamos-readonly enable
```

Automatically load usbmon on startup
create a file named usbmon.com and put this single line inside: usbmon
```
sudo nano /etc/modules-load.d/usbmon.conf
```

load i2c-dev module and set permissions once to be able to run the python backend: 
```
sudo pacman -S --needed i2c-tools
sudo modprobe i2c-dev
sudo gpasswd -a $USER i2c
newgrp i2c
```

# TODO
- Add option to add custom settings for drivers

# current issues
[fixed] ~~backend (/backend/out/rumble-sniffer) does not compile automatically. I do not understand why, yet.~~
 ~~-> run 'make' in the backend folder manually to compile the sniffer for now.~~

# License
This project is licensed under the terms of the BSD 3-Clause License. You can read the full
license text in [LICENSE](LICENSE).
