# Canvas spike: phone runs (BRI-223)

On the phone, open the tappable list at **http://192.168.1.156:3100/spike-canvas/runs**, or use the URLs below. The Mac must be serving `next start -H 0.0.0.0 -p 3100`, with the phone on the same Wi-Fi.

For each run: open the URL, wait about 3 s for the photos to load, tap **reset**, then pan continuously for **20 s**, left and right across the four slots. Stop, wait 1 s, and take a **screenshot with the overlay in it**. Check that the overlay's `img / tilt / decode / layers` line matches the run and that there is no red `INVALID` line. The `query` line shows the exact URL that was loaded.

| # | URL | What the result means |
|---|---|---|
| 1 | http://192.168.1.156:3100/spike-canvas?overlay=1&img=off | **The key run.** Smooth (p95 ≤ 20 ms): the images are the cost. Still janky: the cost is the engine, layout or compositing, not the photos. |
| 2 | http://192.168.1.156:3100/spike-canvas?overlay=1&img=1x | About a quarter of the decoded pixels of full. Close to run 1: image size is the cost, so serve right-sized variants. Close to full: it is the number of images, not their size. |
| 3 | http://192.168.1.156:3100/spike-canvas?overlay=1&tilt=0 | Better than full: drawing rotated photos is the cost. |
| 4 | http://192.168.1.156:3100/spike-canvas?overlay=1&layers=0 | Better than full: repaint scope is the cost, and `contain: paint` on each tile keeps it small. |
| 5 | http://192.168.1.156:3100/spike-canvas?overlay=1&decode=pre | Better than full: decoding on first paint causes the jank, so decode before a tile shows its image. |
| 6 | http://192.168.1.156:3100/spike-canvas?overlay=1&img=1x&tilt=0&layers=0&decode=pre | Everything on at once. Still over 20 ms: what is left is the engine, React mounts or the compositor, and the engine budget goes there. |
| 7 (optional) | http://192.168.1.156:3100/spike-canvas?overlay=1 | The baseline again, last, to check whether the phone got warm and slowed down over the session. |

"Full" means your earlier baseline runs (p95 33 ms and 18 ms since reset, 24 ms over the last 5 s). Compare each run's "pan, since reset" p95 against those and against the 20 ms gate.
