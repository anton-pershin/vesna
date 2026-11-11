"""Console entry point for the loopback-only private TTS adapter."""

import argparse
import ipaddress

import uvicorn

from .config import Settings
from .tts import create_tts_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the private Vesna TTS adapter")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    arguments = parser.parse_args()
    try:
        address = ipaddress.ip_address(arguments.host)
    except ValueError as error:
        parser.error("TTS host must be a literal loopback IP address")
    if not address.is_loopback:
        parser.error("TTS must bind only to 127.0.0.1 or ::1")
    settings = Settings.from_env().for_tts()
    uvicorn.run(
        create_tts_app(settings),
        host=arguments.host,
        port=arguments.port,
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
