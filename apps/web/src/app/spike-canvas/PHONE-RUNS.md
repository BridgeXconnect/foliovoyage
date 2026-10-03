# Canvas spike: phone runs, engine iteration 1 (BRI-223)

On the phone, open the tappable list at **http://192.168.1.156:3100/spike-canvas/runs**, or use the URLs below. The Mac must be serving `next start -H 0.0.0.0 -p 3100`, with the phone on the same Wi-Fi.

Every run is hands-off, so runs differ only in their configuration:

1. Open the URL and wait about 3 s for the photos.
2. Tap **start 30 s pan**, put the phone down flat, and don't touch the screen.
3. After a 3 s countdown the canvas pans by itself for 30 s: left to right across the four slots and back at 900 px/s, drifting down and up within the slot row.
4. The overlay then freezes on a **RESULT** block. Take a screenshot with the whole overlay in it.

Check that the overlay's `mount / section / overlay` lines match the run and that there is no red `INVALID` line. Keep Low Power Mode off and use the same browser for every run.

| # | URL | What the result means |
|---|---|---|
| 1 | http://192.168.1.156:3100/spike-canvas?auto=1&overlay=1 | **Baseline.** React mounts each crossing's tiles in one commit (512 px sections, overscan 1). Every other run is compared with this one. |
| 2 | http://192.168.1.156:3100/spike-canvas?auto=1&overlay=1&mount=batch | At most 4 tiles shown per frame, without React. Fewer frames over 25 ms than run 1: the burst of mounts at a crossing is the hitch. |
| 3 | http://192.168.1.156:3100/spike-canvas?auto=1&overlay=1&section=256&overscan=2 | Quarter-area sections: more crossings, each mounting fewer tiles, over a similar mounted area. Better than run 1: the size of each burst matters more than how often it happens. |
| 4 | http://192.168.1.156:3100/spike-canvas?auto=1&overlay=1&mount=batch&section=256&overscan=2 | Both together. Better than runs 2 and 3: the two add up. |
| 5 | http://192.168.1.156:3100/spike-canvas?auto=1&overlay=lite | Run 1 with an opaque overlay updated once a second. Clearly better than run 1: the full overlay costs frames itself, and runs 1 to 4 overstate the hitches. |
| 6 | http://192.168.1.156:3100/spike-canvas?auto=1&overlay=lite&mount=batch&section=256&overscan=2 | The best combination with the lite overlay: the closest to the canvas without measuring. This is the number to hold against the 20 ms gate. |

For each screenshot the lines that matter are `pan p50 · p95 · p99 · worst`, `frames >25 ms` with the count that falls within 100 ms after a crossing, and the "by chance" percentage. If the hitches follow the crossings, the share after a crossing is well above the chance rate.
