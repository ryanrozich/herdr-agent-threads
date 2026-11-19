# agent-threads: write each line of a transcript as one JSON string, for jq to read without -R.
# jq's -R decodes its input in pieces of about 4 KB, each on its own, so a character whose
# bytes fell in two pieces came out as two or three U+FFFD. jq's JSON reader has no such cut.
# Only ASCII is changed (backslash, quote and control characters are escaped), so each string
# is the line's own text, bad lines included: the jq programs still skip a line that fromjson
# cannot read.
# Usage: perl lines.pl < file | jq -c 'fromjson? ...'
binmode STDIN;
binmode STDOUT;
while (my $l = <STDIN>) {
  chomp $l;
  $l =~ s/([\\"])/\\$1/g;
  $l =~ s/([\x00-\x1f\x7f])/sprintf("\\u%04x", ord $1)/ge;
  print "\"$l\"\n";
}
