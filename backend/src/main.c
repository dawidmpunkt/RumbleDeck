//rumblesniffer v0.7
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <linux/i2c-dev.h>  // I2C definitions
#include <sys/ioctl.h>      // ioctl function

#define USBMON_PATH "/sys/kernel/debug/usb/usbmon/3u"  // Path to USB monitor
#define I2C_DEVICE "/dev/i2c-0"  // Path to I2C port (adjust as needed, e.g., /dev/i2c-1)
#define I2C_ADDR 0x5a           // I2C device address of Driver(s)
#define PATTERN "eb090140"    // Rumble-pattern to sniff USB-communication for

void send_i2c_signal(int i2c_fd, unsigned char *data, size_t length) {
    if (write(i2c_fd, data, length) != length) {
        perror("Error sending I2C signal");
    } else {
        printf("I2C signal sent successfully: ");
        for (size_t i = 0; i < length; i++) {
            printf("%02X ", data[i]);
        }
        printf("\n");
    }
}

int main() {
    // Open usbmon stream for the first USB bus
    int usbmon_fd = open(USBMON_PATH, O_RDONLY);
    if (usbmon_fd == -1) {
        perror("Error opening usbmon");
        return 1;
    }

    // Open the I2C interface
    int i2c_fd = open(I2C_DEVICE, O_RDWR);
    if (i2c_fd == -1) {
        perror("Error opening I2C port");
        close(usbmon_fd);
        return 1;
    }

    // Set the address of the I2C device
    if (ioctl(i2c_fd, I2C_SLAVE, I2C_ADDR) < 0) {
        perror("Error setting I2C address");
        close(usbmon_fd);
        close(i2c_fd);
        return 1;
    }

    char buffer[1024];
    ssize_t bytesRead;

    printf("Starting USB sniffing and I2C signaling...\n");

    // Continuous loop to read data from USB monitor
    while (1) {
        // Read data from the usbmon stream
        bytesRead = read(usbmon_fd, buffer, sizeof(buffer));
        if (bytesRead == -1) {
            perror("Error reading from usbmon");
            close(usbmon_fd);
            close(i2c_fd);
            return 1;
        }

        // Search for the pattern in the read buffer
        for (ssize_t i = 0; i < bytesRead; i++) {
            // Check if the pattern matches at the current position in the buffer
            if (i + 7 < bytesRead && memcmp(&buffer[i], PATTERN, 8) == 0) {
                // If the pattern is found, send the signal via I2C
                printf("Pattern found at position %zd. Sending I2C signal...\n", i);

                // Send the signal "GO" (hexadecimal data: 0x0C, 0x01)
                unsigned char data_to_send[] = {0x0C, 0x01};
                send_i2c_signal(i2c_fd, data_to_send, sizeof(data_to_send));

                // Optional: Sleep for a short time to reduce CPU load
                usleep(10000);  // 10ms delay
            }
        }
    }

    close(usbmon_fd);
    close(i2c_fd);
    return 0;
}

