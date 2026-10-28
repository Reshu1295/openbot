import AVFoundation
import ExpoModulesCore
import SherpaOnnxC

/// The files of the Supertonic 3 export, as `@openbot/contracts/speech-models` downloads them.
private let supertonicFiles = (
  durationPredictor: "duration_predictor.int8.onnx",
  textEncoder: "text_encoder.int8.onnx",
  vectorEstimator: "vector_estimator.int8.onnx",
  vocoder: "vocoder.int8.onnx",
  ttsJson: "tts.json",
  unicodeIndexer: "unicode_indexer.bin",
  voiceStyle: "voice.bin"
)

/// One part of a reply that waits to play: its id for the events, and its mono samples.
private struct SpeechPart {
  let id: String
  let samples: [Float]
  let sampleRate: Double
}

/// The Supertonic 3 model in sherpa-onnx. Only the synthesis queue uses it.
private final class SupertonicVoice {
  let directory: String
  let tts: OpaquePointer

  init(directory: String, threads: Int) throws {
    let file = { (name: String) in strdup((directory as NSString).appendingPathComponent(name)) }
    let paths = [
      file(supertonicFiles.durationPredictor), file(supertonicFiles.textEncoder), file(supertonicFiles.vectorEstimator),
      file(supertonicFiles.vocoder), file(supertonicFiles.ttsJson), file(supertonicFiles.unicodeIndexer),
      file(supertonicFiles.voiceStyle), strdup("cpu"),
    ]
    defer { paths.forEach { free($0) } }
    var config = SherpaOnnxOfflineTtsConfig()
    config.model.supertonic.duration_predictor = UnsafePointer(paths[0])
    config.model.supertonic.text_encoder = UnsafePointer(paths[1])
    config.model.supertonic.vector_estimator = UnsafePointer(paths[2])
    config.model.supertonic.vocoder = UnsafePointer(paths[3])
    config.model.supertonic.tts_json = UnsafePointer(paths[4])
    config.model.supertonic.unicode_indexer = UnsafePointer(paths[5])
    config.model.supertonic.voice_style = UnsafePointer(paths[6])
    config.model.provider = UnsafePointer(paths[7])
    config.model.num_threads = Int32(threads)
    config.model.debug = 0
    config.max_num_sentences = 1
    guard let tts = SherpaOnnxCreateOfflineTts(&config) else { throw SpeechError.modelLoadFailed }
    self.directory = directory
    self.tts = tts
  }

  deinit {
    SherpaOnnxDestroyOfflineTts(tts)
  }

  func generate(text: String, language: String, speaker: Int, steps: Int) -> (samples: [Float], sampleRate: Double)? {
    var generation = SherpaOnnxGenerationConfig()
    generation.sid = Int32(speaker)
    generation.speed = 1
    generation.silence_scale = 0.2
    generation.num_steps = Int32(steps)
    // The language is the one value of the reply that the JSON carries; it is one of the codes
    // that `SPEECH_LANGUAGES` lists, so it needs no escaping.
    let extra = "{\"lang\":\"\(language)\"}"
    let audio = text.withCString { textPointer in
      extra.withCString { extraPointer -> UnsafePointer<SherpaOnnxGeneratedAudio>? in
        generation.extra = extraPointer
        return SherpaOnnxOfflineTtsGenerateWithConfig(tts, textPointer, &generation, nil, nil)
      }
    }
    guard let audio else { return nil }
    defer { SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio) }
    let count = Int(audio.pointee.n)
    guard count > 0, let samples = audio.pointee.samples else { return nil }
    return (Array(UnsafeBufferPointer(start: samples, count: count)), Double(audio.pointee.sample_rate))
  }
}

private enum SpeechError: Error {
  case modelLoadFailed
}

/// The playback of reply parts, one after another, on one audio engine.
private final class SpeechPlayer {
  private let engine = AVAudioEngine()
  private let node = AVAudioPlayerNode()
  private var format: AVAudioFormat?
  /// The parts that are scheduled, in order. The first one plays.
  private var scheduled: [String] = []
  private let onStart: (String) -> Void
  private let onDone: (String) -> Void
  let queue = DispatchQueue(label: "run.openbot.speech.playback")

  init(onStart: @escaping (String) -> Void, onDone: @escaping (String) -> Void) {
    self.onStart = onStart
    self.onDone = onDone
    engine.attach(node)
  }

