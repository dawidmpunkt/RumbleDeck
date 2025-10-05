// rumblesniffer v0.8
//
// Changes from v0.7:
// - Code is resume-aware (closes + reopens the usbmon handle)
// - added exponential delays on multiple retries to reopen usbmon handle after wake
// - clean usbmon reopen via SIGUSR1 handle
// - robust I2C reopen+retry after wake (ioctl(I2C_SLAVE, 0x5a)
// - improved pattern matching: Matching ASCII Text for Pattern instead of memcmp(buffer, "eb090140", 8
// - no more return 1 on failed read(). Instead logging of "reopen needed" and continue.
// - Hygiene fixes: O_CLOEXEC on fds; Processes only S+*o communication; volatile sig_atomic_t flags for signal safety; Clear, single-purpose open_usbmon() / open_i2c() helpers.

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <linux/i2c-dev.h>
#include <sys/ioctl.h>
#include <poll.h>
#include <errno.h>
#include <signal.h>
#include <time.h>
#include <stdbool.h>

#ifndef USBMON_PATH
// Adjust to your bus; 3u == bus 3, text mode
#define USBMON_PATH "/sys/kernel/debug/usb/usbmon/3u"
#endif

#ifndef I2C_DEVICE
#define I2C_DEVICE  "/dev/i2c-0"
#endif

#ifndef I2C_ADDR
#define I2C_ADDR    0x5a
#endif

// Text pattern as it appears in usbmon lines (ASCII hex with spaces)
#ifndef PATTERN_HEX
#define PATTERN_HEX "eb090140"
#endif

// Buffers
#define READ_BUF_SIZE   4096
#define LINE_BUF_SIZE   8192

static int usbmon_fd = -1;
static int i2c_fd    = -1;
static volatile sig_atomic_t want_reopen_usb = 0;
static volatile sig_atomic_t want_reopen_i2c = 0;

static void sleep_ms(int ms){
  struct timespec ts = { .tv_sec = ms/1000, .tv_nsec = (ms%1000)*1000000L };
  nanosleep(&ts, NULL);
}

static void sigusr1_handler(int signo){
  (void)signo;
  want_reopen_usb = 1; // manual kick to reopen capture
}

// -------------------- I2C helpers --------------------
static int open_i2c(void){
  if (i2c_fd >= 0) close(i2c_fd);
  i2c_fd = open(I2C_DEVICE, O_RDWR | O_CLOEXEC);
  if (i2c_fd < 0){
    perror("open i2c");
    return -1;
  }
  if (ioctl(i2c_fd, I2C_SLAVE, I2C_ADDR) < 0){
    perror("ioctl I2C_SLAVE");
    close(i2c_fd);
    i2c_fd = -1;
    return -1;
  }
  return 0;
}

static int send_i2c_signal_retry(const unsigned char *data, size_t len){
  if (i2c_fd < 0 && open_i2c() < 0) return -1;

  ssize_t w = write(i2c_fd, data, len);
  if (w == (ssize_t)len){
    // success (quiet)
    return 0;
  }
  int e = errno;
  fprintf(stderr, "I2C write error: %s; reopening I2C…\n", strerror(e));

  if (open_i2c() < 0) return -1;
  w = write(i2c_fd, data, len);
  if (w == (ssize_t)len){
    return 0;
  }
  perror("I2C write failed after reopen");
  return -1;
}

// -------------------- usbmon helpers --------------------
static int open_usbmon(void){
  if (usbmon_fd >= 0) close(usbmon_fd);
  usbmon_fd = open(USBMON_PATH, O_RDONLY | O_CLOEXEC);
  if (usbmon_fd < 0){
    perror("open usbmon");
    return -1;
  }
  return 0;
}

