# Voice evaluation

## Result

Selected configuration: **Piper `en_US-joe-medium`**, with voice identity `piper-en-us-joe-medium-cf910fb5`.

The user selected Joe after listening to both matched samples. Joe also had the lower median generation-time/audio-duration ratio and slightly lower peak memory. This selection does not claim that one voice is universally more natural than the other.

## Procedure

Both candidates used `piper-tts==1.8.0` and `onnxruntime==1.31.1` in an isolated Python 3.12 environment on the M3 development machine. Each candidate synthesized the same three public paragraphs from `voice-sample-text.txt` three times. The candidates ran sequentially. Each measurement includes interpreter startup and model loading through the subprocess interface used by the TTS adapter.

The raw measurements are in `voice-evaluation.json`. Each durable sample is the third run. The JSON records its SHA-256 hash, FFprobe format, wall time, audio duration, ratio, and peak resident memory. The output for every run is mono 16-bit PCM WAV at 22,050 Hz.

| Candidate | Median generation time ÷ audio duration | Maximum peak RSS | Durable sample | Durable sample SHA-256 |
|---|---:|---:|---|---|
| Joe | 0.1152 | 251,008 KiB | `voice-joe.wav` | `d1d0534b31760aaeea992a7e0a69d094a57422c51e936d1cdc5a2deac6295c2b` |
| LJ Speech | 0.1484 | 258,532 KiB | `voice-ljspeech.wav` | `c44a5f5680257d1239daac0f9052504dd27a609a9c01164ad9e3675682448ad3` |

Joe's median ratio is approximately 22 percent lower than LJ Speech's ratio. These measurements apply only to this development machine and the recorded command configuration.

## Model identity

### Joe

- Model: `rhasspy/piper-voices/en/en_US/joe/medium`
- Revision: `cf910fb59f1d79ab3b625a63993a108751c6c25d`
- ONNX SHA-256: `abf4b998e34045cbd00eaf050de2de620f81ded6eb8b85a24b022a1c2b3f08d2`
- `length_scale=1.0`, `noise_scale=0.5`, `noise_w_scale=0.333`, `sentence_silence=0.0`
- The upstream model card identifies the Joe dataset as CC0 and the fine-tuned base as CC0.

### LJ Speech

- Model: `rhasspy/piper-voices/en/en_US/ljspeech/medium`
- Revision: `bae641dcb5a608cff81ccaf7ff018baaca1a33e1`
- ONNX SHA-256: `6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22`
- `length_scale=1.0`, `noise_scale=0.667`, `noise_w_scale=0.333`, `sentence_silence=0.0`
- The upstream model card identifies LJ Speech as public domain.

Piper engine code and voice-model rights are separate. The upstream project does not grant a general license over every model or its generated audio. Retain the relevant upstream model card with each deployed model and review those terms before redistribution.

## Reproduction

The public model download and hash-verification procedure is in `deploy/install_joe_model.sh`. The LJ Speech model used the equivalent pinned revision and hash recorded above. Generation used the command shape in `deploy/vesna-tts.env.example` with the candidate-specific model, configuration, and noise settings. No generation run used credentials or a network service after installation.
