## Terminology

### General

| Term | Definition |
|------|------------|
| Vesna | The mobile-first application for reading and listening to prepared articles, Reddit summaries, and arXiv abstracts. |
| Progressive web application (PWA) | A web application that supports installation and offline use through browser capabilities. |
| comourat | The external Python library that provides source collection, extraction, web enrichment, and summarization. |
| Listening text | The text prepared for speech and displayed for read-along playback. |
| Prepared item | A library item with complete, consistent listening text, audio, and paragraph timing data ready for playback. |
| Prepared version | An identified set of listening text, audio, and paragraph timing data produced together for an item. |
| Enrichment result | The additional web-derived context returned by comourat for a collected post. A successful result can contain no additional context. |
| Generated Reddit summary | Listening text produced by summarizing a collected Reddit post and its enrichment result. |

### Presentation layer

| Term | Definition |
|------|------------|
| Read-along playback | Audio playback with the corresponding paragraph highlighted in the displayed listening text. |
| Paragraph timing data | Data that maps paragraph identifiers to their positions in the complete audio file. |
| Service worker | A browser-managed script that supports offline application launch and serves downloaded resources. It does not generate speech or control paragraph-to-paragraph audio transitions. |
| Media Session | The browser interface used to connect supported lock-screen and headset controls to the audio player. |
| Offline-ready download | A device copy whose required text, complete audio, timing data, and metadata have been stored and checked for offline use. This state does not guarantee permanent retention by the browser or operating system. |
| Playback state | The saved playback position and speed used to resume an item. |

### Application layer

| Term | Definition |
|------|------------|
| HTTPS host | The machine or deployment role that provides the PWA and authenticated API, runs content preparation and audio assembly, and stores server records and artifacts. The final deployment separates it from the home server; the M3 development profile combines these roles. |
| Home server | The machine that hosts the private TTS service in the final deployment. It does not need to provide public HTTPS access. |
| Text-to-speech (TTS) service | The private service that converts paragraph text into speech audio using configured voice settings. It runs on the development machine in M3 and on the home server in the final deployment. |
| M3 development profile | The deployment that runs the application, worker, storage, and loopback-only TTS service on one development machine, with temporary external HTTPS access. |
| Cloudflare Quick Tunnel | An outbound `cloudflared` connection that supplies a temporary public HTTPS origin without a domain or inbound port 443. It does not replace application authentication. |
| Preparation job | Durably recorded work that prepares listening text, requests speech, and produces a complete prepared version independently of the phone connection. |
| Preparation worker | The component on the HTTPS host that executes preparation jobs and records completed stages. |
| Audio assembly | The operation that combines generated paragraph audio into one complete audio file and produces matching paragraph timing data. |
| Outcome unknown | A job state in which a provider request may have completed but its outcome cannot be established. A potentially chargeable retry requires user confirmation. |

### Persistence layer

| Term | Definition |
|------|------------|
| Personal library | The saved items and their preparation information managed through Vesna. |
| Server records | Persistent session, library, job, content, and version information stored on the HTTPS host. |
| Artifact store | Storage on the HTTPS host for original Markdown uploads, generated audio segments, complete audio files, timing data, and version manifests. |
| Device storage | Browser-managed storage on the phone for offline application resources, downloaded items, and playback state. |