// -------------------- line parser --------------------
// Process one complete usbmon 'u' line (newline already stripped).
// We only act on Submit lines (token3 == 'S') AND host->device transfers
// (xfer token contains 'o', e.g., "Co:" or "Bo:"). For control-out, payload
// is printed on the Submit line, and our signature is at the start of payload.
static void process_usbmon_line(char *line){
  char *p = line;

  // token1: URB id
  char *id = strsep(&p, " ");
  if (!id) return;

  // token2: timestamp
  char *ts = strsep(&p, " ");
  if (!ts) return;

  // token3: 'S' or 'C'
  char *sc = strsep(&p, " ");
  if (!sc || sc[0] != 'S') return; // Only Submit lines

  // token4: xfer like "Co:3:002:0", "Bo:3:002:2", etc.
  char *xf = strsep(&p, " ");
  if (!xf) return;
  if (!strchr(xf, 'o')) return;     // Only host->device transfers (*o)

  // (Optional micro-filter for your specific path/type, uncomment if desired)
  // if (strncmp(xf, "Co:3:002:0", 10) != 0) return;

  // payload marker " = "
  if (!p) return;
  char *eq = strstr(p, " = ");
  if (!eq) return;

  char *hex = eq + 3; // points to the start of ASCII hex payload
  size_t plen = strlen(PATTERN_HEX);

  // Fast-path: signature is at payload start → memcmp instead of scanning
  if (strlen(hex) >= plen && memcmp(hex, PATTERN_HEX, plen) == 0){
    static const unsigned char go_cmd[] = { 0x0C, 0x01 };
    (void)send_i2c_signal_retry(go_cmd, sizeof go_cmd);
  }
}

// -------------------- main --------------------
int main(void){
  signal(SIGUSR1, sigusr1_handler);

  // Open with backoff (handles boot/resume order)
  int backoff = 100;
  while (open_usbmon() < 0){ sleep_ms(backoff); if (backoff < 2000) backoff *= 2; }
  backoff = 100;
  while (open_i2c()    < 0){ sleep_ms(backoff); if (backoff < 2000) backoff *= 2; }

  puts("rumblesniffer v0.8: S+*o filtered, resume-aware, running…");

  char rbuf[READ_BUF_SIZE];
  char lbuf[LINE_BUF_SIZE];
  size_t lpos = 0;

  for (;;){
    // Handle requested reopens (manual/SIGUSR1 or from earlier errors)
    if (want_reopen_usb){
      want_reopen_usb = 0;
      int ms = 100;
      while (open_usbmon() < 0){
        sleep_ms(ms);
        if (ms < 2000) ms *= 2;
      }
      lpos = 0; // drop partial line state after reopen
      puts("usbmon reopened");
    }
    if (want_reopen_i2c){
      want_reopen_i2c = 0;
      int ms = 100;
      while (open_i2c() < 0){
        sleep_ms(ms);
        if (ms < 2000) ms *= 2;
      }
      puts("i2c reopened");
    }

    // poll usbmon for readability (and detect HUP/ERR)
    struct pollfd pfd = { .fd = usbmon_fd, .events = POLLIN };
    int pr = poll(&pfd, 1, 1000); // 1s tick
    if (pr < 0){
      if (errno == EINTR) continue;
      fprintf(stderr, "poll error: %s (reopen needed)\n", strerror(errno));
      want_reopen_usb = 1;
      continue;
    }
    if (pr == 0) continue; // timeout tick

    if (pfd.revents & (POLLERR | POLLHUP)){
      fprintf(stderr, "usbmon fd hung up/errored (reopen needed)\n");
      want_reopen_usb = 1;
      continue;
    }
    if (!(pfd.revents & POLLIN)) continue;

    ssize_t n = read(usbmon_fd, rbuf, sizeof rbuf);
    if (n <= 0){
      if (n == 0) fprintf(stderr, "usbmon EOF (reopen needed)\n");
      else        fprintf(stderr, "usbmon read error: %s (reopen needed)\n", strerror(errno));
      want_reopen_usb = 1;
      continue;
    }

    // Assemble complete lines and process each once
    for (ssize_t i = 0; i < n; ++i){
      char c = rbuf[i];
      if (c == '\n'){
        if (lpos >= LINE_BUF_SIZE) lpos = LINE_BUF_SIZE - 1;
        lbuf[lpos] = '\0';
        if (lpos) process_usbmon_line(lbuf);
        lpos = 0;
      } else {
        if (lpos + 1 < LINE_BUF_SIZE){
          lbuf[lpos++] = c;
        } else {
          // line overflow: drop chars until newline
        }
      }
    }
  }

  // not reached
  if (usbmon_fd >= 0) close(usbmon_fd);
  if (i2c_fd    >= 0) close(i2c_fd);
  return 0;
}
