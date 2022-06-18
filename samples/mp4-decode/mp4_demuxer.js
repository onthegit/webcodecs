class MP4Demuxer {
  constructor(uri) {
    this.uri = uri;
    this.file = MP4Box.createFile();
    this.file.onError = console.error.bind(console);
    this.file.onReady = this.onReady.bind(this);
    this.file.onSamples = undefined
    this.info = null;
    this.track = null;
    this.offset = 0;
  }

  onReady(info) {
    // TODO: Generate configuration changes.
    this.info = info;
  }

  async getInfo() {
    if (this.info) {
      return Promise.resolve(this.info);
    }

    //info not found, fetch the video to retrieve the info
    await this.fetchVideo();
    if (this.info) {
      this.track = this.info.videoTracks[0];
    }
    return Promise.resolve(this.info)
  }

  getAvccBox() {
    const trak = this.file.getTrackById(this.track.id)
    if (trak) {
      return trak.mdia.minf.stbl.stsd.entries[0].avcC
    }
    return null
  }

  async fetchVideo() {
    this.offset = 0
    const response = await fetch(this.uri)
    const reader = response.body.getReader();
    while (true) {
      const ret = await reader.read();
      this.appendBuffers(ret)
      if (ret.done) {
        break
      }
    }
    return Promise.resolve()
  }

  appendBuffers(r) {
    if (r.done) {
      return
    }

    if (r.value && r.value.buffer && r.value.buffer.byteLength) {
      const buf = r.value.buffer;
      buf.fileStart = this.offset;
      this.offset += buf.byteLength;
      this.file.appendBuffer(buf);
    }
  }

  async start(onChunk) {
    this._onChunk = onChunk;

    const info = await this.getInfo()

    if (!info) {
      throw 'Could not parse video.'
    }
    //no more samples are needed, since the entire video is fetched
    this.file.flush()
    this.file.setExtractionOptions(this.track.id)
    this.file.start()
    this.processAllSamples()
    return Promise.resolve()
  }

  processAllSamples() {
    const trak = this.file.getTrackById(this.track.id)
    if (trak && trak.samples) {
      for (let i = 0; i < trak.samples.length; i++) {
        this.processSample(trak.samples[i])
      }
    }
  }

  processSample(sample) {
    if (!sample || !this._onChunk) {
      return
    }

    if (!sample.data) {
      return
    }

    if (!sample.data.length) {
      return
    }

    if (sample.alreadyRead != sample.data.length || sample.size != sample.data.length) {
      return
    }

    const chunk = new EncodedVideoChunk({
      type: sample.is_sync ? "key" : "delta",
      timestamp: sample.cts,
      duration: sample.duration,
      data: sample.data
    });

    this._onChunk(chunk);
  }

  getExtradata(avccBox) {
    var i;
    var size = 7;
    for (i = 0; i < avccBox.SPS.length; i++) {
      // nalu length is encoded as a uint16.
      size += 2 + avccBox.SPS[i].length;
    }
    for (i = 0; i < avccBox.PPS.length; i++) {
      // nalu length is encoded as a uint16.
      size += 2 + avccBox.PPS[i].length;
    }

    const writer = new Writer(size);

    writer.writeUint8(avccBox.configurationVersion);
    writer.writeUint8(avccBox.AVCProfileIndication);
    writer.writeUint8(avccBox.profile_compatibility);
    writer.writeUint8(avccBox.AVCLevelIndication);
    writer.writeUint8(avccBox.lengthSizeMinusOne + (63 << 2));

    writer.writeUint8(avccBox.nb_SPS_nalus + (7 << 5));
    for (i = 0; i < avccBox.SPS.length; i++) {
      writer.writeUint16(avccBox.SPS[i].length);
      writer.writeUint8Array(avccBox.SPS[i].nalu);
    }

    writer.writeUint8(avccBox.nb_PPS_nalus);
    for (i = 0; i < avccBox.PPS.length; i++) {
      writer.writeUint16(avccBox.PPS[i].length);
      writer.writeUint8Array(avccBox.PPS[i].nalu);
    }

    return writer.getData();
  }

  async getConfig() {
    const info = await this.getInfo();
    if (!info) {
      throw 'Could not retrieve info.'
    }

    const avc = this.getAvccBox()

    if (!avc) {
      throw 'Could not get avcc box.'
    }

    var extradata = this.getExtradata(avc);

    let config = {
      codec: this.track.codec,
      codedHeight: this.track.video.height,
      codedWidth: this.track.video.width,
      description: extradata,
    }

    return Promise.resolve(config);
  }
}

class Writer {
  constructor(size) {
    this.data = new Uint8Array(size);
    this.idx = 0;
    this.size = size;
  }

  getData() {
    if (this.idx != this.size)
      throw "Mismatch between size reserved and sized used"

    return this.data.slice(0, this.idx);
  }

  writeUint8(value) {
    this.data.set([value], this.idx);
    this.idx++;
  }

  writeUint16(value) {
    // TODO: find a more elegant solution to endianess.
    var arr = new Uint16Array(1);
    arr[0] = value;
    var buffer = new Uint8Array(arr.buffer);
    this.data.set([buffer[1], buffer[0]], this.idx);
    this.idx += 2;
  }

  writeUint8Array(value) {
    this.data.set(value, this.idx);
    this.idx += value.length;
  }
}