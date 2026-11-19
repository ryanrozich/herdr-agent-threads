# agent-threads: where lines end in a file, as byte offsets, read in blocks so a long line is
# never held whole.
#   perl ends.pl whole <file> <from>  just after the last newline at or after <from>, or <from>
#                                     when there is none: where the file's whole lines end.
#   perl ends.pl next <file> <from>   just after the first newline at or after <from>, or -1
#                                     when there is none yet.
# extract.sh used tail -n 1 for the first. uutils coreutils 0.10.0 (Ubuntu 26.04) prints only
# the last 983,040 bytes of a line with no newline, which put a line's end inside it.
my ($mode, $file, $from) = @ARGV;
open(my $f, "<", $file) or exit 1;
binmode $f;
if ($mode eq "whole") {
  my $pos = -s $f;
  while ($pos > $from) {
    my $n = $pos - $from < 65536 ? $pos - $from : 65536;
    $pos -= $n;
    seek($f, $pos, 0);
    read($f, my $b, $n);
    my $i = rindex($b, "\n");
    if ($i >= 0) { print $pos + $i + 1, "\n"; exit 0; }
  }
  print "$from\n";
} else {
  my $pos = $from;
  seek($f, $pos, 0);
  while ((my $n = read($f, my $b, 1048576)) > 0) {
    my $i = index($b, "\n");
    if ($i >= 0) { print $pos + $i + 1, "\n"; exit 0; }
    $pos += $n;
  }
  print "-1\n";
}
