import math
import struct
import wave

rate = 44100
notes = [(880.0, 0.0, 0.18), (1318.5, 0.11, 0.32)]
length = int(rate * 0.5)
samples = [0.0] * length
for freq, start, dur in notes:
    s0 = int(start * rate)
    n = int(dur * rate)
    for i in range(n):
        t = i / rate
        env = min(1.0, t / 0.005) * math.exp(-t * 9.0)
        v = math.sin(2 * math.pi * freq * t) + 0.25 * math.sin(4 * math.pi * freq * t)
        if s0 + i < length:
            samples[s0 + i] += 0.32 * env * v
with wave.open("public/sounds/notification.wav", "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(
        b"".join(
            struct.pack("<h", int(max(-1.0, min(1.0, x)) * 32767)) for x in samples
        )
    )
