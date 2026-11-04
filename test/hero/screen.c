/* Stand-in for Claude Code in the test terminal, for staged screenshots only. Closes any
   escape sequence the shell's startup left open, turns on bracketed paste as Claude Code
   does, appends whatever the terminal receives to an input file, and redraws the screen
   file whenever it changes (a renderer rebuilds it from the input). */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <termios.h>
#include <sys/stat.h>
#include <sys/select.h>
int main(int c, char **v) {
  const char *f = c > 1 ? v[1] : "screen.txt";
  const char *in = c > 2 ? v[2] : "input.txt";
  struct termios t;
  if (tcgetattr(0, &t) == 0) { cfmakeraw(&t); tcsetattr(0, TCSANOW, &t); }
  printf("\033\\\033[?25l\033[?2004h"); fflush(stdout);
  long long last = -1;
  for (;;) {
    struct stat st;
    if (stat(f, &st) == 0) {
      long long m = (long long)st.st_mtimespec.tv_sec * 1000000000LL + st.st_mtimespec.tv_nsec;
      if (m != last) {
        last = m;
        FILE *fp = fopen(f, "r");
        if (fp) { printf("\033[H\033[2J\033[3J"); int ch; while ((ch = fgetc(fp)) != EOF) putchar(ch); fclose(fp); fflush(stdout); }
      }
    }
    fd_set r; FD_ZERO(&r); FD_SET(0, &r);
    struct timeval tv = { 0, 150000 };
    if (select(1, &r, NULL, NULL, &tv) > 0) {
      char buf[4096]; ssize_t n = read(0, buf, sizeof buf);
      if (n > 0) { FILE *o = fopen(in, "a"); if (o) { fwrite(buf, 1, n, o); fclose(o); } }
    }
  }
}