  /// Runs on `queue`. A part of a stopped reply is dropped by its caller.
  func play(_ part: SpeechPart, isCurrent: @escaping () -> Bool) throws {
    guard
      let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: part.sampleRate, channels: 1, interleaved: false),
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(part.samples.count)),
      let channel = buffer.floatChannelData?[0]
    else { return }
    part.samples.withUnsafeBufferPointer { source in
      if let base = source.baseAddress { channel.update(from: base, count: part.samples.count) }
    }
    buffer.frameLength = AVAudioFrameCount(part.samples.count)
    try start(format: format)
    let idle = scheduled.isEmpty
    scheduled.append(part.id)
    if idle { onStart(part.id) }
    node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      guard let self else { return }
      self.queue.async {
        guard isCurrent(), self.scheduled.first == part.id else { return }
        self.scheduled.removeFirst()
        self.onDone(part.id)
        if let next = self.scheduled.first { self.onStart(next) }
      }
    }
  }

  /// Runs on `queue`. The completions of the dropped parts see that they are not current.
  func stop() {
    scheduled.removeAll()
    node.stop()
  }

  private func start(format: AVAudioFormat) throws {
    // The recognizer leaves the session in its measurement mode, which plays quietly. A reply plays
    // at the normal volume on the speaker, and the ringer switch does not silence it.
    let session = AVAudioSession.sharedInstance()
    if session.category != .playAndRecord || session.mode != .default {
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
    }
    try session.setActive(true)
    if self.format != format {
      // A new sample rate, such as a reply of the other voice engine, needs a new connection.
      node.stop()
      engine.disconnectNodeOutput(node)
      engine.connect(node, to: engine.mainMixerNode, format: format)
      self.format = format
    }
    if !engine.isRunning {
      engine.prepare()
      try engine.start()
    }
    if !node.isPlaying { node.play() }
  }
}

public class SpeechModule: Module {
  private let synthesis = DispatchQueue(label: "run.openbot.speech.synthesis", qos: .userInitiated)
  private var voice: SupertonicVoice?
  private let lock = NSLock()
  /// Each stop makes the parts that wait or play stale.
  private var generation = 0
  private lazy var player = SpeechPlayer(
    onStart: { [weak self] id in self?.sendEvent("onSpeechStart", ["id": id]) },
    onDone: { [weak self] id in self?.sendEvent("onSpeechDone", ["id": id]) }
  )

  private func currentGeneration() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return generation
  }

  private func enqueue(_ part: SpeechPart, generation own: Int) {
    let player = self.player
    player.queue.async { [weak self] in
      guard let self, own == self.currentGeneration() else { return }
      do {
        try player.play(part) { [weak self] in own == self?.currentGeneration() }
      } catch {
        self.sendEvent("onSpeechError", ["id": part.id, "code": "playback-failed"])
      }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("OpenBotSpeech")

    Events("onSpeechStart", "onSpeechDone", "onSpeechError")

    /// Loads Supertonic 3 from a downloaded model directory. A second call with the same directory
    /// keeps the loaded model.
    AsyncFunction("load") { (directory: URL, threads: Int, promise: Promise) in
      self.synthesis.async {
        if self.voice?.directory == directory.path {
          promise.resolve(nil)
          return
        }
        self.voice = nil
        do {
          self.voice = try SupertonicVoice(directory: directory.path, threads: threads)
          promise.resolve(nil)
        } catch {
          promise.reject("ERR_SPEECH_MODEL", "The speech model could not load.")
        }
      }
    }

    /// The directory for downloaded voice models: Application Support, out of the backup. The phone
    /// can download the files again, so they must not fill the user's iCloud backup.
    Function("modelRoot") { () throws -> String in
      var root = try FileManager.default
        .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent("voice", isDirectory: true)
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try root.setResourceValues(values)
      return root.absoluteString
    }

    /// Frees the model, such as before its files are deleted.
    AsyncFunction("unload") { (promise: Promise) in
      self.synthesis.async {
        self.voice = nil
        promise.resolve(nil)
      }
    }

    /// Reads one part of a reply with Supertonic 3 and plays it after the parts before it. The next
    /// part is synthesized while this one plays.
    Function("speak") { (id: String, text: String, language: String, speaker: Int, steps: Int) in
      let own = self.currentGeneration()
      self.synthesis.async {
        guard own == self.currentGeneration() else { return }
        guard let voice = self.voice else {
          self.sendEvent("onSpeechError", ["id": id, "code": "model-not-loaded"])
          return
        }
        guard let audio = voice.generate(text: text, language: language, speaker: speaker, steps: steps) else {
          self.sendEvent("onSpeechError", ["id": id, "code": "inference-failed"])
          return
        }
        self.enqueue(SpeechPart(id: id, samples: audio.samples, sampleRate: audio.sampleRate), generation: own)
      }
    }

    /// Plays little-endian 16-bit mono PCM, such as a reply part from ElevenLabs, after the parts before it.
    Function("playPcm") { (id: String, pcm: Uint8Array, sampleRate: Int) in
      let own = self.currentGeneration()
      // The typed array belongs to JavaScript: copy it before this call returns.
      let data = Data(bytes: pcm.rawPointer, count: pcm.byteLength)
      var samples = [Float](repeating: 0, count: data.count / 2)
      data.withUnsafeBytes { raw in
        for index in samples.indices {
          samples[index] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))) / 32_768
        }
      }
      self.enqueue(SpeechPart(id: id, samples: samples, sampleRate: Double(sampleRate)), generation: own)
    }

    /// Stops the part that plays and drops the parts that wait.
    Function("stop") {
      self.lock.lock()
      self.generation += 1
      self.lock.unlock()
      let player = self.player
      player.queue.async { player.stop() }
    }

    OnDestroy {
      self.lock.lock()
      self.generation += 1
      self.lock.unlock()
      let player = self.player
      player.queue.sync { player.stop() }
      self.synthesis.sync { self.voice = nil }
    }
  }
}
