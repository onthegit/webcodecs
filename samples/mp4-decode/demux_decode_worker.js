importScripts('./mp4box.all.min.js');
importScripts('./mp4_demuxer.js');

self.addEventListener('message', function (e) {
  const offscreen = e.data.canvas;
  const ctx = offscreen.getContext('2d');
  let startTime = 0;
  let frameCount = 0;

  const demuxer = new MP4Demuxer("/webcodecs/samples/media/bbb.mp4");

  function getFrameStats() {
    const now = performance.now();
    let fps = "";

    if (frameCount++) {
      let elapsed = now - startTime;
      fps = " (" + (1000.0 * frameCount / (elapsed)).toFixed(0) + " fps)"
    } else {
      // This is the first frame.
      startTime = now;
    }

    return "Extracted " + frameCount + " frames" + fps;
  }

  const decoder = new VideoDecoder({
    output: frame => {
      ctx.drawImage(frame, 0, 0, offscreen.width, offscreen.height);

      // Close ASAP.
      frame.close();

      // Draw some optional stats.
      ctx.font = '35px sans-serif';
      ctx.fillStyle = "#ffffff";
      ctx.fillText(getFrameStats(), 40, 40, offscreen.width);
    },
    error: e => console.error(e),
  });

  demuxer.getConfig().then((config) => {
    offscreen.height = config.codedHeight;
    offscreen.width = config.codedWidth;

    decoder.configure(config);
    demuxer.start((chunk) => {
      decoder.decode(chunk);
    }).then(async () => {
      await decoder.flush()
      decoder.close()
    }).catch((e) => console.log(e))
  });
})