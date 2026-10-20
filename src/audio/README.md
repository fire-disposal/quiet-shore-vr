# Audio assets

`lake.mp3` / `stream.mp3` / `rain.mp3` are seamless ambient loops, not raw
source recordings with fades at both ends. The originals had ~1 s fade-in and
~2 s fade-out, which produced an audible dip every loop (especially obvious on
the bathroom water track).

## Loop recipe

For each source, trim the fades and crossfade the tail into the head:

- trim `1.0s .. (duration - 2.0s)`;
- take `head = body[0..2s]`, `tail = body[end-2s..end]`,
  `middle = body[2s..end-2s]`;
- equal-power crossfade `tail -> head` (2 s), then concatenate the crossfade
  with `middle`;
- encode mono 44.1 kHz MP3, 80 kbps.

The result starts and ends at the same waveform region, so `AudioBufferSourceNode.loop = true`
has no fade-to-silence seam. Output durations: stream 16 s, lake/rain 25 s.

## Rebuild

```bash
# stream: source 21 s -> body 18 s -> output 16 s
ffmpeg -i stream.mp3 -filter_complex \
  "[0:a]atrim=1:19,asetpts=PTS-STARTPTS[body]; \
   [body]asplit=3[b1][b2][b3]; \
   [b1]atrim=0:2,asetpts=PTS-STARTPTS[head]; \
   [b2]atrim=16:18,asetpts=PTS-STARTPTS[tail]; \
   [b3]atrim=2:16,asetpts=PTS-STARTPTS[mid]; \
   [tail][head]acrossfade=d=2:c1=qsin:c2=qsin[seam]; \
   [seam][mid]concat=n=2:v=0:a=1[out]" \
  -map "[out]" -ar 44100 -ac 1 -b:a 80k stream-loop.mp3
```

`lake`/`rain` use `atrim=1:28`, tail `25:27`, middle `2:25`, output 25 s.

## Playback

`audio.ts` keeps one looping source per scene, crossfades scene changes over
1.2 s, and does not restart the same track if it is already playing. Do not add
per-track fades to these files; the loop relies on matched head/tail levels.
